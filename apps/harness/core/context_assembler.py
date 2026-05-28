"""
Context assembler — builds the system prompt for each conversation turn.
Queries Mnemon (episodic), Second Brain (semantic), and live connectors (Gmail)
when the query warrants it.
"""

import asyncio
import logging
import re
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

_EMAIL_RE = re.compile(
    r"\b(email|emails|gmail|inbox|unread|messages?|threads?|"
    r"mail|wrote to me|sent me|received|newsletter|reply|replied|"
    r"forwarded|attachment|subject line)\b",
    re.IGNORECASE,
)

_CALENDAR_RE = re.compile(
    r"\b(calendar|meeting|meetings|schedule|scheduled|event|events|"
    r"appointment|appointments|today|tomorrow|this week|next week|"
    r"what.s on|what do i have|busy|free|available|availability|"
    r"call|calls|standup|stand.?up)\b",
    re.IGNORECASE,
)

def _format_event_time(start: str, all_day: bool, tz_name: str = "UTC") -> str:
    if not start:
        return ""
    if all_day:
        try:
            from datetime import date
            d = date.fromisoformat(start)
            return d.strftime("%a %b %-d")
        except Exception:
            return start
    try:
        from datetime import datetime
        from zoneinfo import ZoneInfo
        dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        local = dt.astimezone(ZoneInfo(tz_name))
        return local.strftime("%a %b %-d, %-I:%M %p")
    except Exception:
        return start


SYSTEM_TEMPLATE = """You are TARS, Mike Villar's personal AI operating system.

You are direct, precise, and efficient - like your namesake from Interstellar. \
You don't over-explain. You get things done.

You have access to Mike's full context through memory retrieval. \
You know his work, his clients, his projects, his priorities, and his personal life. \
Use that context naturally without announcing that you're doing so.

Mike is CEO of Growth Rocket, a digital marketing agency based in Metro Manila. \
His active clients include NCH Inc., AA Law, OpenRice Philippines, LickSleeve, \
and Entire Travel Group. He is a randonneur and cyclist. He manages his health actively.

[MEMORY CONTEXT]
{mnemon_context}

[RELEVANT KNOWLEDGE]
{second_brain_context}
{gmail_section}{gcal_section}
[ACTIVE CONTEXT]
Timezone: {user_timezone}
{active_tasks_count} open tasks
{todays_meetings} today
Last interaction: {last_seen}

Always express dates and times in the user's timezone ({user_timezone}) unless explicitly asked otherwise.

Respond as TARS. Honest, capable, no unnecessary padding. Humor setting: 75%."""


async def _fetch_gmail_context(db: AsyncSession, user_id: str) -> str:
    try:
        from sqlalchemy import select
        from db.models import Connector
        result = await db.execute(
            select(Connector).where(
                Connector.user_id == user_id,
                Connector.name == "Gmail",
            )
        )
        conn = result.scalar_one_or_none()
        if not conn or not conn.auth.get("refresh_token"):
            return ""

        from connectors.gmail import GmailClient
        loop = asyncio.get_event_loop()
        client = GmailClient(conn.auth)
        summaries = await loop.run_in_executor(None, lambda: client.get_inbox_summary(12))

        if not summaries:
            return "\n[GMAIL]\nInbox is empty.\n"

        unread = [s for s in summaries if s["unread"]]
        read   = [s for s in summaries if not s["unread"]]

        lines = ["\n[GMAIL — LIVE INBOX]"]
        if unread:
            lines.append(f"Unread ({len(unread)}):")
            for s in unread:
                lines.append(f"  • {s['from_name']}: {s['subject']} — {s['snippet'][:120]}")
        if read:
            lines.append(f"Recent read ({len(read)}):")
            for s in read[:5]:
                lines.append(f"  · {s['from_name']}: {s['subject']} — {s['snippet'][:80]}")
        lines.append("")
        return "\n".join(lines)

    except Exception as exc:
        log.warning("Gmail context fetch failed: %s", exc)
        return ""


async def _fetch_gcal_context(db: AsyncSession, user_id: str, tz_name: str = "Asia/Manila") -> str:
    try:
        from sqlalchemy import select
        from db.models import Connector
        result = await db.execute(
            select(Connector).where(
                Connector.user_id == user_id,
                Connector.name == "Google Calendar",
            )
        )
        conn = result.scalar_one_or_none()
        if not conn or not conn.auth.get("refresh_token"):
            return ""

        from connectors.google_calendar import GoogleCalendarClient
        loop = asyncio.get_event_loop()
        client = GoogleCalendarClient(conn.auth)
        events = await loop.run_in_executor(None, lambda: client.get_upcoming_summary(days=7, max_results=15))

        if not events:
            return "\n[CALENDAR — UPCOMING]\nNo events in the next 7 days.\n"

        lines = [f"\n[CALENDAR — UPCOMING EVENTS ({tz_name})]"]
        for e in events:
            time_str = _format_event_time(e["start"], e["all_day"], tz_name)
            line = f"  • {time_str} — {e['title']}"
            if e.get("location"):
                line += f" @ {e['location']}"
            if e.get("attendees"):
                names = ", ".join(e["attendees"][:4])
                line += f" ({names})"
            lines.append(line)
        lines.append("")
        return "\n".join(lines)

    except Exception as exc:
        log.warning("GCal context fetch failed: %s", exc)
        return ""


async def assemble(
    user_id: str,
    query: str,
    *,
    db: Optional[AsyncSession] = None,
    active_tasks_count: int = 0,
    todays_meetings: str = "No meetings",
    last_seen: str = "First interaction",
    user_timezone: str = "Asia/Manila",
) -> str:
    """Query Mnemon + Second Brain (+ live Gmail if email-related) and return assembled system prompt."""
    mnemon_context = "No relevant memories."
    second_brain_context = "No relevant knowledge."
    gmail_section = ""
    gcal_section = ""

    if db is not None:
        is_email_query = bool(_EMAIL_RE.search(query))
        is_calendar_query = bool(_CALENDAR_RE.search(query))

        # Resolve user timezone once
        user_tz = user_timezone
        try:
            from sqlalchemy import select
            from db.models import User
            r = await db.execute(select(User.timezone).where(User.id == user_id))
            tz_val = r.scalar_one_or_none()
            if tz_val:
                user_tz = tz_val
        except Exception:
            pass

        async def _fetch_memory():
            nonlocal mnemon_context, second_brain_context
            try:
                from memory import mnemon, second_brain
                memories = await mnemon.search(db, user_id, query, limit=6)
                mnemon_context = mnemon.format_for_context(memories)
                sb_results = await second_brain.search(db, user_id, query, limit=4)
                second_brain_context = second_brain.format_for_context(sb_results)
            except Exception:
                pass

        coroutines = [_fetch_memory()]
        if is_email_query:
            coroutines.append(_fetch_gmail_context(db, user_id))
        if is_calendar_query:
            coroutines.append(_fetch_gcal_context(db, user_id, user_tz))

        results = await asyncio.gather(*coroutines, return_exceptions=True)

        idx = 1
        if is_email_query:
            if len(results) > idx and isinstance(results[idx], str):
                gmail_section = results[idx]
            idx += 1
        if is_calendar_query:
            if len(results) > idx and isinstance(results[idx], str):
                gcal_section = results[idx]

    return SYSTEM_TEMPLATE.format(
        mnemon_context=mnemon_context,
        second_brain_context=second_brain_context,
        gmail_section=gmail_section,
        gcal_section=gcal_section,
        user_timezone=user_tz,
        active_tasks_count=active_tasks_count,
        todays_meetings=todays_meetings,
        last_seen=last_seen,
    )
