"""
Tier classifier — routes each request to the right model tier.

Primary path: Llama 3.2 3B via local Ollama on the KVM4 (~1-3s CPU inference).
Fallback: regex + length heuristics (instant, used when Ollama is unavailable).

Tiers:
  tier1 — simple, fast   → Qwen3 8B   (quick Q&A, state changes, lookups)
  tier2 — standard       → Qwen3 32B  (writing, coding, analysis, most tasks)
  tier3 — frontier       → Claude     (strategy, long docs, client deliverables,
                                        ANY tool/action execution)
"""

import re
import time
import logging
import httpx
from typing import Optional

from core.model_client import ModelTier
from core.config import settings

logger = logging.getLogger(__name__)

_CLASSIFY_TIMEOUT = 3.0   # slightly above Ollama's ~2.5s warm response time

# After a classifier failure, skip network calls until the keepalive recovers it.
# The keepalive task (started in main.py lifespan) probes every 30s when down
# and clears this flag as soon as Ollama responds again.
_OLLAMA_BACKOFF = 120.0
_ollama_failed_at: Optional[float] = None


def _ollama_available() -> bool:
    global _ollama_failed_at
    if _ollama_failed_at is None:
        return True
    if (time.monotonic() - _ollama_failed_at) >= _OLLAMA_BACKOFF:
        _ollama_failed_at = None
        return True
    return False


def _ollama_mark_failed() -> None:
    global _ollama_failed_at
    if _ollama_failed_at is None:
        logger.warning("Ollama classifier marked unavailable — keepalive will restore")
    _ollama_failed_at = time.monotonic()


def _ollama_mark_recovered() -> None:
    global _ollama_failed_at
    if _ollama_failed_at is not None:
        logger.info("Ollama classifier recovered")
    _ollama_failed_at = None


_CLASSIFY_SYSTEM = (
    "You are a routing classifier. Reply with ONLY one word — no explanation.\n\n"
    "tier1 — read-only lookups answered directly from context: "
    "'what's on my calendar', 'show my tasks', 'how many meetings today', "
    "'what time is X', 'list my open tasks'\n"
    "tier2 — standard work needing reasoning but no actions: "
    "writing, coding, analysis, summarization, research, explaining, most chat\n"
    "tier3 — ANY of the following: "
    "(a) actions that change state: create/add/book/schedule/remind/mark/cancel/update/track/follow-up/note/log/capture; "
    "(b) requests that need tools or web search; "
    "(c) frontier tasks: strategy, proposals, client deliverables, deep analysis. "
    "Default to tier3 whenever there is any doubt.\n\n"
    "Reply with exactly one word: tier1, tier2, or tier3"
)

# Pure read-only lookup patterns — no tools needed
_TIER1_RE = re.compile(
    r"\b("
    r"what('s| is) (on |my )?(my |the )?(calendar|schedule|tasks?|todo)"
    r"|show (me )?(my )?(tasks?|calendar|schedule|inbox)"
    r"|how many (tasks?|meetings?|events?)"
    r"|what time"
    r"|list (my )?(tasks?|meetings?|events?|appointments?)"
    r")\b",
    re.IGNORECASE,
)

# Action patterns — always TIER3 (require tool execution via Claude)
_ACTION_RE = re.compile(
    r"\b("
    # Explicit create/add
    r"add (a |an |to )?(task|reminder|note|event|meeting|appointment|todo|follow.?up)"
    r"|create (a |an )?(task|reminder|event|meeting|appointment|todo)"
    r"|new (task|reminder|event|meeting|appointment|todo)"
    r"|make (a |an )?(task|note|reminder|meeting|appointment|to.?do)"
    # Book/schedule
    r"|book (a |the |an )?(meeting|call|appointment|time|slot)"
    r"|schedule (a |the |an )?(meeting|call|appointment|event)"
    # Remind
    r"|set (a |the )?(reminder|alarm)"
    r"|remind me (to |about |of )?"
    r"|don.?t let me forget"
    # Put on list / calendar
    r"|put (it |this |that |on )?(my )?(calendar|tasks?|inbox|list)"
    r"|add (it|this|that) to (my )?(tasks?|calendar|inbox|list)"
    r"|track (this|it|that|the)"
    # Mark status
    r"|mark (that |it |this |the |task )?(as )?(done|complete|finished|in.?progress|todo|closed)"
    r"|complete (the |this |that )?task"
    r"|close (the |this |that )?task"
    # Follow-up / capture
    r"|follow.?up"
    r"|note (to self|this down|that down|this for|that for)"
    r"|jot (this|it|that) down"
    r"|log (this|a|the|it)"
    r"|capture (this|it|that)"
    r"|take note"
    # Block / cancel
    r"|block (time|off|out)"
    r"|cancel (the |this |that )?(meeting|event|appointment|call)"
    # Include in invite
    r"|include .{0,40} in (the |this )?(meeting|event|call|invite)"
    r")\b",
    re.IGNORECASE,
)

_TIER3_RE = re.compile(
    r"\b("
    r"write (a |an |the |me )?(full|complete|detailed|comprehensive|long)"
    r"|create (a |an )?(strategy|proposal|report)"
    r"|draft (a |an )?(proposal|contract|strategy|email|memo)"
    r"|deep (dive|analysis|review)"
    r"|comprehensive (analysis|report|strategy|review)"
    r"|client (deliverable|presentation|proposal|report)"
    r"|search (the |online|web|internet|for )"
    r"|look (it |this |that )?up online"
    r"|find (me )?(information|details|news) (about|on)"
    r")\b",
    re.IGNORECASE,
)

# Personal/self-referential queries — small models struggle with injected context
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
    When Ollama has recently failed, skips the network call entirely to
    avoid paying the timeout cost on every request.
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

    # Ollama not configured or known-down — use heuristics (instant)
    if not settings.ollama_url or not _ollama_available():
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
        _ollama_mark_failed()
        logger.warning("Classifier unavailable (%s) — using heuristic for %.0fs", e, _OLLAMA_BACKOFF)
        return _heuristic(prompt)
