"""
Unified model client.

Tier 1: Qwen3 8B    via RunPod Serverless (GPU, ~1-3s)
         → falls back to local Ollama llama3.2:3b (CPU, capped at 600 tokens)
         → falls back to Claude
Tier 2: Qwen3 32B   via RunPod Serverless (~2-4s warm, ~120s cold start)
         → falls back to local Ollama
         → falls back to Claude
Tier 3: Claude Sonnet via Anthropic (frontier, streaming, tools)

NOTE: llama3.2:3b is the CLASSIFIER only. It routes requests but never generates
      Tier 1 responses — that's Qwen3 8B (or Ollama as a fallback).
"""

import asyncio
import json
import logging
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
    ModelTier.TIER1: "qwen3-8b",
    ModelTier.TIER2: "qwen3-32b",
    ModelTier.TIER3: "claude-sonnet-4-6",
}

TIER_ENDPOINTS = {
    ModelTier.TIER1: settings.runpod_endpoint_8b,
    ModelTier.TIER2: settings.runpod_endpoint_32b,
}

TIER_MODEL_NAMES = {
    ModelTier.TIER1: settings.router_model,       # Qwen/Qwen3-8B
    ModelTier.TIER2: settings.workhorse_model,    # Qwen/Qwen3-32B-AWQ
}

_TIER_COOLDOWN = {
    ModelTier.TIER1: 120.0,
    ModelTier.TIER2: 120.0,
}

# Tier 1 Ollama fallback: cap at 600 tokens so CPU inference stays under ~60s
_TIER1_OLLAMA_MAX_TOKENS = 600

# Per-tier RunPod request timeouts.
# Warm 8B responds in 1-3s → 12s bails fast on cold starts without waiting the full 30s.
# Warm 32B responds in 2-10s → 40s covers heavier generation without hanging indefinitely.
_RUNPOD_TIMEOUT = {
    ModelTier.TIER1: 12.0,
    ModelTier.TIER2: 40.0,
}


class ModelClient:
    def __init__(self):
        self._anthropic: Optional[anthropic.AsyncAnthropic] = None
        self._failed_at: dict[ModelTier, Optional[float]] = {
            ModelTier.TIER1: None,
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
        # ── Tier 3: Claude — frontier, tools, streaming ──────────────────────
        if tier == ModelTier.TIER3:
            async for event in self._stream_anthropic(
                messages, system, max_tokens, tools=tools, tool_executor=tool_executor
            ):
                yield event
            return

        # ── Tier 1: RunPod Qwen3 8B → Claude ─────────────────────────────────
        if tier == ModelTier.TIER1:
            endpoint_1b = TIER_ENDPOINTS.get(ModelTier.TIER1)
            if endpoint_1b and self._is_warm(ModelTier.TIER1):
                async for event in self._stream_runpod(
                    messages, system, max_tokens, tier=ModelTier.TIER1
                ):
                    yield event
            else:
                logger.info("Tier1 RunPod cold/absent — falling back to Claude")
                async for event in self._stream_anthropic(messages, system, max_tokens):
                    yield event
            return

        # ── Tier 2: RunPod Qwen3 32B → Claude ────────────────────────────────
        endpoint_2 = TIER_ENDPOINTS.get(ModelTier.TIER2)
        if endpoint_2 and self._is_warm(ModelTier.TIER2):
            async for event in self._stream_runpod(messages, system, max_tokens, tier=ModelTier.TIER2):
                yield event
        else:
            logger.info("Tier2 RunPod cold/absent — falling back to Claude")
            async for event in self._stream_anthropic(messages, system, max_tokens):
                yield event

    async def _stream_ollama(
        self,
        messages: List[Dict[str, str]],
        system: str,
        max_tokens: int,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        model = settings.classifier_model  # llama3.2:3b
        all_messages = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(messages)

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                async with client.stream(
                    "POST",
                    f"{settings.ollama_url}/api/chat",
                    json={
                        "model": model,
                        "messages": all_messages,
                        "stream": True,
                        "options": {"num_predict": max_tokens},
                    },
                ) as resp:
                    resp.raise_for_status()
                    token_count = 0
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                            text = chunk.get("message", {}).get("content", "")
                            if text:
                                token_count += 1
                                yield {"type": "chunk", "text": text}
                            if chunk.get("done"):
                                yield {"type": "done", "model": model, "tokens": token_count}
                        except json.JSONDecodeError:
                            pass
        except Exception as e:
            logger.warning("Ollama stream failed (%s: %s) — falling back to Claude", type(e).__name__, e)
            async for event in self._stream_anthropic(messages, system, max_tokens):
                yield event

    async def _stream_anthropic(
        self,
        messages: List[Dict[str, str]],
        system: str,
        max_tokens: int,
        tools: Optional[List[Dict]] = None,
        tool_executor=None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # Tools that emit a suggestion chip — user confirms before action
        _SUGGESTION_TOOLS = {"propose_calendar_event", "propose_task"}

        model = "claude-sonnet-4-6"
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
        """Call a RunPod serverless Ollama endpoint (works for both Tier 1 and Tier 2)."""
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

        timeout = _RUNPOD_TIMEOUT.get(tier, 30.0)
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
                async for event in self._stream_anthropic(messages, system, max_tokens):
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
            logger.warning("RunPod %s failed (%s: %s) — falling back to Claude", tier, type(e).__name__, e)
            self._mark_failed(tier)
            async for event in self._stream_anthropic(messages, system, max_tokens):
                yield event


# App-level singleton
_client: Optional[ModelClient] = None


def get_model_client() -> ModelClient:
    global _client
    if not _client:
        _client = ModelClient()
    return _client
