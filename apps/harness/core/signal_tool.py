"""
Letting a model put something on Today.

Signals normally come from detectors — deterministic sweeps over tasks, meetings
and mail. This is the other door: a scheduled job that went and looked at
something (a client portal, a dashboard) and found a thing Mike has to decide
about.

The value is in what it replaces. A prompt cron already writes its output into a
conversation, which means noticing something at 8am and hoping Mike opens that
chat. A Signal puts it on the surface he actually starts the day on.

Deliberately conservative: a Signal is a claim on attention, so this refuses to
raise one for "I looked and everything was normal". Nothing found is a valid,
common answer, and a Today full of all-clear notices is a Today nobody reads.
"""

import hashlib
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Signal

log = logging.getLogger(__name__)

VALID_URGENCY = {"normal", "time", "overdue"}


async def create_signal_from_tool(
    db: AsyncSession, user_id: str, tool_input: dict, *, source: str = "cron"
) -> str:
    title = (tool_input.get("title") or "").strip()
    if not title:
        return "create_signal needs a title saying what Mike has to decide or do."

    reasoning = (tool_input.get("reasoning") or "").strip()
    urgency = tool_input.get("urgency", "normal")
    if urgency not in VALID_URGENCY:
        urgency = "normal"

    # The caller supplies the identity of the THING, not of this run — otherwise
    # a weekly job raises the same signal every week and Today becomes noise.
    key_basis = (tool_input.get("dedupe_key") or title).strip().lower()
    dedupe_key = f"{source}:{hashlib.sha1(key_basis.encode()).hexdigest()[:16]}"

    # Checked against ANY status, so something dismissed stays dismissed. Same
    # rule the detectors use: re-nagging is how a triage surface loses trust.
    existing = (
        await db.execute(select(Signal).where(Signal.dedupe_key == dedupe_key))
    ).scalars().first()
    if existing:
        return (
            f"Already raised (signal is '{existing.status}'). Not raising a duplicate — "
            f"tell Mike in your summary instead."
        )

    signal = Signal(
        user_id=user_id,
        kind=tool_input.get("kind", "action"),
        source=source,
        source_label=tool_input.get("source_label") or source.title(),
        context_label=tool_input.get("context_label"),
        title=title[:300],
        urgency=urgency,
        reasoning=reasoning,
        citation=(tool_input.get("citation") or "")[:1000],
        actions=tool_input.get("actions") or [],
        dedupe_key=dedupe_key,
        status="open",
        created_at=datetime.now(timezone.utc),
    )
    db.add(signal)
    await db.commit()
    log.info("signal raised from %s tool: %s", source, title[:60])
    return f"Raised on Today: '{title}'."
