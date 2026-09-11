"""
Shared [[id|type|label]] mention-marker helpers.

Promoted out of api/routes/chat.py (v2.19.7) so other routes that only need
to strip markers or pull out raw mention refs — not chat's full
_resolve_mentions, which also fetches entity context for injection into the
live composer's prompt — don't need to import a module-private name across
route files. chat.py's own _MENTION_RE / _strip_mention_markers now delegate
here instead of keeping a second copy of the regex.
"""
import re
from typing import List, NamedTuple

MENTION_RE = re.compile(r"\[\[([^\]|]+)\|([^\]|]+)\|([^\]]+)\]\]")


class MentionRef(NamedTuple):
    id: str
    type: str
    label: str


def strip_mention_markers(text: str) -> str:
    """Replace [[id|type|label]] with just the human-readable label — for
    feeding into a prompt that has no use for the raw entity id and would
    otherwise see literal id/type soup in the text."""
    return MENTION_RE.sub(lambda m: m.group(3), text or "")


def extract_mentions(text: str) -> List[MentionRef]:
    """Every distinct mention in wire-format text, in order of first
    appearance. Distinct by (type, id) — the same entity mentioned twice
    only appears once."""
    seen: set = set()
    out: List[MentionRef] = []
    for m in MENTION_RE.finditer(text or ""):
        key = (m.group(2), m.group(1))
        if key in seen:
            continue
        seen.add(key)
        out.append(MentionRef(id=m.group(1), type=m.group(2), label=m.group(3)))
    return out
