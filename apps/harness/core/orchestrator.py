"""
Parallel sub-agent orchestrator (mixture of experts).

run_parallel() fans a single chat turn out into N independent headless
sub-agents, each streamed through ModelClient with a scoped, read-mostly tool
set. Sub-agents never talk to each other — outputs come back to the main chat
turn as one tool result and the primary model does the synthesis.

Design constraints:
- Concurrency is capped (Semaphore) and every subtask has a hard timeout, so a
  slow or failing sub-agent can never block the others.
- Sub-agent tools are read-only (search/read). No email sends, calendar
  writes, task mutations — keeps the model client's pre-content fallback
  invariant safe: a retried sub-agent never re-runs a side effect.
- Each subtask gets its own DB session. AsyncSession is not concurrency-safe,
  so the caller's session is never shared across the gather.
"""

import asyncio
import logging
import time
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional

from core.model_client import (
    get_model_client, ModelTier,
    WEB_SEARCH_TOOL, BROWSE_WEB_TOOL,
    _PROVIDER_DEFAULTS,
)

log = logging.getLogger(__name__)

MAX_CONCURRENCY = 4
SUBTASK_TIMEOUT_S = 300
MAX_SUBTASKS = 8
PROGRESS_INTERVAL_S = 1.0  # throttle chunk-progress events per subtask

# Sub-agent-only read tools. Memory/Second Brain search has no module-level
# dict in model_client.py (chat injects memory via context rather than tools),
# and chat's READ_ARTIFACT_TOOL is id-only while sub-agents may also look up by
# filename — so these two minimal read-only schemas live here.
SEARCH_MEMORY_TOOL = {
    "name": "search_memory",
    "description": (
        "Search Mike's memory (Mnemon — personal facts, preferences, events) and "
        "Second Brain (saved research, notes, documents) for relevant information."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "What to look for. Be specific.",
            },
        },
        "required": ["query"],
    },
}

READ_ARTIFACT_TOOL = {
    "name": "read_artifact",
    "description": (
        "Read the text content of a file in Artifacts by id or filename. "
        "Extracts text from PDF/DOCX/XLSX; binaries without extractable text "
        "return a note instead."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "artifact_id": {
                "type": "string",
                "description": "Artifact id. Use filename if you don't have the id.",
            },
            "filename": {
                "type": "string",
                "description": "Filename, if you don't have the artifact id.",
            },
        },
    },
}

SUB_AGENT_TOOLS = [
    WEB_SEARCH_TOOL,
    BROWSE_WEB_TOOL,
    SEARCH_MEMORY_TOOL,
    READ_ARTIFACT_TOOL,
]

_HEADLESS_INSTRUCTIONS = (
    "You are a headless sub-agent inside TARS, running one task in parallel with "
    "others. Work autonomously: use your tools to research, then produce the "
    "final deliverable as your visible response text. Your output is read by the "
    "orchestrating model and synthesised into a single answer for Mike — he never "
    "sees your raw output directly. Be thorough but self-contained: cite sources "
    "with URLs where relevant, state uncertainty plainly, and do not ask "
    "questions (nobody can answer them). Do not try to message the other "
    "sub-agents; you cannot."
)


def _scoped_tool_executor(tool_db, user_id: str):
    """Read-mostly tool executor for a sub-agent (modelled on prompt_cron's).

    Deliberately excludes every state-changing tool. browse_web can navigate a
    logged-in browser but is delegated to the same read-oriented runner the
    cron path uses; anything it downloads lands in Artifacts, which is the
    intended output channel.
    """

    async def _execute(name: str, tool_input: dict) -> str:
        if name == "web_search":
            try:
                from core.config import settings as _settings
                query = tool_input.get("query", "")
                if not query:
                    return "No search query provided."
                if not _settings.tavily_api_key:
                    return "Web search not configured (no Tavily API key)."
                import httpx
                async with httpx.AsyncClient(timeout=15) as http:
                    resp = await http.post(
                        "https://api.tavily.com/search",
                        json={
                            "api_key": _settings.tavily_api_key,
                            "query": query,
                            "search_depth": tool_input.get("search_depth", "basic"),
                            "max_results": 5,
                            "include_answer": True,
                        },
                    )
                data = resp.json()
                results = data.get("results", [])
                lines = [f"Search: {query}\n"]
                if data.get("answer"):
                    lines.append(f"Summary: {data['answer']}\n")
                for r in results[:5]:
                    lines.append(f"**{r.get('title', '')}**\n{r.get('url', '')}\n{r.get('content', '')[:300]}")
                return "\n\n".join(lines) if results else "No results found."
            except Exception as exc:
                return f"Web search failed: {exc}"

        if name == "browse_web":
            from core.browser_runner import execute_browse_web
            return await execute_browse_web(tool_input, user_id, tool_db)

        if name == "search_memory":
            try:
                from memory import mnemon, second_brain
                query = tool_input.get("query", "")
                if not query:
                    return "No query provided."
                parts: list[str] = []
                memories = await mnemon.search(tool_db, user_id, query, limit=8)
                for m in memories:
                    if m.content:
                        parts.append(f"[Memory] {m.content}")
                sb_results = await second_brain.search(tool_db, user_id, query, limit=6)
                for r in sb_results:
                    chunk, item = r.get("chunk"), r.get("item")
                    text = chunk.content if chunk else (item.summary or "" if item else "")
                    if text:
                        title = (item.source_title or item.url or "Knowledge item") if item else "Knowledge item"
                        parts.append(f"[Second Brain: {title}]\n{text[:1500]}")
                return "\n\n".join(parts) if parts else "Nothing found in memory or Second Brain."
            except Exception as exc:
                return f"Memory search failed: {exc}"

        if name == "read_artifact":
            try:
                from sqlalchemy import select
                from db.models import Artifact
                from core.artifact_store import read_artifact_text

                artifact_id = tool_input.get("artifact_id")
                if not artifact_id:
                    filename = tool_input.get("filename")
                    if not filename:
                        return "Need an artifact_id or filename."
                    artifact_id = (await tool_db.execute(
                        select(Artifact.id)
                        .where(Artifact.user_id == user_id, Artifact.filename == filename)
                        .order_by(Artifact.created_at.desc()).limit(1)
                    )).scalar_one_or_none()
                    if not artifact_id:
                        return "No matching artifact found."
                return await read_artifact_text(artifact_id, user_id, tool_db)
            except Exception as exc:
                return f"Failed to read artifact: {exc}"

        return f"Tool '{name}' is not available to parallel sub-agents."

    return _execute


def _forced_pair(subtask: dict) -> tuple[Optional[str], Optional[str]]:
    """Resolve a subtask's optional provider/model override.

    ModelClient.stream only honours forced_provider + forced_model together, so
    a provider-only pick resolves that provider's Tier 2 default model here.
    """
    provider = subtask.get("provider")
    model = subtask.get("model")
    if not provider and not model:
        return None, None
    if provider and not model:
        model = _PROVIDER_DEFAULTS.get((provider, "tier2")) or (
            "claude-sonnet-5" if provider == "anthropic" else None
        )
    if not (provider and model):
        return None, None
    return provider, model


async def _run_subtask(
    index: int,
    subtask: dict,
    *,
    user_id: str,
    run_id: str,
    semaphore: asyncio.Semaphore,
    on_event=None,
) -> dict:
    title = str(subtask.get("title") or f"Subtask {index + 1}")
    prompt = str(subtask.get("prompt") or "").strip()
    role = str(subtask.get("role") or "").strip()
    forced_provider, forced_model = _forced_pair(subtask)

    result = {
        "index": index,
        "title": title,
        "role": role or None,
        "status": "failed",
        "output": "",
        "model_used": "",
        "tokens": 0,
        "input_tokens": 0,
    }

    async def _emit(evt: dict) -> None:
        if on_event is None:
            return
        try:
            await on_event({"run_id": run_id, "index": index, **evt})
        except Exception:
            log.warning("orchestrator on_event failed: %s", evt.get("type"))

    if not prompt:
        result["output"] = "Subtask has no prompt."
        await _emit({
            "type": "subtask_done",
            "status": result["status"],
            "preview": result["output"],
            "model": "",
            "tokens": 0,
        })
        return result

    async with semaphore:
        output_parts: list[str] = []
        last_progress = 0.0
        try:
            from db.session import AsyncSessionLocal

            system = _HEADLESS_INSTRUCTIONS
            if role:
                system = f"You are acting as a {role}. {system}"

            client = get_model_client()
            stream_kwargs: Dict[str, Any] = {}
            if forced_provider and forced_model:
                stream_kwargs = {
                    "forced_provider": forced_provider,
                    "forced_model": forced_model,
                }

            async def _stream() -> None:
                nonlocal last_progress
                async with AsyncSessionLocal() as tool_db:
                    async for event in client.stream(
                        messages=[{"role": "user", "content": prompt}],
                        tier=ModelTier.TIER2,
                        system=system,
                        tools=SUB_AGENT_TOOLS,
                        tool_executor=_scoped_tool_executor(tool_db, user_id),
                        **stream_kwargs,
                    ):
                        if not isinstance(event, dict):
                            continue
                        etype = event.get("type")
                        if etype == "chunk":
                            output_parts.append(event.get("text", ""))
                            now = time.monotonic()
                            if now - last_progress >= PROGRESS_INTERVAL_S:
                                last_progress = now
                                preview = "".join(output_parts)[-160:].strip()
                                if preview:
                                    await _emit({"type": "subtask_progress", "preview": preview})
                        elif etype == "error":
                            raise RuntimeError(event.get("error", "model stream error"))
                        elif etype == "done":
                            result["model_used"] = event.get("model", "")
                            result["tokens"] = event.get("tokens", 0)
                            result["input_tokens"] = event.get("input_tokens", 0)

            await asyncio.wait_for(_stream(), timeout=SUBTASK_TIMEOUT_S)
            result["status"] = "done"
            result["output"] = "".join(output_parts).strip() or "(No response generated)"
        except asyncio.TimeoutError:
            result["output"] = f"Timed out after {SUBTASK_TIMEOUT_S}s."
            log.warning("Parallel subtask %d ('%s') timed out", index, title)
        except Exception as exc:
            result["output"] = f"Failed: {exc}"
            log.warning("Parallel subtask %d ('%s') failed: %s", index, title, exc)

        await _emit({
            "type": "subtask_done",
            "status": result["status"],
            "preview": result["output"][-160:].strip(),
            "model": result["model_used"],
            "tokens": result["tokens"],
        })
        return result


async def run_parallel(
    subtasks: List[dict],
    user_id: str,
    db=None,
    on_event: Optional[Callable[[dict], Awaitable[None]]] = None,
) -> List[dict]:
    """
    Run subtasks ({title, prompt, role?, provider?, model?}) concurrently.

    Returns one result dict per subtask, in input order:
    {index, title, role, status, output, model_used, tokens, input_tokens}.

    `db` is accepted for call-site symmetry but intentionally unused — each
    subtask opens its own session because AsyncSession is not concurrency-safe.
    """
    run_id = uuid.uuid4().hex[:12]
    subtasks = [s for s in (subtasks or []) if isinstance(s, dict)][:MAX_SUBTASKS]
    if not subtasks:
        return []

    if on_event is not None:
        await on_event({
            "type": "parallel_started",
            "run_id": run_id,
            "subtasks": [
                {
                    "index": i,
                    "title": str(s.get("title") or f"Subtask {i + 1}"),
                    "role": str(s.get("role") or "") or None,
                    "model": s.get("model") or None,
                }
                for i, s in enumerate(subtasks)
            ],
        })

    semaphore = asyncio.Semaphore(MAX_CONCURRENCY)
    results = await asyncio.gather(*(
        _run_subtask(
            i, s,
            user_id=user_id, run_id=run_id,
            semaphore=semaphore, on_event=on_event,
        )
        for i, s in enumerate(subtasks)
    ))
    return sorted(results, key=lambda r: r["index"])
