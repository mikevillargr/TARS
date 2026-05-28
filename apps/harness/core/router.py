"""
Tier classifier — routes each request to the right model tier.

Primary path: Llama 3.2 3B via local Ollama on the KVM4 (~1-3s CPU inference).
Fallback: regex + length heuristics (instant, used when Ollama is unavailable).

Tiers:
  tier1 — simple, fast   → Qwen3 8B   (quick Q&A, state changes, lookups)
  tier2 — standard       → Qwen3 32B  (writing, coding, analysis, most tasks)
  tier3 — frontier       → Claude     (strategy, long docs, client deliverables)
"""

import re
import logging
import httpx

from core.model_client import ModelTier
from core.config import settings

logger = logging.getLogger(__name__)

_CLASSIFY_TIMEOUT = 5.0

_CLASSIFY_SYSTEM = (
    "You are a routing classifier. Reply with ONLY one word — no explanation.\n\n"
    "tier1 — simple and fast: quick questions with short answers, calendar/task lookups, "
    "state changes (mark done, add reminder), single facts\n"
    "tier2 — standard: writing, coding, analysis, summarization, research, "
    "multi-step tasks, most conversations\n"
    "tier3 — frontier: strategy, comprehensive documents, client deliverables, "
    "deep analysis, complex multi-part reasoning\n\n"
    "Reply with exactly: tier1, tier2, or tier3"
)

# Fast-path patterns — skip LLM for obvious cases
_TIER1_RE = re.compile(
    r"\b("
    r"what('s| is) (on |my )?(my |the )?(calendar|schedule|tasks?|todo)"
    r"|mark (that |it |task )?(as )?(done|complete|finished)"
    r"|remind me|what time"
    r"|set (a |the )?(timer|alarm|reminder)"
    r"|add (a |to )?(task|reminder|note)"
    r"|show me (my )?(tasks?|calendar|schedule)"
    r"|how many (tasks?|meetings?)"
    r")\b",
    re.IGNORECASE,
)

_TIER3_RE = re.compile(
    r"\b("
    r"write (a |an |the |me )?(full|complete|detailed|comprehensive|long)"
    r"|create (a |an )?(strategy|proposal)"
    r"|draft (a |an )?(proposal|contract|strategy)"
    r"|deep (dive|analysis|review)"
    r"|comprehensive (analysis|report|strategy|review)"
    r"|client (deliverable|presentation|proposal|report)"
    r")\b",
    re.IGNORECASE,
)

_SHORT = 30
_LONG = 500


def _heuristic(prompt: str) -> ModelTier:
    s = prompt.strip()
    n = len(s)
    if n < _SHORT and _TIER1_RE.search(s):
        return ModelTier.TIER1
    if _TIER3_RE.search(s) or n > _LONG:
        return ModelTier.TIER3
    if n < _SHORT:
        return ModelTier.TIER1
    return ModelTier.TIER2


async def classify(prompt: str) -> ModelTier:
    """
    Classify a prompt into a ModelTier.

    Fast-path: obvious Tier 1 / Tier 3 signals are caught by regex before
    any network call. Ambiguous messages go to the local Llama 3.2 3B
    classifier. Falls back to heuristics if Ollama is unreachable.
    """
    s = prompt.strip()
    n = len(s)

    # Fast-path for unambiguous cases — no LLM call needed
    if n < _SHORT and _TIER1_RE.search(s):
        return ModelTier.TIER1
    if _TIER3_RE.search(s) or n > _LONG:
        return ModelTier.TIER3

    # Ollama not configured — use heuristics
    if not settings.ollama_url:
        return _heuristic(prompt)

    try:
        async with httpx.AsyncClient(timeout=_CLASSIFY_TIMEOUT) as client:
            resp = await client.post(
                f"{settings.ollama_url}/api/chat",
                json={
                    "model": settings.classifier_model,
                    "messages": [
                        {"role": "system", "content": _CLASSIFY_SYSTEM},
                        {"role": "user", "content": s},
                    ],
                    "stream": False,
                    "options": {"num_predict": 5, "temperature": 0},
                },
            )
            resp.raise_for_status()
            raw = resp.json().get("message", {}).get("content", "").strip().lower()
            if "tier1" in raw:
                return ModelTier.TIER1
            if "tier3" in raw:
                return ModelTier.TIER3
            return ModelTier.TIER2
    except Exception as e:
        logger.warning("Classifier unavailable (%s) — using heuristic", e)
        return _heuristic(prompt)
