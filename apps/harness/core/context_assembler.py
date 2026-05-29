"""
Context assembler — builds the system prompt for each conversation turn.
Queries Mnemon (episodic), Second Brain (semantic), and live connectors (Gmail)
when the query warrants it.
"""

import asyncio
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

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


# Capabilities block — only injected for Tier 3 (Claude, which has native tool support).
# Tier 1 (Haiku) and Tier 2 (RunPod) do NOT receive this — they have no tool support
# and would otherwise output raw XML tool-call markup in the response text.
_CAPABILITIES_BLOCK = """[CAPABILITIES]
You have the following tools available. Use them proactively — don't wait to be asked when the intent is clear.

MEMORY SYSTEM (two stores — both are semantically searched and injected into every future conversation):
• save_memory — episodic memory. Use for personal facts, preferences, decisions, context about Mike's life and work.
  Trigger words: "remember", "note that", "keep in mind", "I prefer", "I decided", "I'm going to".
  Also use proactively when you detect important new context (new client, key preference, health update, etc.).
  Write in third person: "Mike prefers X", "Mike decided Y".
• save_to_second_brain — knowledge base. Use for reference material, research findings, notes, analysis worth preserving.
  Trigger words: "save this", "add to second brain", "note this for later", "save this research".
  Also use when you produce analysis, comparisons, or findings the user might want to retrieve later.

WEB SEARCH:
• web_search — search the web for current information. Use proactively when the query involves recent events, news, live data, prices, or anything that requires information beyond your training cutoff. Also use for research tasks. search_depth: "basic" for quick lookups, "advanced" for deeper research.

EMAIL:
• read_email — fetch the full body of an email. Use when Mike asks to read, open, or see the content of a specific email.
  Pass the 8-char thread_id shown in brackets in the Gmail context, e.g. [a1b2c3d4].
  Also accepts a search_query like "from:john@example.com subject:invoice" if you don't have the thread_id.

MEETINGS (Fireflies):
• read_meeting — read the full summary, action items, and optionally transcript of a specific meeting.
  Use whenever Mike asks what was discussed, what came out of, or what action items a meeting produced.
  Meeting IDs are listed in the [RECENT MEETINGS] section below.
• sync_meetings — pull the latest transcripts from Fireflies, process them (AI summary + action items),
  and save to memory. Use when Mike explicitly asks to sync or refresh meetings from Fireflies.

TASK & CALENDAR:
• create_task — create a task immediately. Use when Mike explicitly asks to add/track/remember a task, to-do, or action item.
• propose_task — suggest a task (shows confirmation chip). Use when you detect an implied action but Mike didn't ask.
• create_calendar_event — book an event immediately. Use when Mike explicitly asks to schedule/book something.
• propose_calendar_event — suggest an event. Use when a specific date/time/activity is established in conversation.

DOCUMENT & FILE GENERATION:
• generate_document — create a Word document (DOCX). Use when Mike asks for a document, report, proposal, memo, brief, or any formal written output. Write complete content — don't summarise.
• generate_presentation — create a PowerPoint (PPTX) with slides. Use when Mike asks for a presentation, slide deck, or pitch deck.
• generate_pdf — create a PDF. Use when Mike explicitly asks for PDF format.
All generated files are saved to Artifacts and can be downloaded from the Artifacts section.

WHEN TO STORE MEMORY VS SECOND BRAIN:
- Personal facts, preferences, one-time events → save_memory
- Reference knowledge, how-to notes, research, analysis → save_to_second_brain
- "Remember that I..." → save_memory
- "Save this article/note/finding..." → save_to_second_brain

"""

SYSTEM_TEMPLATE = """You are TARS, Mike Villar's personal AI operating system.

You are direct, precise, and efficient - like your namesake from Interstellar. \
You don't over-explain. You get things done.

You have access to Mike's full context through memory retrieval. \
You know his work, his clients, his projects, his priorities, and his personal life. \
Use that context naturally without announcing that you're doing so.

Mike is CEO of Growth Rocket, a digital marketing agency based in Metro Manila. \
His active clients include NCH Inc., AA Law, OpenRice Philippines, LickSleeve, \
and Entire Travel Group. He is a randonneur and cyclist. He manages his health actively.
{capabilities_section}
[MEMORY CONTEXT]
{mnemon_context}

[RELEVANT KNOWLEDGE]
{second_brain_context}
{gmail_section}{gcal_section}{tasks_section}{meetings_section}
[ACTIVE CONTEXT]
Timezone: {user_timezone}
{active_tasks_count} open tasks
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
                tid = s.get("thread_id", "")[:8]
                lines.append(f"  • [{tid}] {s['from_name']}: {s['subject']} — {s['snippet'][:120]}")
        if read:
            lines.append(f"Recent read ({len(read)}):")
            for s in read[:5]:
                tid = s.get("thread_id", "")[:8]
                lines.append(f"  · [{tid}] {s['from_name']}: {s['subject']} — {s['snippet'][:80]}")
        lines.append("")
        return "\n".join(lines)

    except Exception as exc:
        log.warning("Gmail context fetch failed: %s", exc)
        return ""


async def _fetch_tasks_context(db: AsyncSession, user_id: str) -> str:
    try:
        from sqlalchemy import select
        from db.models import Task
        result = await db.execute(
            select(Task)
            .where(Task.user_id == user_id, Task.status.in_(["inbox", "todo", "in_progress"]))
            .order_by(Task.created_at.desc())
            .limit(15)
        )
        tasks = result.scalars().all()
        if not tasks:
            return "\n[OPEN TASKS]\nNo open tasks.\n"
        lines = ["\n[OPEN TASKS]"]
        for t in tasks:
            due = f" (due {t.due_at.strftime('%b %-d')})" if t.due_at else ""
            lines.append(f"  [{t.status}] [{t.priority}] {t.title}{due}")
        lines.append("")
        return "\n".join(lines)
    except Exception as exc:
        log.warning("Tasks context fetch failed: %s", exc)
        return ""


async def _fetch_meetings_context(db: AsyncSession, user_id: str, limit: int = 7) -> str:
    """Inject recent meetings with IDs so TARS can reference them in read_meeting calls."""
    try:
        from sqlalchemy import select, func
        from db.models import Meeting, MeetingActionItem

        result = await db.execute(
            select(Meeting)
            .where(Meeting.user_id == user_id)
            .order_by(Meeting.created_at.desc())
            .limit(limit)
        )
        meetings = result.scalars().all()
        if not meetings:
            return ""

        lines = ["\n[RECENT MEETINGS — use read_meeting(meeting_id) to get full details]"]
        for m in meetings:
            ai_result = await db.execute(
                select(func.count(MeetingActionItem.id))
                .where(MeetingActionItem.meeting_id == m.id)
            )
            ai_count = ai_result.scalar() or 0

            date_str = (m.started_at or m.created_at).strftime("%b %-d")
            status_str = m.status.replace("_", " ")
            ai_str = f", {ai_count} action item{'s' if ai_count != 1 else ''}" if ai_count else ""
            summary_hint = f" — {m.summary[:80].strip()}…" if m.summary else ""

            lines.append(f"  • [id:{m.id}] {m.title} | {date_str} ({status_str}{ai_str}){summary_hint}")

        lines.append("")
        return "\n".join(lines)
    except Exception as exc:
        log.warning("Meetings context fetch failed: %s", exc)
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
    tier=None,                          # ModelTier — controls context depth
    active_tasks_count: int = 0,
    last_seen: str = "First interaction",
    user_timezone: str = "Asia/Manila",
) -> str:
    """
    Build the system prompt for a conversation turn.

    Tier 1 (Haiku): lightweight context — top 3 memories + tasks + calendar + recent meetings list.
    No second brain search (not needed for quick Q&A).

    Tier 2/3: full context — top 6 memories, second brain, email, calendar, tasks, meetings.
    """
    from core.model_client import ModelTier

    is_lightweight = (tier == ModelTier.TIER1)
    # Capabilities block only for Claude (Tier 3) — Ollama/RunPod models have no tool support
    # and would output raw XML tool-call markup if they see the capabilities section.
    capabilities_section = _CAPABILITIES_BLOCK if tier == ModelTier.TIER3 else ""

    mnemon_context = "No relevant memories."
    second_brain_context = "No relevant knowledge."
    gmail_section = ""
    gcal_section = ""
    tasks_section = ""
    meetings_section = ""
    user_tz = user_timezone

    if db is not None:
        # Resolve user timezone once
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
                if is_lightweight:
                    # Tier 1 (Haiku): top 3 memories only — enough for personalization,
                    # low token cost. Skip second brain (document search not needed for Q&A).
                    memories = await mnemon.search(db, user_id, query, limit=3)
                    mnemon_context = mnemon.format_for_context(memories)
                else:
                    # Tier 2/3: full context
                    memories = await mnemon.search(db, user_id, query, limit=6)
                    mnemon_context = mnemon.format_for_context(memories)
                    sb_results = await second_brain.search(db, user_id, query, limit=4)
                    second_brain_context = second_brain.format_for_context(sb_results)
            except Exception:
                pass

        if is_lightweight:
            # Tier 1: memory (top 3) + tasks + calendar + Gmail + recent meetings list
            results = await asyncio.gather(
                _fetch_memory(),
                _fetch_tasks_context(db, user_id),
                _fetch_gcal_context(db, user_id, user_tz),
                _fetch_gmail_context(db, user_id),
                _fetch_meetings_context(db, user_id, limit=5),
                return_exceptions=True,
            )
            if len(results) > 1 and isinstance(results[1], str):
                tasks_section = results[1]
            if len(results) > 2 and isinstance(results[2], str):
                gcal_section = results[2]
            if len(results) > 3 and isinstance(results[3], str):
                gmail_section = results[3]
            if len(results) > 4 and isinstance(results[4], str):
                meetings_section = results[4]
        else:
            # Tier 2/3: full context — tasks, email, calendar, memory, meetings
            results = await asyncio.gather(
                _fetch_memory(),
                _fetch_tasks_context(db, user_id),
                _fetch_gmail_context(db, user_id),
                _fetch_gcal_context(db, user_id, user_tz),
                _fetch_meetings_context(db, user_id, limit=7),
                return_exceptions=True,
            )
            if len(results) > 1 and isinstance(results[1], str):
                tasks_section = results[1]
            if len(results) > 2 and isinstance(results[2], str):
                gmail_section = results[2]
            if len(results) > 3 and isinstance(results[3], str):
                gcal_section = results[3]
            if len(results) > 4 and isinstance(results[4], str):
                meetings_section = results[4]

    return SYSTEM_TEMPLATE.format(
        capabilities_section=capabilities_section,
        mnemon_context=mnemon_context,
        second_brain_context=second_brain_context,
        gmail_section=gmail_section,
        gcal_section=gcal_section,
        tasks_section=tasks_section,
        meetings_section=meetings_section,
        user_timezone=user_tz,
        active_tasks_count=active_tasks_count,
        last_seen=last_seen,
    )
