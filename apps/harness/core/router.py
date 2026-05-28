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

_CLASSIFY_TIMEOUT = 2.0

_CLASSIFY_SYSTEM = (
    "You are a routing classifier. Reply with ONLY one word — no explanation.\n\n"
    "tier1 — lookup only: questions answered from context (what's on my calendar, "
    "show my tasks, how many meetings today)\n"
    "tier2 — standard work: writing, coding, analysis, summarization, research, "
    "multi-step tasks, most conversations\n"
    "tier3 — actions OR frontier: ANY request to create/add/book/schedule/remind/"
    "mark/cancel/update something, plus strategy, documents, client deliverables, "
    "deep analysis. When in doubt between tier1 and tier3, choose tier3.\n\n"
    "Reply with exactly: tier1, tier2, or tier3"
)

# Pure lookup patterns — no tool execution needed
_TIER1_RE = re.compile(
    r"\b("
    r"what('s| is) (on |my )?(my |the )?(calendar|schedule|tasks?|todo)"
    r"|show me (my )?(tasks?|calendar|schedule)"
    r"|how many (tasks?|meetings?)"
    r"|what time"
    r")\b",
    re.IGNORECASE,
)

# Action patterns — require tool execution, always use Claude
_ACTION_RE = re.compile(
    r"\b("
    r"add (a |to )?(task|reminder|note|event|meeting|appointment)"
    r"|create (a |an )?(task|reminder|event|meeting|appointment)"
    r"|book (a |the )?(meeting|call|appointment|time|slot)"
    r"|schedule (a |the )?(meeting|call|appointment|event)"
    r"|set (a |the )?(reminder|alarm)"
    r"|remind me (to |about )?"
    r"|put (it |this |that |on )?(my )?(calendar|tasks?|inbox)"
    r"|add (it|this|that) to (my )?(tasks?|calendar|inbox)"
    r"|mark (that |it |this |the |task )?(as )?(done|complete|finished|in.?progress|todo)"
    r"|block (time|off|out)"
    r"|cancel (the |this |that )?(meeting|event|appointment|call)"
    r"|include .{0,40} in (the |this )?(meeting|event|call|invite)"
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

# Personal/self-referential queries — always Claude (small models don't use context well)
_PERSONAL_RE = re.compile(
    r"\b("
    r"what do you know about me"
    r"|tell me about (my|myself)"
    r"|what.?s my (name|job|role|work|background|preference|style)"
    r"|who am i"
    r"|do you (know|remember) (me|who i am)"
    r"|what have (i|we) (talked|discussed|said)"
    r"|what do you remember"
    r"|my (background|profile|preferences?|history)"
    r")\b",
    re.IGNORECASE,
)

_SHORT = 30
_LONG = 500


def _heuristic(prompt: str) -> ModelTier:
    s = prompt.strip()
    n = len(s)
    if _ACTION_RE.search(s):
        return ModelTier.TIER3
    if n < _SHORT and _TIER1_RE.search(s):
        return ModelTier.TIER1
    if _PERSONAL_RE.search(s):
        return ModelTier.TIER3
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
    if _ACTION_RE.search(s):
        return ModelTier.TIER3  # always Claude for tool execution
    if n < _SHORT and _TIER1_RE.search(s):
        return ModelTier.TIER1
    if _PERSONAL_RE.search(s):
        return ModelTier.TIER3
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
