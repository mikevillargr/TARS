"""
Tier classifier — routes each request to the right model tier.

Tier 1 (fast):    Simple lookups, state changes, quick Q&A
Tier 2 (default): Most tasks — summaries, writing, coding, analysis
Tier 3 (frontier): Complex reasoning, client deliverables, long docs, low confidence
"""

import re
from core.model_client import ModelTier

# Patterns that map directly to Tier 1 — fast, low complexity
_TIER1_PATTERNS = re.compile(
    r"\b("
    r"what('s| is) (on |my )?(my |the )?(calendar|schedule|tasks?|todo)"
    r"|mark (that |it |task )?(as )?(done|complete|finished)"
    r"|remind me"
    r"|what time"
    r"|set (a |the )?(timer|alarm|reminder)"
    r"|add (a |to )?(task|reminder|note)"
    r"|show me (my )?(tasks?|calendar|schedule)"
    r"|how many (tasks?|meetings?)"
    r")\b",
    re.IGNORECASE,
)

# Patterns that force Tier 3 — frontier needed
_TIER3_PATTERNS = re.compile(
    r"\b("
    r"write (a |an |the |me )?(full|complete|detailed|comprehensive|long)"
    r"|analyze (this |the )?(document|file|pdf|deck|report|data)"
    r"|create (a |an )?(strategy|proposal|presentation|deck|report|plan)"
    r"|(summarize|summary of) (this |the )?(document|article|pdf|deck|transcript|report|contract|agreement)"
    r"|review (this |the )?(document|contract|agreement|proposal)"
    r"|draft (a |an )?(email|proposal|contract|report|plan|strategy)"
    r"|compare (these|the|this)"
    r"|deep (dive|analysis|review)"
    r")\b",
    re.IGNORECASE,
)

# Short messages are almost always Tier 1 or 2
_SHORT_THRESHOLD = 30
_LONG_THRESHOLD = 500


def classify(prompt: str) -> ModelTier:
    """Classify a user prompt into a model tier."""
    stripped = prompt.strip()
    length = len(stripped)

    if length < _SHORT_THRESHOLD and _TIER1_PATTERNS.search(stripped):
        return ModelTier.TIER1

    if _TIER3_PATTERNS.search(stripped) or length > _LONG_THRESHOLD:
        return ModelTier.TIER3

    if length < _SHORT_THRESHOLD:
        return ModelTier.TIER1

    return ModelTier.TIER2
