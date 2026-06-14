"""
Tier classifier — routes each request to the right model tier.

Primary path: regex fast-paths (instant) → Haiku API for ambiguous cases (~200ms).
Fallback: heuristics (instant, used when Anthropic API is unreachable).

Tiers:
  tier1 — simple, fast   → Claude Haiku   (quick Q&A, lookups, short replies)
  tier2 — standard       → RunPod 32B     (writing, coding, analysis, most tasks)
  tier3 — frontier       → Claude Sonnet  (strategy, long docs, client work, ALL tools)
"""

import re
import logging
from typing import Optional

from core.model_client import ModelTier
from core.config import settings

logger = logging.getLogger(__name__)


# ── No-op stubs ───────────────────────────────────────────────────────────────
# main.py imports these for the Ollama keepalive. Ollama is no longer used for
# classification; these stubs preserve the import contract without breaking startup.

def _ollama_available() -> bool: return True
def _ollama_mark_failed() -> None: pass
def _ollama_mark_recovered() -> None: pass


# ── Classification prompt ─────────────────────────────────────────────────────

_CLASSIFY_SYSTEM = (
    "You are a routing classifier. Reply with ONLY one word — no explanation.\n\n"
    "tier1 — read-only lookups answered directly from context: "
    "'what's on my calendar', 'show my tasks', 'how many meetings today', "
    "'what time is X', 'list my open tasks'\n"
    "tier2 — standard work needing reasoning but no actions: "
    "writing, coding, analysis, summarization, research, explaining, most chat\n"
    "tier3 — ANY of the following: "
    "(a) actions that change state: create/add/book/schedule/remind/mark/cancel/update/track/follow-up/note/log/capture; "
    "(b) requests that need tools or web search (current events, live prices, recent news, real-time data); "
    "(c) document/file generation: create a document/report/PDF/PPTX/DOCX/presentation/slide deck; "
    "(d) data visualization: plot/chart/graph/visualize/draw a chart/show a graph/make a chart; "
    "(e) frontier tasks: strategy, proposals, client deliverables, deep analysis. "
    "Default to tier3 whenever there is any doubt.\n\n"
    "Reply with exactly one word: tier1, tier2, or tier3"
)


# ── Regex fast-paths ──────────────────────────────────────────────────────────

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

# Tesla / vehicle queries — always need get_tesla_status or tesla_command (Tier 3 tools only)
_TESLA_RE = re.compile(
    r"\b("
    r"tesla|model [s3xy]\b|my car|the car"
    r"|charging|charge (level|limit|rate|status|port|my car)"
    r"|battery (level|percent|range|status|charge)"
    r"|range (left|remaining)"
    r"|is it (charging|locked|parked|plugged)"
    r"|lock|unlock (the )?(car|tesla|vehicle|doors?)"
    r"|climate|heat|cool (down|off|the car)|ac|air con|defrost"
    r"|sentry (mode)?"
    r"|frunk|trunk|boot"
    r"|vent windows|close windows"
    r"|honk|flash (lights|the lights)"
    r"|remote start"
    r"|where('?s| is) (the |my )?(car|tesla|vehicle)"
    r"|odometer|software (version|update)"
    r"|supercharg|charge (at home|session)"
    r")\b",
    re.IGNORECASE,
)

_TIER3_RE = re.compile(
    r"\b("
    # Writing with adjectives (existing)
    r"write (a |an |the |me )?(full|complete|detailed|comprehensive|long)"
    # Writing any document type, no adjective required
    r"|write (a |an |the |me )?(document|report|proposal|brief|memo|summary|plan|strategy|analysis|doc)"
    r"|write up (a |an )?"
    # Create / generate / make / build / prepare / put together
    r"|create (a |an )?(strategy|proposal|report|presentation|slide.?deck|document|docx|pptx|pdf|deck|brief|memo|plan)"
    r"|draft (a |an )?(proposal|contract|strategy|email|memo|document|report|brief|plan)"
    r"|generate (a |an )?(document|report|presentation|pdf|docx|pptx|slide|deck|brief)"
    r"|make (a |an )?(presentation|slide.?deck|report|document|pdf|deck|brief|proposal)"
    r"|build (a |an )?(presentation|slide.?deck|deck|document|report)"
    r"|prepare (a |an )?(document|report|presentation|brief|proposal|summary|deck)"
    r"|put together (a |an )?(document|report|presentation|deck|brief|proposal)"
    # Frontier / deep work
    r"|deep (dive|analysis|review)"
    r"|comprehensive (analysis|report|strategy|review)"
    r"|client (deliverable|presentation|proposal|report)"
    # Web search signals
    r"|search (the |online|web|internet|for )"
    r"|look (it |this |that )?up online"
    r"|find (me )?(information|details|news) (about|on)"
    r"|what.?s (the )?(latest|current|recent|new)"
    r"|is .{0,30} (still|currently|now)"
    r"|current (price|status|version|news|update)"
    r"|latest (news|update|version|release|price)"
    r"|live (data|price|rate|status)"
    # Data visualization — always needs generate_chart tool (Tier 3 only)
    r"|plot (a |an |me |the )?(chart|graph|bar|line|scatter|pie|histogram|heatmap|figure)"
    r"|(make|create|generate|draw|show|build|produce|render) (a |an |me |the )?(chart|graph|plot|visualization|figure|heatmap|histogram)"
    r"|visuali[sz]e"
    r"|bar chart|line chart|line graph|pie chart|scatter plot|heatmap|histogram"
    # Local search / places — needs the search_places tool (Tier 3 only)
    r"|(coffee shop|coffee place|cafe|café|restaurant|diner|bistro|brewery|pub|eatery|bakery|pharmacy|drugstore|gas station|petrol station)s?\b"
    r"|near ?(me|by|here)"
    r"|nearby"
    r"|where (can i|to) (get|buy|find|eat|grab|stay)"
    r"|directions? (to|from)"
    r"|how (do i|to) get to"
    r"|find (me )?(a |an |the )?(place|spot|coffee|cafe|café|restaurant|bar|hotel|gym|bakery|pharmacy)"
    r"|recommend (a |an |me |some )?(place|spot|coffee|cafe|café|restaurant|bar|hotel|gym|bakery)"
    # Weather — needs a tool / live data (Tier 3 only)
    r"|weather|forecast|(temperature|how (hot|cold|warm)) (today|tomorrow|outside|now|this)|is it (going to |gonna )?rain"
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
    if _TESLA_RE.search(s):
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

    Fast-path: obvious Tier 1 / Tier 3 signals are caught by regex (instant).
    Ambiguous messages go to Claude Haiku (~200ms, near-zero cost).
    Falls back to heuristics if Anthropic API is unreachable.
    """
    s = prompt.strip()
    n = len(s)

    # Fast-path for unambiguous cases — no API call needed
    if _ACTION_RE.search(s):
        return ModelTier.TIER3
    if _TESLA_RE.search(s):
        return ModelTier.TIER3
    if n < _SHORT and _TIER1_RE.search(s):
        return ModelTier.TIER1
    if _PERSONAL_RE.search(s):
        return ModelTier.TIER3
    if _TIER3_RE.search(s) or n > _LONG:
        return ModelTier.TIER3

    # No key for the tier1 provider — use heuristics (instant)
    provider = settings.tier1_provider
    key = settings.zai_api_key if provider == "zai" else settings.anthropic_api_key
    if not key:
        return _heuristic(prompt)

    # Ambiguous — ask the tier1 model (~200ms, max_tokens=5)
    # Uses whichever provider is configured for tier1 (Anthropic or Z.ai)
    model = settings.tier1_model_override or (
        "glm-4.5-air" if provider == "zai" else settings.tier1_model
    )
    try:
        import anthropic as _anthropic
        base_url = settings.zai_base_url if provider == "zai" else None
        _aclient = _anthropic.AsyncAnthropic(api_key=key, **({"base_url": base_url} if base_url else {}))
        resp = await _aclient.messages.create(
            model=model,
            max_tokens=5,
            system=_CLASSIFY_SYSTEM,
            messages=[{"role": "user", "content": s}],
        )
        raw = resp.content[0].text.strip().lower()
        if "tier1" in raw:
            return ModelTier.TIER1
        if "tier3" in raw:
            return ModelTier.TIER3
        return ModelTier.TIER2
    except Exception as e:
        logger.warning("Haiku classifier failed (%s) — using heuristic", e)
        return _heuristic(prompt)
