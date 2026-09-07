"""
Seed the signals table with realistic rows for /today development.

Dev utility, not part of any runtime path. Generation from real sources
(email, transcripts, calendar, projects) is a separate job; this exists so the
frontend can be built and reviewed against the real API before that lands.

Usage, from apps/harness with the venv active:

    python3 scripts/seed_signals.py          # insert if not already present
    python3 scripts/seed_signals.py --reset  # delete seeded rows first

Resolves the user via settings.tars_username rather than select(User).limit(1)
— picking an arbitrary user row is what caused the v2.15.9/v2.15.10 duplicate
ingestion bug.
"""
import asyncio
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, ".")

from sqlalchemy import select, delete  # noqa: E402
from core.config import settings  # noqa: E402
from db.models import Signal, User  # noqa: E402
from db.session import AsyncSessionLocal  # noqa: E402

SEED_PREFIX = "seed:"


def _rows(user_id: str) -> list[Signal]:
    now = datetime.now(timezone.utc)
    return [
        Signal(
            user_id=user_id,
            kind="action",
            source="gmail",
            source_label="Gmail",
            citation="Gmail · Contract redline v3 — J. Shorrock",
            title="Reply to J. Shorrock re: the AA Law contract redline",
            urgency="time",
            reasoning=(
                "Thread has been open 2 days with a direct question to you "
                "(\"can you confirm clause 7.2 by Monday?\"). No reply sent from "
                "any of your accounts. Monday is tomorrow."
            ),
            actions=[
                {"kind": "draft_reply", "label": "Draft reply"},
                {"kind": "create_task", "label": "Create task instead"},
                {"kind": "save_brain", "label": "Save thread to Second Brain"},
            ],
            dedupe_key=f"{SEED_PREFIX}aalaw-redline",
            created_at=now - timedelta(hours=2),
        ),
        Signal(
            user_id=user_id,
            kind="action",
            source="calendar",
            source_label="Calendar",
            citation="Calendar · Thu 11 Sep, 15:00–16:00",
            title="You're double-booked Thursday 15:00 — NCH sync vs. LickSleeve call",
            urgency="overdue",
            reasoning=(
                "Two accepted events overlap for the full hour. NCH sync is a "
                "recurring internal meeting; the LickSleeve call is a one-off with "
                "an external attendee, so the internal one is the cheaper move."
            ),
            actions=[
                {"kind": "move_event", "label": "Move NCH sync"},
                {"kind": "draft_reply", "label": "Ask LickSleeve to shift"},
            ],
            dedupe_key=f"{SEED_PREFIX}thu-double-book",
            created_at=now - timedelta(minutes=4),
        ),
        Signal(
            user_id=user_id,
            kind="action",
            source="fireflies",
            source_label="Fireflies",
            citation="Meeting · OpenRice PH — weekly sync",
            title="Send OpenRice the Q4 scope document you committed to",
            urgency="normal",
            reasoning=(
                "You said \"I'll get the scope over to you by end of week\" at "
                "34:12 in the OpenRice sync. No matching task, artifact, or sent "
                "email exists."
            ),
            actions=[
                {"kind": "create_task", "label": "Create task"},
                {"kind": "draft_reply", "label": "Draft the email now"},
                {"kind": "open_meeting", "label": "Open the meeting"},
            ],
            dedupe_key=f"{SEED_PREFIX}openrice-scope",
            created_at=now - timedelta(days=1),
        ),
        Signal(
            user_id=user_id,
            kind="action",
            source="fireflies",
            source_label="Fireflies",
            citation="Meeting · Entire Travel Group — campaign review",
            title="Entire Travel Group asked for a follow-up session before the 19th",
            urgency="normal",
            reasoning=(
                "Aaron asked to \"lock in another session before the 19th\" near the "
                "end of the call and nobody proposed a time. Your Tue and Wed "
                "mornings that week are clear."
            ),
            actions=[
                {"kind": "create_event", "label": "Schedule follow-up"},
                {"kind": "draft_reply", "label": "Ask Aaron for times"},
                {"kind": "create_task", "label": "Create task"},
            ],
            calendar_event={
                "title": "Entire Travel Group — follow-up session",
                "start": (now + timedelta(days=2)).replace(hour=2, minute=0, second=0, microsecond=0).isoformat(),
                "end": (now + timedelta(days=2)).replace(hour=3, minute=0, second=0, microsecond=0).isoformat(),
                "location": "Google Meet",
                "notes": "Follow-up requested during the campaign review call.",
            },
            dedupe_key=f"{SEED_PREFIX}etg-followup",
            created_at=now - timedelta(hours=3),
        ),
        Signal(
            user_id=user_id,
            kind="action",
            source="project",
            source_label="Projects",
            citation="Projects · NCH Inc. — Q4 deck",
            title="NCH Inc. deck v3 has been In Progress for 5 days with no movement",
            urgency="overdue",
            reasoning=(
                "Task moved to In Progress on 2 Sep and hasn't been touched since. "
                "Its due date passed yesterday. Either it's done, or it's stuck."
            ),
            actions=[
                {"kind": "open_meeting", "label": "Open project"},
                {"kind": "create_task", "label": "Split into smaller tasks"},
            ],
            dedupe_key=f"{SEED_PREFIX}nch-deck-stalled",
            created_at=now - timedelta(days=5),
        ),
        Signal(
            user_id=user_id,
            kind="fyi",
            source="gmail",
            source_label="Gmail",
            title="LickSleeve replied to the invoice thread — acknowledged, no ask.",
            urgency="normal",
            actions=[],
            dedupe_key=f"{SEED_PREFIX}licksleeve-ack",
            created_at=now - timedelta(hours=5),
        ),
        Signal(
            user_id=user_id,
            kind="fyi",
            source="strava",
            source_label="Strava",
            title="240 km logged this week. Longest ride since June.",
            urgency="normal",
            actions=[],
            dedupe_key=f"{SEED_PREFIX}strava-week",
            created_at=now - timedelta(hours=8),
        ),
    ]


async def main(reset: bool) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).where(User.name == settings.tars_username)
        )
        user = result.scalars().first()
        if not user:
            result = await db.execute(select(User))
            user = result.scalars().first()
        if not user:
            print("No user found — create one first.")
            return

        if reset:
            await db.execute(
                delete(Signal).where(
                    Signal.user_id == user.id,
                    Signal.dedupe_key.like(f"{SEED_PREFIX}%"),
                )
            )
            await db.commit()
            print("Cleared previously seeded signals.")

        existing = await db.execute(
            select(Signal.dedupe_key).where(
                Signal.user_id == user.id,
                Signal.dedupe_key.like(f"{SEED_PREFIX}%"),
            )
        )
        have = {k for (k,) in existing.all()}

        added = 0
        for row in _rows(user.id):
            if row.dedupe_key in have:
                continue
            db.add(row)
            added += 1
        await db.commit()
        print(f"Seeded {added} signal(s) for user {user.name} ({user.id}).")


if __name__ == "__main__":
    asyncio.run(main(reset="--reset" in sys.argv))
