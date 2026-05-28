"""
Unified model client.

Tier 1: Llama 3.2 3B  via local Ollama on KVM4 (always available, no cold start)
Tier 2: Qwen3 32B     via RunPod runsync (~2-4s warm, ~120s cold start)
         → falls back to local Ollama when RunPod is cold
Tier 3: Claude Sonnet via Anthropic (frontier, streaming)
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
            "title": {
                "type": "string",
                "description": "Short event title (5 words max)",
            },
            "datetime_iso": {
                "type": "string",
                "description": "Start datetime in ISO 8601 with timezone offset (e.g. 2026-05-30T14:00:00+08:00)",
            },
            "duration_min": {
                "type": "integer",
                "description": "Duration in minutes. Default 60.",
            },
            "description": {
                "type": "string",
                "description": "Optional brief context notes",
            },
            "location": {
                "type": "string",
                "description": "Optional location",
            },
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
            "title": {
                "type": "string",
                "description": "Short task title (10 words max)",
            },
            "description": {
                "type": "string",
                "description": "Optional context or details",
            },
            "priority": {
                "type": "string",
                "enum": ["urgent", "high", "normal", "low"],
                "description": "Task priority. Default normal.",
            },
            "due_at": {
                "type": "string",
                "description": "Optional due date in ISO 8601 format",
            },
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
            "title": {
                "type": "string",
                "description": "Short task title (10 words max)",
            },
            "description": {
                "type": "string",
                "description": "Optional context or details",
            },
            "priority": {
                "type": "string",
                "enum": ["urgent", "high", "normal", "low"],
                "description": "Task priority. Default normal.",
            },
            "due_at": {
                "type": "string",
                "description": "Optional due date in ISO 8601 format",
            },
        },
        "required": ["title"],
    },
}


TIER_MODELS = {
    ModelTier.TIER1: "llama3.2:3b",
    ModelTier.TIER2: "qwen3-32b",
    ModelTier.TIER3: "claude-sonnet-4-6",
}

TIER_ENDPOINTS = {
    ModelTier.TIER2: settings.runpod_endpoint_32b,
}

_TIER_COOLDOWN = {
    ModelTier.TIER2: 120.0,
}


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
        # Tier 3: always Claude
        if tier == ModelTier.TIER3:
            async for event in self._stream_anthropic(messages, system, max_tokens, tools=tools, tool_executor=tool_executor):
                yield event
            return

        # Tier 1: local Ollama (always available, no cold start)
        if tier == ModelTier.TIER1:
            if settings.ollama_url:
                async for event in self._stream_ollama(messages, system, max_tokens):
                    yield event
            else:
                async for event in self._stream_anthropic(messages, system, max_tokens, tool_executor=tool_executor):
                    yield event
            return

        # Tier 2: RunPod 32B when warm, else local Ollama, else Claude
        endpoint = TIER_ENDPOINTS.get(ModelTier.TIER2)
        if endpoint and self._is_warm(ModelTier.TIER2):
            async for event in self._stream_runpod(messages, system, max_tokens):
                yield event
        elif settings.ollama_url:
            logger.info("RunPod Tier2 cold — using local Ollama")
            async for event in self._stream_ollama(messages, system, max_tokens):
                yield event
        else:
            async for event in self._stream_anthropic(messages, system, max_tokens, tools=tools, tool_executor=tool_executor):
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

                # Emit suggestion events for proposal tools (shown as chips)
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

                    # Build tool results — execute action tools, stub proposal tools
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
    ) -> AsyncGenerator[Dict[str, Any], None]:
        endpoint = TIER_ENDPOINTS[ModelTier.TIER2]
        model_name = settings.workhorse_model
        model_label = TIER_MODELS[ModelTier.TIER2]

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

        logger.info("RunPod Tier2 request: model=%s", model_name)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
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
                self._mark_failed(ModelTier.TIER2)
                async for event in self._stream_ollama(messages, system, max_tokens):
                    yield event
                return

            self._mark_warm(ModelTier.TIER2)
            full_text: str = choices[0].get("message", {}).get("content", "")
            usage = output.get("usage", {})
            total_tokens = usage.get("total_tokens", 0)

            chunk_size = 40
            for i in range(0, len(full_text), chunk_size):
                yield {"type": "chunk", "text": full_text[i: i + chunk_size]}
                await asyncio.sleep(0.02)

            yield {"type": "done", "model": model_label, "tokens": total_tokens}

        except Exception as e:
            logger.warning("RunPod Tier2 failed (%s: %s)", type(e).__name__, e)
            self._mark_failed(ModelTier.TIER2)
            async for event in self._stream_ollama(messages, system, max_tokens):
                yield event


# App-level singleton
_client: Optional[ModelClient] = None


def get_model_client() -> ModelClient:
    global _client
    if not _client:
        _client = ModelClient()
    return _client
