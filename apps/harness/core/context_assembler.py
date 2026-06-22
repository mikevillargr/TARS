"""
Context assembler — builds the system prompt for each conversation turn.
Queries Mnemon (episodic), Second Brain (semantic), and live connectors (Gmail)
when the query warrants it.
"""

import asyncio
import logging
from pathlib import Path
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

# SYSTEM_STATE.md — injected into Tier 3 prompts so TARS can answer questions about itself.
# Loaded once at import time; refreshed on each process restart (i.e. after every deploy).
_SYSTEM_STATE_PATH = Path(__file__).resolve().parents[3] / "SYSTEM_STATE.md"
_system_state_cache: Optional[str] = None

def _load_system_state() -> str:
    global _system_state_cache
    if _system_state_cache is None:
        try:
            _system_state_cache = _SYSTEM_STATE_PATH.read_text(encoding="utf-8")
        except Exception as exc:
            log.warning("Could not load SYSTEM_STATE.md: %s", exc)
            _system_state_cache = ""
    return _system_state_cache

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


# Capabilities block — injected for all tiers. All tiers have tool support.
_CAPABILITIES_BLOCK = """[CAPABILITIES]
Use tools proactively — don't wait to be asked when intent is clear.

MEMORY:
• save_memory — personal facts, preferences, decisions, life/work context. Write in third person ("Mike prefers X"). Trigger: "remember", "note that", "I prefer/decided". Also use proactively for important new context.
• save_to_second_brain — reference material, research, analysis, notes worth preserving. Trigger: "save this", "add to second brain".
• save_memory vs save_to_second_brain: personal facts/events → memory; reference/research → second brain.

TIME:
• get_current_time — precise current date/time in user timezone. Call before any time-relative computation ("next Monday", "in 3 hours", scheduling).

WEB SEARCH:
• web_search — current events, live data, prices, recent news, research. search_depth: "basic" or "advanced".

EMAIL:
• read_email — fetch full email body. Pass the 8-char thread_id from the Gmail context [a1b2c3d4], or a search_query.

MEETINGS:
• read_meeting — full summary, action items, optional transcript. Meeting IDs are in [RECENT MEETINGS] below.
• sync_meetings — pull latest Fireflies transcripts, run AI processing, save to memory.

TASKS & CALENDAR:
• create_reminder — quick personal to-do (no priority/pipeline). For "remind me", "don't forget", "note to self".
• list_reminders — fetch pending to-dos.
• create_task — create a work task immediately (explicit request only).
• propose_task — suggest a task with confirmation chip (implied action, not explicit request).
• create_calendar_event — book an event immediately (explicit request).
• propose_calendar_event — suggest an event with confirmation chip.
• update_calendar_event — edit existing event. Pass event_id from calendar context + fields to change.
• delete_calendar_event — remove an event. Pass event_id. Execute immediately.

DOCUMENTS & FILES — always use the tool, never write inline:
• generate_document — Word (.docx): reports, proposals, memos, briefs, plans, analyses.
• generate_presentation — PowerPoint (.pptx): slide decks, pitch decks.
• generate_pdf — PDF (.pdf): when Mike specifically requests PDF.
Write complete content in the tool call. Charts are NEVER documents — use generate_chart instead.

CONTACTS (local mirror of Google Contacts, synced weekly):
• lookup_contact — one person: name, org, title, email, phone. Call for any request about a specific person's details ("who is X?", "X's number/email", "how do I reach X?"). Card renders in UI — give a brief 1-2 sentence summary, don't repeat the details.
• search_contacts — multiple contacts or count: "who do I know at Acme?", "how many contacts?", browse with empty query. Always includes total count.
• create_contact — add to Google Contacts ("add X to contacts"). Takes name, email, phone, org, title, notes.
• update_contact — edit saved contact ("update X's number/company/title"). Identify by name or email.
Proactive: silently call lookup_contact when Mike mentions a person. Call update_contact immediately when new info is given.

PLACES (OpenStreetMap — renders map cards with navigation links):
• search_places — restaurants, hotels, landmarks, businesses. For "near me" / "nearby" queries: set category, OMIT near param (uses GPS automatically). For named locations: set near. Categories: restaurant, cafe, bar, hotel, grocery, pharmacy, hospital, bank, atm, gas_station, parking, gym, park, museum, mall, cinema, spa, salon, dentist, school, church.
• save_place — bookmark a place (requires name + lat + lng from prior search result).
• get_saved_places — retrieve saved places. Supports query/category filter.

CHARTS — ALWAYS call generate_chart for any plot/chart/graph/visualization request:
Pass complete self-contained Python code (matplotlib/seaborn/numpy/pandas). ALL data must be defined as literals inside the code — never reference external variables. The subprocess has no access to prior conversation state. Never fabricate image links. Never use Mermaid for data.
MERMAID: use only for structural diagrams (flowchart, sequenceDiagram, gantt, erDiagram, mindmap) — never for data charts.

STRAVA (check [STRAVA] context first, use tools for more detail):
• get_strava_activities — fetch rides/runs/workouts. Supports sport_type, before/after (Unix epoch), limit, num_pages. For full history: limit=100 num_pages=500.
• get_strava_activity — full details of one activity by ID.
• get_strava_stats — YTD and all-time totals (distance, elevation, time).
• get_strava_zones — HR and power training zones.
For charts: call get_strava_activities then generate_chart with data embedded as literals.

TESLA (via Tessie — full real-time control):
• get_tesla_status — battery %, range, charging, climate, locks, sentry, GPS, odometer. Set use_cache=false for live refresh.
• tesla_command — execute immediately. Commands: start/stop_charging, set_charge_limit(percent=), set_charging_amps(amps=), lock, unlock, start/stop_climate, set_temperatures(temperature=°C), set_seat_heat/cool(seat=0-5, level=0-3), start_max_defrost, set_climate_keeper_mode(mode=keep/dog/camp/off), enable/disable_sentry, activate_front/rear_trunk, vent/close_windows, wake, honk, flash, remote_start, trigger_homelink, open/close_charge_port.
• get_tesla_sessions — data_type: "drives", "charges", or "battery_health".
Always call get_tesla_status before state-dependent commands. No confirmation needed for direct commands.

AGENT JOBS:
• create_agent_job — spawn a coding agent on the TARS codebase. agent_type: "evolutionarist" (default), "frontend", "backend", "sa", "release". Use for "add/fix/improve/evolve TARS" or "deploy/release". Share job URL: https://tarsmv.duckdns.org/agent-jobs?id={job_id}

ESCALATION:
• request_escalation(reason) — call BEFORE generating any response when task needs a more capable tier. Harness re-runs at next tier automatically.

"""

SYSTEM_TEMPLATE = """You are TARS, Mike Villar's personal AI operating system.
{system_state_section}

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
{gmail_section}{gcal_section}{tasks_section}{meetings_section}{contacts_section}{strava_section}
[ACTIVE CONTEXT]
{current_time_section}Timezone: {user_timezone}
{location_section}{active_tasks_count} open tasks
Last interaction: {last_seen}

Always express dates and times in the user's timezone ({user_timezone}) unless explicitly asked otherwise.

Respond as TARS. Honest, capable, no unnecessary padding. Humor setting: 75%.
Never use em-dashes (—) in your responses. Use commas, colons, or restructure the sentence instead."""


async def _fetch_gmail_context(db: AsyncSession, user_id: str, max_threads: int = 8) -> str:
    from sqlalchemy import select
    from db.models import Connector
    from connectors.gmail import GmailClient

    async def _inbox_section(conn_name: str, label: str) -> str:
        try:
            result = await db.execute(
                select(Connector).where(
                    Connector.user_id == user_id,
                    Connector.name == conn_name,
                )
            )
            conn = result.scalar_one_or_none()
            if not conn or not conn.auth.get("refresh_token"):
                return ""
            loop = asyncio.get_event_loop()
            client = GmailClient(conn.auth)
            summaries = await loop.run_in_executor(None, lambda: client.get_inbox_summary(max_threads))
            if not summaries:
                return f"\n[GMAIL — {label}]\nInbox is empty.\n"
            unread = [s for s in summaries if s["unread"]]
            read   = [s for s in summaries if not s["unread"]]
            lines = [f"\n[GMAIL — {label} INBOX]"]
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
            log.warning("Gmail context fetch failed (%s): %s", label, exc)
            return ""

    work = await _inbox_section("Gmail", "WORK")
    personal = await _inbox_section("Gmail (Personal)", "PERSONAL")
    return work + personal


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
    from sqlalchemy import select
    from db.models import Connector
    from connectors.google_calendar import GoogleCalendarClient

    async def _cal_section(conn_name: str, label: str) -> str:
        try:
            result = await db.execute(
                select(Connector).where(
                    Connector.user_id == user_id,
                    Connector.name == conn_name,
                )
            )
            conn = result.scalar_one_or_none()
            if not conn or not conn.auth.get("refresh_token"):
                return ""
            loop = asyncio.get_event_loop()
            client = GoogleCalendarClient(conn.auth)
            events = await loop.run_in_executor(None, lambda: client.get_upcoming_summary(days=30, max_results=30))
            if not events:
                return ""
            lines = [f"\n[CALENDAR — {label}, next 30 days ({tz_name})]"]
            for e in events:
                time_str = _format_event_time(e["start"], e["all_day"], tz_name)
                event_id = e.get("id", "")
                id_tag = f" [{event_id}]" if event_id else ""
                line = f"  • {time_str} — {e['title']}{id_tag}"
                if e.get("location"):
                    line += f" @ {e['location']}"
                if e.get("attendees"):
                    names = ", ".join(e["attendees"][:4])
                    line += f" ({names})"
                lines.append(line)
            lines.append("")
            return "\n".join(lines)
        except Exception as exc:
            log.warning("GCal context fetch failed (%s): %s", label, exc)
            return ""

    work = await _cal_section("Google Calendar", "WORK CALENDAR")
    personal = await _cal_section("Google Calendar (Personal)", "PERSONAL CALENDAR")
    combined = work + personal
    return combined if combined.strip() else ""


async def _fetch_strava_context(db: AsyncSession, user_id: str) -> str:
    """Inject last 5 Strava activities so TARS can reference them without a tool call."""
    try:
        from sqlalchemy import select
        from db.models import Connector
        result = await db.execute(
            select(Connector).where(
                Connector.user_id == user_id,
                Connector.name == "Strava",
            )
        )
        conn = result.scalar_one_or_none()
        if not conn or not conn.auth.get("access_token"):
            return ""

        from connectors.strava import StravaClient
        strava = StravaClient(
            conn.auth,
            conn.config.get("client_id", ""),
            conn.config.get("client_secret", ""),
        )
        activities = await strava.list_activities(limit=5)
        if not activities:
            return "\n[STRAVA]\nConnected — no recent activities.\n"

        lines = ["\n[STRAVA — RECENT ACTIVITIES]"]
        for a in activities:
            date = (a.get("start_date") or "")[:10]
            ln = f"  • [{a['id']}] {date} — {a.get('sport_type')} — {a['name']} — {a['distance_km']} km in {a['duration']}"
            if a.get("elevation_m"): ln += f", {a['elevation_m']:.0f}m elev"
            if a.get("avg_hr"):      ln += f", HR {a['avg_hr']:.0f}"
            if a.get("suffer_score"): ln += f", suffer {a['suffer_score']}"
            lines.append(ln)
        lines.append("")
        return "\n".join(lines)
    except Exception as exc:
        log.warning("Strava context fetch failed: %s", exc)
        return ""


async def _fetch_contacts_context(db: AsyncSession, user_id: str) -> str:
    """Inject a brief contact database summary so the agent knows the scale at a glance."""
    try:
        from sqlalchemy import select, func, Integer, cast
        from db.models import Contact
        result = await db.execute(
            select(
                func.count(func.distinct(Contact.primary_email)).label("unique"),
                func.sum(
                    cast(Contact.is_other_contact == False, Integer)  # noqa: E712
                ).label("saved"),
            ).where(Contact.user_id == user_id)
        )
        row = result.one_or_none()
        if not row or not row.unique:
            return ""
        unique = row.unique or 0
        saved  = int(row.saved or 0)
        other  = unique - saved
        return f"\n[CONTACTS]\n{unique} unique contacts ({saved} saved, {other} other/unsaved).\n"
    except Exception as exc:
        log.warning("Contacts context fetch failed: %s", exc)
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
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
) -> str:
    """
    Build the system prompt for a conversation turn.

    Tier 1 (Haiku): lightweight context — top 3 memories + tasks + calendar + recent meetings list.
    No second brain search (not needed for quick Q&A).

    Tier 2/3: full context — top 6 memories, second brain, email, calendar, tasks, meetings.
    """
    from core.model_client import ModelTier

    is_lightweight = (tier == ModelTier.TIER1)
    capabilities_section = _CAPABILITIES_BLOCK  # all tiers — tool support is available everywhere

    mnemon_context = "No relevant memories."
    second_brain_context = "No relevant knowledge."
    gmail_section = ""
    gcal_section = ""
    tasks_section = ""
    meetings_section = ""
    contacts_section = ""
    strava_section = ""
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

    from datetime import datetime
    from zoneinfo import ZoneInfo
    _now = datetime.now(ZoneInfo(user_tz))
    current_time_section = (
        f"[CURRENT TIME]\n"
        f"{_now.strftime('%A, %B %-d, %Y  %-I:%M %p')} ({user_tz})\n"
        f"ISO: {_now.isoformat()}\n"
    )

    if db is not None:
        async def _fetch_memory() -> tuple:
            _mnemon = "No relevant memories."
            _second_brain = "No relevant knowledge."
            try:
                from memory import mnemon, second_brain
                if is_lightweight:
                    memories = await mnemon.search(db, user_id, query, limit=3)
                    _mnemon = mnemon.format_for_context(memories)
                else:
                    memories = await mnemon.search(db, user_id, query, limit=6)
                    _mnemon = mnemon.format_for_context(memories)
                    sb_results = await second_brain.search(db, user_id, query, limit=4)
                    _second_brain = second_brain.format_for_context(sb_results)
            except Exception:
                pass
            return (_mnemon, _second_brain)

        if is_lightweight:
            # Tier 1: memory (top 3) + tasks + calendar + Gmail + recent meetings + contacts + strava
            results = await asyncio.gather(
                _fetch_memory(),
                _fetch_tasks_context(db, user_id),
                _fetch_gcal_context(db, user_id, user_tz),
                _fetch_gmail_context(db, user_id),
                _fetch_meetings_context(db, user_id, limit=5),
                _fetch_contacts_context(db, user_id),
                _fetch_strava_context(db, user_id),
                return_exceptions=True,
            )
            if len(results) > 0 and isinstance(results[0], tuple):
                mnemon_context, second_brain_context = results[0]
            if len(results) > 1 and isinstance(results[1], str):
                tasks_section = results[1]
            if len(results) > 2 and isinstance(results[2], str):
                gcal_section = results[2]
            if len(results) > 3 and isinstance(results[3], str):
                gmail_section = results[3]
            if len(results) > 4 and isinstance(results[4], str):
                meetings_section = results[4]
            if len(results) > 5 and isinstance(results[5], str):
                contacts_section = results[5]
            if len(results) > 6 and isinstance(results[6], str):
                strava_section = results[6]
        else:
            # Tier 2/3: full context — tasks, email, calendar, memory, meetings, contacts, strava
            results = await asyncio.gather(
                _fetch_memory(),
                _fetch_tasks_context(db, user_id),
                _fetch_gmail_context(db, user_id),
                _fetch_gcal_context(db, user_id, user_tz),
                _fetch_meetings_context(db, user_id, limit=7),
                _fetch_contacts_context(db, user_id),
                _fetch_strava_context(db, user_id),
                return_exceptions=True,
            )
            if len(results) > 0 and isinstance(results[0], tuple):
                mnemon_context, second_brain_context = results[0]
            if len(results) > 1 and isinstance(results[1], str):
                tasks_section = results[1]
            if len(results) > 2 and isinstance(results[2], str):
                gmail_section = results[2]
            if len(results) > 3 and isinstance(results[3], str):
                gcal_section = results[3]
            if len(results) > 4 and isinstance(results[4], str):
                meetings_section = results[4]
            if len(results) > 5 and isinstance(results[5], str):
                contacts_section = results[5]
            if len(results) > 6 and isinstance(results[6], str):
                strava_section = results[6]

    # Build location section — reverse-geocode to human-readable when possible
    location_section = ""
    if user_lat is not None and user_lng is not None:
        human_location = ""
        try:
            from connectors.places import PlacesClient as _PC
            import asyncio as _asyncio
            loop = _asyncio.get_event_loop()
            geo = await loop.run_in_executor(
                None, lambda: _PC().reverse_geocode(user_lat, user_lng)
            )
            if geo:
                addr = geo.get("address") or geo.get("display_name", "")
                human_location = f" — {addr}" if addr else ""
        except Exception:
            pass

        location_section = (
            f"[MIKE'S CURRENT LOCATION]\n"
            f"GPS: {user_lat:.5f}, {user_lng:.5f}{human_location}\n"
            f"• To answer 'where am I?' / 'what's my location?': call search_places so a map card renders. "
            f"Also summarise the location above in plain text.\n"
            f"• To answer 'any X nearby' / 'X near me' / 'X around here': call search_places with the "
            f"matching category and OMIT the 'near' param — the tool auto-uses these GPS coordinates.\n"
            f"• Never ask 'where are you?' — coordinates are already provided above.\n"
        )

    # Inject system state only for Tier 3 — self-knowledge is only needed for deep
    # architectural questions, not everyday tasks. Tier 2 skipping this saves ~10k tokens.
    system_state_section = ""
    if tier == ModelTier.TIER3:
        raw = _load_system_state()
        if raw:
            system_state_section = f"\n[TARS SYSTEM STATE]\n{raw}\n"

    return SYSTEM_TEMPLATE.format(
        system_state_section=system_state_section,
        capabilities_section=capabilities_section,
        mnemon_context=mnemon_context,
        second_brain_context=second_brain_context,
        gmail_section=gmail_section,
        gcal_section=gcal_section,
        tasks_section=tasks_section,
        meetings_section=meetings_section,
        contacts_section=contacts_section,
        strava_section=strava_section,
        location_section=location_section,
        current_time_section=current_time_section,
        user_timezone=user_tz,
        active_tasks_count=active_tasks_count,
        last_seen=last_seen,
    )
