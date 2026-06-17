"""
Tier classifier — routes each request to the right model tier based on complexity.

Primary path: regex fast-paths (instant) → tier1 model API for ambiguous cases (~200ms).
Fallback: heuristics (instant, used when API is unreachable).

Tiers:
  tier1 — simple/fast    quick Q&A, single tool calls (status lookups, task reads)
  tier2 — standard       writing, coding, analysis, multi-step reasoning, most chat
  tier3 — frontier       strategy, long docs, client deliverables, complex tool chains

All tiers have tool access. Routing is purely complexity-based.
Any tier can call request_escalation to hand off to the next tier up.
"""

import re
import logging
from typing import Optional, Tuple

from core.model_client import ModelTier
from core.config import settings

logger = logging.getLogger(__name__)


# ── Task categories ───────────────────────────────────────────────────────────
# Used by the forced-model override system (Settings → Task-Category Routing).
# Detection is regex-first (instant); the tier-1 classifier refines ambiguous
# cases by emitting a category token alongside the tier.

CATEGORIES = ("quick_lookup", "writing", "coding", "data_viz", "analysis", "general")


# ── No-op stubs ───────────────────────────────────────────────────────────────
# main.py imports these for the Ollama keepalive. Ollama is no longer used for
# classification; these stubs preserve the import contract without breaking startup.

def _ollama_available() -> bool: return True
def _ollama_mark_failed() -> None: pass
def _ollama_mark_recovered() -> None: pass


# ── Classification prompt ─────────────────────────────────────────────────────

_CLASSIFY_SYSTEM = (
    "You are a routing classifier. Reply with EXACTLY two words separated by a "
    "space — a tier and a category — no explanation.\n\n"
    "TIER (first word):\n"
    "tier1 — simple, fast requests: status lookups, single tool calls, short Q&A. "
    "Examples: 'what's my battery?', 'what's on my calendar', 'show my tasks', "
    "'lock the car', 'what's my Strava this week'\n"
    "tier2 — standard work: writing, coding, analysis, summarization, research, "
    "multi-step reasoning, most chat\n"
    "tier3 — ANY of the following: "
    "(a) actions that change state: create/add/book/schedule/remind/mark/cancel/update/track/follow-up/note/log/capture; "
    "(b) requests needing web search (current events, live prices, recent news); "
    "(c) document/file generation: create a document/report/PDF/PPTX/DOCX/presentation/slide deck; "
    "(d) data visualization: plot/chart/graph/visualize/draw a chart/show a graph/make a chart; "
    "(e) frontier tasks: strategy, proposals, client deliverables, deep analysis. "
    "Default to tier3 whenever there is any doubt.\n\n"
    "CATEGORY (second word):\n"
    "quick_lookup — status checks, single-tool reads, short factual Q&A\n"
    "writing — drafting prose: documents, reports, proposals, emails, memos, summaries, decks\n"
    "coding — writing/debugging code, technical/programming questions\n"
    "data_viz — charts, plots, graphs, visualizing data\n"
    "analysis — strategy, deep analysis, research synthesis, client deliverables\n"
    "general — conversational or anything that fits none of the above\n\n"
    "Reply with exactly two words, e.g. 'tier2 writing' or 'tier1 quick_lookup'."
)


# ── Regex fast-paths ──────────────────────────────────────────────────────────

# Pure read-only lookup patterns — quick Tier 1 Q&A
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

# Action patterns — always Tier 3 (state-changing tool calls)
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
    # Local search / places — needs the search_places tool
    r"|(coffee shop|coffee place|cafe|café|restaurant|diner|bistro|brewery|pub|eatery|bakery|pharmacy|drugstore|gas station|petrol station)s?\b"
    r"|near ?(me|by|here)"
    r"|nearby"
    r"|where (can i|to) (get|buy|find|eat|grab|stay)"
    r"|directions? (to|from)"
    r"|how (do i|to) get to"
    r"|find (me )?(a |an |the )?(place|spot|coffee|cafe|café|restaurant|bar|hotel|gym|bakery|pharmacy)"
    r"|recommend (a |an |me |some )?(place|spot|coffee|cafe|café|restaurant|bar|hotel|gym|bakery)"
    # Weather — needs a tool / live data
    r"|weather|forecast|(temperature|how (hot|cold|warm)) (today|tomorrow|outside|now|this)|is it (going to |gonna )?rain"
    r")\b",
    re.IGNORECASE,
)

# Personal/self-referential queries — route to Tier 3 for reliable context handling
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

# ── Category fast-paths ───────────────────────────────────────────────────────
# Focused regexes used only for category detection (the tier regexes above mix
# many signals, so categories get their own dedicated patterns). Checked in the
# order data_viz → coding → writing → analysis → quick_lookup → general.

_DATAVIZ_RE = re.compile(
    r"\b("
    r"plot (a |an |me |the )?(chart|graph|bar|line|scatter|pie|histogram|heatmap|figure)"
    r"|(make|create|generate|draw|show|build|produce|render) (a |an |me |the )?(chart|graph|plot|visualization|figure|heatmap|histogram)"
    r"|visuali[sz]e"
    r"|bar chart|line chart|line graph|pie chart|scatter plot|heatmap|histogram"
    r")\b",
    re.IGNORECASE,
)

_CODING_RE = re.compile(
    r"\b("
    r"write (me )?(a |an |some )?(code|function|method|class|script|program|query|regex|test)"
    r"|(fix|debug|refactor|optimi[sz]e|review|explain) (this |my |the )?(code|function|bug|error|script|snippet|query)"
    r"|implement (a |an |the )?"
    r"|stack ?trace|traceback|compile (error|time)|runtime error|syntax error"
    r"|(python|javascript|typescript|java|kotlin|rust|golang|c\+\+|sql|bash|shell) (code|function|script|snippet)"
    r"|regex|regular expression"
    r"|unit test|api endpoint|pull request|git (rebase|merge|commit)"
    r"|how (do i|to) (code|write|implement|fix|debug)"
    r")\b",
    re.IGNORECASE,
)

_WRITING_RE = re.compile(
    r"\b("
    r"write (a |an |the |me ?(a |an )?)?(full|complete|detailed|comprehensive|long|short|quick)? ?(document|report|proposal|brief|memo|summary|plan|email|letter|post|article|doc|blog|caption|copy)"
    r"|write up (a |an )?"
    r"|draft (a |an )?(proposal|contract|email|memo|document|report|brief|plan|letter|message|reply|response)"
    r"|(create|generate|make|build|prepare|put together) (a |an )?(presentation|slide.?deck|deck|document|docx|pptx|pdf|report|brief|memo|proposal|summary)"
    r"|rewrite|reword|rephrase|proofread|polish (this|the|my)"
    r"|summari[sz]e (this|the|my|it)"
    r"|reply (to|with) (this|the|an?|my)? ?(email|message|thread)"
    r")\b",
    re.IGNORECASE,
)

_ANALYSIS_RE = re.compile(
    r"\b("
    r"deep (dive|analysis|review)"
    r"|comprehensive (analysis|report|strategy|review)"
    r"|client (deliverable|presentation|proposal|report)"
    r"|analy[sz]e (this|the|my|these|our)"
    r"|(strategy|strategic) (for|plan|recommendation)"
    r"|research (the|on|about|into)"
    r"|compare (and contrast|the|these|our)"
    r"|evaluate (the|these|our|my)"
    r"|pros and cons|trade.?offs?"
    r")\b",
    re.IGNORECASE,
)

_SHORT = 30
_LONG = 500


def classify_category(prompt: str) -> str:
    """Regex-based task category. Instant; defaults to 'general'."""
    s = prompt.strip()
    if _DATAVIZ_RE.search(s):
        return "data_viz"
    if _CODING_RE.search(s):
        return "coding"
    if _WRITING_RE.search(s):
        return "writing"
    if _ANALYSIS_RE.search(s):
        return "analysis"
    if _TIER1_RE.search(s):
        return "quick_lookup"
    return "general"


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


async def classify_full(prompt: str) -> Tuple[ModelTier, str]:
    """
    Classify a prompt into (ModelTier, category).

    Fast-path: obvious Tier 1 / Tier 3 signals are caught by regex (instant);
    the category comes from classify_category in those cases.
    Ambiguous messages go to the Tier 1 model API (~200ms, near-zero cost),
    which returns both a tier and a category token.
    Falls back to heuristics if the API is unreachable.
    """
    s = prompt.strip()
    n = len(s)
    cat = classify_category(s)

    # Fast-path for unambiguous cases — no API call needed
    if _ACTION_RE.search(s):
        return ModelTier.TIER3, cat
    if n < _SHORT and _TIER1_RE.search(s):
        return ModelTier.TIER1, cat
    if _PERSONAL_RE.search(s):
        return ModelTier.TIER3, cat
    if _TIER3_RE.search(s) or n > _LONG:
        return ModelTier.TIER3, cat

    # No key for the tier1 provider — use heuristics (instant)
    provider = settings.tier1_provider
    key = settings.zai_api_key if provider == "zai" else settings.anthropic_api_key
    if not key:
        return _heuristic(prompt), cat

    # Ambiguous — ask the tier1 model (~200ms, max_tokens=8 for two tokens)
    model = settings.tier1_model_override or (
        "glm-4.5-air" if provider == "zai" else settings.tier1_model
    )
    try:
        import anthropic as _anthropic
        base_url = settings.zai_base_url if provider == "zai" else None
        _aclient = _anthropic.AsyncAnthropic(api_key=key, **({"base_url": base_url} if base_url else {}))
        resp = await _aclient.messages.create(
            model=model,
            max_tokens=8,
            system=_CLASSIFY_SYSTEM,
            messages=[{"role": "user", "content": s}],
        )
        raw = resp.content[0].text.strip().lower()
        # Refine the category from the model's second token when valid.
        model_cat = next((c for c in CATEGORIES if c in raw), None)
        if model_cat:
            cat = model_cat
        if "tier1" in raw:
            return ModelTier.TIER1, cat
        if "tier3" in raw:
            return ModelTier.TIER3, cat
        return ModelTier.TIER2, cat
    except Exception as e:
        logger.warning("Tier1 classifier failed (%s) — using heuristic", e)
        return _heuristic(prompt), cat


async def classify(prompt: str) -> ModelTier:
    """Thin wrapper returning just the tier (back-compat for tier-only callers)."""
    tier, _ = await classify_full(prompt)
    return tier
