"""
Unified model client.

Tier 1: Claude Haiku  — always available, ~200-500ms, cheap (~$0.001/req)
Tier 2: RunPod 32B    — warm: ~2-10s GPU inference
         cold fallback: Haiku  if message ≤ 500 chars (standard tasks)
                        Sonnet if message > 500 chars or contains complexity signals
Tier 3: Claude Sonnet — frontier, tools, streaming, always Claude

NOTE: llama3.2:3b / Ollama is fully retired from the response path.
      The classifier is now a Haiku API call (router.py).
"""

import asyncio
import json
import logging
import re
import time
from enum import Enum
from typing import AsyncGenerator, List, Dict, Any, Optional

import httpx
import anthropic

from core.config import settings

logger = logging.getLogger(__name__)


class ModelTier(str, Enum):
    TIER1 = "tier1"
    TIER2 = "tier2"
    TIER3 = "tier3"


# ─── Tool definitions ────────────────────────────────────────────────────────

PROPOSE_CALENDAR_EVENT_TOOL = {
    "name": "propose_calendar_event",
    "description": (
        "Suggest adding an event to the user's Google Calendar. Use this when the "
        "conversation establishes a specific date, time, and activity — e.g. a meeting "
        "invitation in an email, a deadline to block time for, or a call just scheduled. "
        "Do NOT use for vague future plans or hypotheticals."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short event title (5 words max)"},
            "datetime_iso": {"type": "string", "description": "ISO 8601 with timezone offset (e.g. 2026-05-30T14:00:00+08:00)"},
            "duration_min": {"type": "integer", "description": "Duration in minutes. Default 60."},
            "description": {"type": "string", "description": "Optional brief context notes"},
            "location": {"type": "string", "description": "Optional location"},
        },
        "required": ["title", "datetime_iso"],
    },
}

CREATE_CALENDAR_EVENT_TOOL = {
    "name": "create_calendar_event",
    "description": (
        "Create a Google Calendar event immediately. Use when the user explicitly asks "
        "you to book, schedule, or add a meeting, call, or appointment. "
        "Execute without asking for confirmation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short event title"},
            "datetime_iso": {"type": "string", "description": "ISO 8601 with timezone offset"},
            "duration_min": {"type": "integer", "description": "Duration in minutes. Default 60."},
            "description": {"type": "string", "description": "Optional notes or agenda"},
            "location": {"type": "string", "description": "Optional location or video link"},
            "attendees": {"type": "array", "items": {"type": "string"}, "description": "Attendee email addresses"},
        },
        "required": ["title", "datetime_iso"],
    },
}

CREATE_TASK_TOOL = {
    "name": "create_task",
    "description": (
        "Create a task in the user's task inbox. Use this when the user explicitly asks "
        "you to add, create, track, or remember a task, to-do, action item, follow-up, "
        "or reminder. Execute immediately — do not ask for confirmation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short task title (10 words max)"},
            "description": {"type": "string", "description": "Optional context or details"},
            "priority": {"type": "string", "enum": ["urgent", "high", "normal", "low"], "description": "Task priority. Default normal."},
            "due_at": {"type": "string", "description": "Optional due date in ISO 8601 format"},
        },
        "required": ["title"],
    },
}

PROPOSE_TASK_TOOL = {
    "name": "propose_task",
    "description": (
        "Suggest a task when you proactively detect an implied action item from context "
        "that the user has NOT explicitly asked you to track. Shows a confirmation chip. "
        "Do NOT use when the user explicitly asks you to add a task — use create_task instead."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short task title (10 words max)"},
            "description": {"type": "string", "description": "Optional context or details"},
            "priority": {"type": "string", "enum": ["urgent", "high", "normal", "low"], "description": "Task priority. Default normal."},
            "due_at": {"type": "string", "description": "Optional due date in ISO 8601 format"},
        },
        "required": ["title"],
    },
}

SAVE_MEMORY_TOOL = {
    "name": "save_memory",
    "description": (
        "Save a fact, note, or piece of information to Mike's episodic memory. "
        "Use immediately whenever Mike says 'remember this', 'note that', 'keep in mind', "
        "or shares a personal fact, preference, or decision worth preserving. "
        "Also use proactively when you detect important context (e.g. a new client, "
        "a key preference, a health update). Memories are semantically searched and "
        "injected into every future conversation."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The fact or note to remember. Write in third person, be specific: 'Mike prefers...' / 'Mike decided...'",
            },
            "domain": {
                "type": "string",
                "enum": ["work", "personal", "health", "cycling", "client"],
                "description": "Domain/category. Default: work.",
            },
            "importance": {
                "type": "integer",
                "description": "1-5. Default 3. Use 5 for critical facts (e.g. client preferences, health conditions).",
            },
        },
        "required": ["content"],
    },
}

SAVE_TO_SECOND_BRAIN_TOOL = {
    "name": "save_to_second_brain",
    "description": (
        "Save a note, research finding, or piece of reusable knowledge to Mike's "
        "Second Brain knowledge base. Use when Mike says 'save this', 'add this to my "
        "second brain', 'note this for later', or when you produce analysis/research "
        "worth preserving for future retrieval. "
        "Second Brain = reusable reference knowledge. Memory = personal facts and events."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "content": {
                "type": "string",
                "description": "The note or knowledge to save. Markdown OK.",
            },
            "title": {
                "type": "string",
                "description": "Short descriptive title (used for search).",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Tags for organization, e.g. ['client', 'growth-rocket', 'seo']",
            },
            "domain": {
                "type": "string",
                "description": "Domain category (work, personal, health, cycling, client). Default: work.",
            },
        },
        "required": ["content", "title"],
    },
}

# ─── Tier routing tables ─────────────────────────────────────────────────────

TIER_MODELS = {
    ModelTier.TIER1: "haiku",
    ModelTier.TIER2: "qwen3-32b",
    ModelTier.TIER3: "claude-sonnet-4-6",
}

# Only Tier 2 uses RunPod now; Tier 1 = Haiku, Tier 3 = Sonnet
TIER_ENDPOINTS = {
    ModelTier.TIER2: settings.runpod_endpoint_32b,
}

TIER_MODEL_NAMES = {
    ModelTier.TIER2: settings.workhorse_model,    # Qwen/Qwen3-32B-AWQ
}

_TIER_COOLDOWN = {
    ModelTier.TIER2: 120.0,
}

# RunPod Tier 2 timeout: 32B warm = 2-10s; 40s covers heavy generation
_RUNPOD_TIMEOUT = {
    ModelTier.TIER2: 40.0,
}

# Tier 2 cold fallback: complexity signals → Sonnet; otherwise → Haiku
_COMPLEX_T2_RE = re.compile(
    r"\b(comprehensive|in.?depth|detailed analysis|full analysis|thorough|"
    r"strategy|proposal|formal report|deep dive)\b",
    re.IGNORECASE,
)


def _tier2_cold_model(messages: list) -> Optional[str]:
    """
    Decide which model to use when RunPod 32B is cold.
    Returns settings.tier1_model (Haiku) for short/standard requests,
    None (→ Sonnet default) for long/complex ones.
    """
    last = next((m["content"] for m in reversed(messages) if m.get("role") == "user"), "")
    if not isinstance(last, str):
        return None  # image/rich content → Sonnet
    if len(last) > 500 or _COMPLEX_T2_RE.search(last):
        return None  # complex → Sonnet
    return settings.tier1_model  # standard → Haiku


class ModelClient:
    def __init__(self):
        self._anthropic: Optional[anthropic.AsyncAnthropic] = None
        self._failed_at: dict[ModelTier, Optional[float]] = {
            ModelTier.TIER2: None,
        }

    @property
    def anthropic(self) -> anthropic.AsyncAnthropic:
        if not self._anthropic:
            self._anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._anthropic

    def _is_warm(self, tier: ModelTier) -> bool:
        failed_at = self._failed_at.get(tier)
        if failed_at is None:
            return True
        return (time.monotonic() - failed_at) >= _TIER_COOLDOWN.get(tier, 120.0)

    def _mark_failed(self, tier: ModelTier) -> None:
        self._failed_at[tier] = time.monotonic()
        logger.warning("RunPod %s marked cold — falling back for %.0fs", tier, _TIER_COOLDOWN.get(tier, 120.0))

    def _mark_warm(self, tier: ModelTier) -> None:
        if self._failed_at.get(tier) is not None:
            logger.info("RunPod %s recovered — resuming tier routing", tier)
        self._failed_at[tier] = None

    async def stream(
        self,
        messages: List[Dict[str, str]],
        tier: ModelTier,
        system: str = "",
        max_tokens: int = 4096,
        tools: Optional[List[Dict]] = None,
        tool_executor=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # ── Tier 3: Claude Sonnet — frontier, tools, streaming ───────────────
        if tier == ModelTier.TIER3:
            async for event in self._stream_anthropic(
                messages, system, max_tokens, tools=tools, tool_executor=tool_executor
            ):
                yield event
            return

        # ── Tier 1: Claude Haiku — always available, no cold start ───────────
        if tier == ModelTier.TIER1:
            async for event in self._stream_anthropic(
                messages, system, min(max_tokens, 1024), model=settings.tier1_model
            ):
                yield event
            return

        # ── Tier 2: RunPod 32B → Haiku or Sonnet when cold ───────────────────
        endpoint_2 = TIER_ENDPOINTS.get(ModelTier.TIER2)
        if endpoint_2 and self._is_warm(ModelTier.TIER2):
            async for event in self._stream_runpod(messages, system, max_tokens, tier=ModelTier.TIER2):
                yield event
        else:
            cold_model = _tier2_cold_model(messages)
            logger.info(
                "Tier2 RunPod cold — falling back to %s",
                "haiku" if cold_model else "sonnet",
            )
            async for event in self._stream_anthropic(messages, system, max_tokens, model=cold_model):
                yield event

    async def _stream_anthropic(
        self,
        messages: List[Dict[str, str]],
        system: str,
        max_tokens: int,
        *,
        model: Optional[str] = None,
        tools: Optional[List[Dict]] = None,
        tool_executor=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # Tools that emit a suggestion chip — user confirms before action
        _SUGGESTION_TOOLS = {"propose_calendar_event", "propose_task"}

        model = model or "claude-sonnet-4-6"
        try:
            kwargs: Dict[str, Any] = dict(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
            )
            if tools:
                kwargs["tools"] = tools

            async with self.anthropic.messages.stream(**kwargs) as stream:
                async for text in stream.text_stream:
                    yield {"type": "chunk", "text": text}

                final = await stream.get_final_message()
                tool_uses = [b for b in final.content if b.type == "tool_use"]

                # Emit suggestion events for proposal tools (shown as chips in UI)
                for b in tool_uses:
                    if b.name == "propose_calendar_event":
                        yield {"type": "calendar_suggest", "tool_use_id": b.id, **b.input}
                    elif b.name == "propose_task":
                        yield {"type": "task_suggest", "tool_use_id": b.id, **b.input}

                if final.stop_reason == "tool_use" and tool_uses:
                    asst_content = []
                    for b in final.content:
                        if b.type == "text":
                            asst_content.append({"type": "text", "text": b.text})
                        elif b.type == "tool_use":
                            asst_content.append({
                                "type": "tool_use", "id": b.id,
                                "name": b.name, "input": b.input,
                            })

                    tool_results = []
                    for b in tool_uses:
                        if b.name in _SUGGESTION_TOOLS:
                            result = "Suggestion shown to user."
                        elif tool_executor is not None:
                            try:
                                result = await tool_executor(b.name, b.input)
                            except Exception as exc:
                                result = f"Error: {exc}"
                        else:
                            result = "Action completed."
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": b.id,
                            "content": result,
                        })

                    cont_messages = messages + [
                        {"role": "assistant", "content": asst_content},
                        {"role": "user", "content": tool_results},
                    ]
                    cont_kwargs: Dict[str, Any] = dict(
                        model=model, max_tokens=max_tokens,
                        system=system, messages=cont_messages,
                    )
                    if tools:
                        cont_kwargs["tools"] = tools

                    async with self.anthropic.messages.stream(**cont_kwargs) as cont:
                        async for text in cont.text_stream:
                            yield {"type": "chunk", "text": text}
                        final2 = await cont.get_final_message()
                        total = (
                            final.usage.input_tokens + final.usage.output_tokens
                            + final2.usage.input_tokens + final2.usage.output_tokens
                        )
                        yield {"type": "done", "model": model, "tokens": total}
                else:
                    total = final.usage.input_tokens + final.usage.output_tokens
                    yield {"type": "done", "model": model, "tokens": total}

        except Exception as e:
            yield {"type": "error", "error": str(e)}

    async def _stream_runpod(
        self,
        messages: List[Dict[str, str]],
        system: str,
        max_tokens: int,
        *,
        tier: ModelTier,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Call a RunPod serverless Ollama endpoint (Tier 2 only)."""
        endpoint = TIER_ENDPOINTS[tier]
        model_name = TIER_MODEL_NAMES[tier]
        model_label = TIER_MODELS[tier]

        all_messages = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(messages)

        payload = {
            "input": {
                "openai_route": "/v1/chat/completions",
                "openai_input": {
                    "model": model_name,
                    "messages": all_messages,
                    "max_tokens": max_tokens,
                    "stream": False,
                },
            }
        }

        timeout = _RUNPOD_TIMEOUT.get(tier, 40.0)
        logger.info("RunPod %s request: model=%s timeout=%.0fs", tier, model_name, timeout)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    endpoint,
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {settings.runpod_api_key}",
                        "Content-Type": "application/json",
                    },
                )
            resp.raise_for_status()
            data = resp.json()

            output = data.get("output", {})
            if isinstance(output, list) and output:
                output = output[0]
            choices = output.get("choices", []) if isinstance(output, dict) else []

            if not choices:
                self._mark_failed(tier)
                logger.warning("RunPod %s returned empty choices — falling back to Claude", tier)
                cold_model = _tier2_cold_model(messages)
                async for event in self._stream_anthropic(messages, system, max_tokens, model=cold_model):
                    yield event
                return

            self._mark_warm(tier)
            full_text: str = choices[0].get("message", {}).get("content", "")
            usage = output.get("usage", {})
            total_tokens = usage.get("total_tokens", 0)

            chunk_size = 40
            for i in range(0, len(full_text), chunk_size):
                yield {"type": "chunk", "text": full_text[i: i + chunk_size]}
                await asyncio.sleep(0.02)

            yield {"type": "done", "model": model_label, "tokens": total_tokens}

        except Exception as e:
            logger.warning("RunPod %s failed (%s: %s) — falling back", tier, type(e).__name__, e)
            self._mark_failed(tier)
            cold_model = _tier2_cold_model(messages)
            async for event in self._stream_anthropic(messages, system, max_tokens, model=cold_model):
                yield event


# App-level singleton
_client: Optional[ModelClient] = None


def get_model_client() -> ModelClient:
    global _client
    if not _client:
        _client = ModelClient()
    return _client
