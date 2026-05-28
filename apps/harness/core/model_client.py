"""
Unified model client — routes to RunPod (Qwen) or Anthropic (Claude) based on tier.

Tier 1: Qwen3 8B  via RunPod runsync  (~500ms warm, ~60s cold start)
Tier 2: Qwen3 32B via RunPod runsync  (~2-4s warm, ~120s cold start)
Tier 3: Claude Sonnet via Anthropic   (~3-8s, real streaming)

RunPod tiers return full response then we chunk it to fake a stream.
Anthropic returns real SSE chunks.

Cold-start handling: on RunPod failure the tier is marked cold for a cooldown
period. During cooldown, requests route directly to Claude without waiting.
After cooldown the next request probes RunPod again — if it responds, the
tier is marked warm and tiering resumes normally.
"""

import asyncio
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


TIER_MODELS = {
    ModelTier.TIER1: "qwen3-8b",
    ModelTier.TIER2: "qwen3-32b",
    ModelTier.TIER3: "claude-sonnet-4-6",
}

TIER_ENDPOINTS = {
    ModelTier.TIER1: settings.runpod_endpoint_8b,
    ModelTier.TIER2: settings.runpod_endpoint_32b,
}

# How long to stay on Claude after a RunPod failure before probing again.
# 8B cold start ~60s, 32B cold start ~120s.
_TIER_COOLDOWN = {
    ModelTier.TIER1: 60.0,
    ModelTier.TIER2: 120.0,
}


class ModelClient:
    def __init__(self):
        self._anthropic: Optional[anthropic.AsyncAnthropic] = None
        self._http: Optional[httpx.AsyncClient] = None
        # tier -> monotonic timestamp of last failure (None = healthy)
        self._failed_at: dict[ModelTier, Optional[float]] = {
            ModelTier.TIER1: None,
            ModelTier.TIER2: None,
        }

    @property
    def anthropic(self) -> anthropic.AsyncAnthropic:
        if not self._anthropic:
            self._anthropic = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._anthropic

    @property
    def http(self) -> httpx.AsyncClient:
        if not self._http:
            self._http = httpx.AsyncClient(timeout=30.0)
        return self._http

    def _is_warm(self, tier: ModelTier) -> bool:
        failed_at = self._failed_at.get(tier)
        if failed_at is None:
            return True
        return (time.monotonic() - failed_at) >= _TIER_COOLDOWN.get(tier, 60.0)

    def _mark_failed(self, tier: ModelTier) -> None:
        self._failed_at[tier] = time.monotonic()
        cooldown = _TIER_COOLDOWN.get(tier, 60.0)
        logger.warning("RunPod %s marked cold — routing to Claude for %.0fs", tier, cooldown)

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
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """Yields SSE-style dicts: {"type": "chunk"|"done", "text"?: str, "model"?: str, "tokens"?: int}"""
        endpoint = TIER_ENDPOINTS.get(tier)
        if tier == ModelTier.TIER3 or not endpoint or not self._is_warm(tier):
            if endpoint and not self._is_warm(tier):
                logger.info("RunPod %s in cooldown — using Claude", tier)
            async for event in self._stream_anthropic(messages, system, max_tokens):
                yield event
        else:
            async for event in self._stream_runpod(messages, tier, system, max_tokens):
                yield event

    async def _stream_anthropic(
        self,
        messages: List[Dict[str, str]],
        system: str,
        max_tokens: int,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        model = "claude-sonnet-4-6"
        try:
            async with self.anthropic.messages.stream(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    yield {"type": "chunk", "text": text}
                final = await stream.get_final_message()
                total_tokens = final.usage.input_tokens + final.usage.output_tokens
                yield {"type": "done", "model": model, "tokens": total_tokens}
        except Exception as e:
            yield {"type": "error", "error": str(e)}

    async def _stream_runpod(
        self,
        messages: List[Dict[str, str]],
        tier: ModelTier,
        system: str,
        max_tokens: int,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        endpoint = TIER_ENDPOINTS[tier]
        model_name = settings.workhorse_model if tier == ModelTier.TIER2 else settings.router_model
        model_label = TIER_MODELS[tier]

        all_messages = messages
        if system:
            all_messages = [{"role": "system", "content": system}] + messages

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

        logger.info("RunPod request: tier=%s model=%s", tier, model_name)
        try:
            resp = await self.http.post(
                endpoint,
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.runpod_api_key}",
                    "Content-Type": "application/json",
                },
            )
            resp.raise_for_status()
            data = resp.json()

            # Ollama worker returns output as a list; vLLM returned a dict
            output = data.get("output", {})
            if isinstance(output, list) and output:
                output = output[0]
            choices = output.get("choices", []) if isinstance(output, dict) else []

            if not choices:
                self._mark_failed(tier)
                async for event in self._stream_anthropic(messages, system, max_tokens):
                    yield event
                return

            self._mark_warm(tier)
            full_text: str = choices[0].get("message", {}).get("content", "")
            usage = output.get("usage", {})
            total_tokens = usage.get("total_tokens", 0)

            # Fake-stream: chunk in ~40-char pieces with small delays for UX
            chunk_size = 40
            for i in range(0, len(full_text), chunk_size):
                yield {"type": "chunk", "text": full_text[i : i + chunk_size]}
                await asyncio.sleep(0.02)

            yield {"type": "done", "model": model_label, "tokens": total_tokens}

        except Exception as e:
            logger.warning("RunPod %s failed (%s: %s)", tier, type(e).__name__, e)
            self._mark_failed(tier)
            async for event in self._stream_anthropic(messages, system, max_tokens):
                yield event

    async def close(self):
        if self._http:
            await self._http.aclose()


# App-level singleton
_client: Optional[ModelClient] = None


def get_model_client() -> ModelClient:
    global _client
    if not _client:
        _client = ModelClient()
    return _client
