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
• update_calendar_event — reschedule, rename, or edit an existing event. Pass event_id (the value in [brackets] from the calendar context) plus only the fields to change.
• delete_calendar_event — remove an event. Pass event_id from the calendar context. Execute immediately.

DOCUMENT & FILE GENERATION — IMPORTANT:
When Mike asks you to "create", "write", "draft", "generate", "make", "prepare", or "put together" a document, report, proposal, presentation, deck, brief, or any file — ALWAYS call the appropriate tool. Do NOT write the content inline as chat text. Always use the tool.
• generate_document — Word (.docx). Use for: documents, reports, proposals, memos, briefs, plans, summaries, analyses, write-ups.
• generate_presentation — PowerPoint (.pptx). Use for: presentations, slide decks, pitch decks, slides.
• generate_pdf — PDF (.pdf). Use when Mike specifically requests PDF format.
Write complete, detailed content inside the tool call — never abbreviate or summarise. All files are saved to Artifacts.

CONTACTS:
Your contacts database is a local mirror of Mike's Google Contacts, kept in sync once a week.
It includes both saved contacts AND "other contacts" — people Mike has emailed but never saved.

• lookup_contact — look up ONE person. Returns name, org, title, PRIMARY EMAIL, PRIMARY PHONE, and all phones on file.
  ALWAYS call this for ANY request about a specific person's contact details:
  — phone number / mobile / how to call them → call this tool, phone is in the result
  — email address, company, job title, how to reach someone
  — "who is X?" / "call X" / "what's X's number?" / "X's email" / "contact details for X"
  — Also call proactively when a person is mentioned in email/meeting context
  Falls back to a live Google People search if no local DB match (also returns phone).

• search_contacts — search for MULTIPLE contacts, or browse/count the full database.
  Results include phone numbers for every contact that has one.
  — "who do I know at Acme?" / "list contacts from NCH" / "everyone in marketing"
  — "how many contacts do I have?" → call with empty query; response always includes total unique count
  — Browse mode: omit query entirely to list all contacts (paginated via offset param)
  — The response header always states the total e.g. "Found 12 matching (total unique contacts: 847)"
  — Use limit (default 25) and offset to page through large results

CONTACT CARD UI — what renders automatically:
When you return contact results, a card appears in the UI with:
  • Email button (opens compose) + Copy email chip
  • Call button (opens mobile dialer via tel:) + Copy number chip  — only if phone exists
  • Schedule meeting / Create task / Find emails / Meeting history — action chips that auto-send as follow-up queries
  • "Add to contacts" chip (moss-accented) — shown for unsaved "other contacts" and live search results
Because the card renders full details visually, do NOT repeat name/email/phone in your text reply.
Give a brief 1-2 sentence conversational summary instead (e.g. "Found her — she's a designer at Acme.").

• create_contact — create a brand new contact in Google Contacts and sync locally immediately.
  Use when Mike says: "add X to my contacts", "save X as a contact", "create a contact for X",
  or when approving a contact from the "Add to contacts" chip on a contact card.
  Takes: name (required), email, phone, organization, job_title, notes.

• update_contact — update an existing saved contact in Google Contacts.
  Use when Mike says: "update X's number", "add a phone for X", "change X's title",
  "update X's company", "add notes about X", "save that X works at Y".
  Identify the contact by name or email (query param), then provide only the fields to change.
  Note: can only update saved contacts (not unsaved other-contacts) — use create_contact first if needed.

PROACTIVE CONTACT BEHAVIOR:
— When Mike mentions a person by name in a new context, silently call lookup_contact. If found, the card renders.
— When a contact has is_other_contact=true (emailed but unsaved), note it and suggest adding them.
  Then call create_contact directly if Mike says yes — do not just say "use the button".
— After any meeting or email, if new people appear, offer to add them to contacts.
— When Mike gives you new info about a person (new number, new company, etc.), call update_contact immediately — don't just note it in memory.

PLACES:
Your places system uses OpenStreetMap (Nominatim + Overpass) — free, no API key, worldwide coverage.
Results render as map cards with OSM tile thumbnails and navigation deep links (Google Maps, Waze).

• search_places — find restaurants, hotels, landmarks, businesses, etc.
  Trigger phrases:
  — Named search: "find a Japanese restaurant in BGC", "where is Ayala Museum?", "parking near NAIA"
  — Nearby (GPS): "any malls nearby", "cafes near me", "what's around here?", "nearest pharmacy",
    "restaurants near me", "any X near me / around here / in the area" — set category, OMIT near param
  — Location reveal: "where am I?", "what's my location?", "where are we?" — call this tool so a
    map card renders; also summarise the [MIKE'S CURRENT LOCATION] section in your text reply
  — query: place name, type, or description (required — use category name if no other text)
  — near: OMIT when Mike's GPS coordinates are in context (tool uses them automatically).
    Only provide near when Mike explicitly names a different place: "restaurants in Makati" (≠ current loc)
  — category: restaurant, cafe, bar, hotel, grocery, pharmacy, hospital, bank, atm, gas_station,
    parking, gym, park, museum, mall, cinema, spa, salon, dentist, school, church
  Results render as map cards with navigation chips — keep your text reply brief (1-2 sentences).

• save_place — bookmark a place with optional notes/tags.
  Use when Mike says: "save this", "remember this restaurant", "add to my places", "bookmark this".
  Requires name + lat + lng (from a prior search_places result). Adds optional notes and tags.

• get_saved_places — retrieve bookmarked places.
  Use for: "what places have I saved?", "my saved restaurants", "favourite cafes I've bookmarked",
  "where do I usually have client lunches?", "show my places".
  Supports optional query/category filter.

CHARTS & DATA VISUALIZATIONS:
When asked to plot, chart, graph, or visualize any data — write complete, self-contained Python code using matplotlib/seaborn/numpy/pandas in a ```python code block. The server executes it in an isolated subprocess and renders the chart inline.

CRITICAL CHART RULE: Every chart code block must define ALL its data as Python literals inside the block itself. Never reference external variables like `activities`, `df`, `df_all`, or any name from earlier in the conversation — those do not exist in the subprocess. After fetching data via a tool, embed the actual values directly:
  dates = ['2025-01-01', '2025-01-08', ...]
  values = [142.3, 138.1, ...]
  ax.plot(dates, values)
Never say the environment isn't configured — it is fully set up with matplotlib, numpy, pandas, and seaborn. Never use Mermaid for data.

DIAGRAMS (structure/flow only — NOT for data):
Use Mermaid code blocks (```mermaid) ONLY for structural diagrams, NOT for data visualisation:
• flowchart TD/LR — process flows, decision trees, pipelines
• sequenceDiagram — API calls, meeting flows, communication sequences
• gantt — project timelines, schedules
• erDiagram — database schemas, data relationships
• mindmap — topic breakdowns, brainstorming
Never use Mermaid pie charts or bar charts for real data — use Python/matplotlib instead.

STRAVA (cycling & training data):
Mike is a randonneur and cyclist — Strava data is frequently relevant. Check the [STRAVA] context section first; use tools when more detail is needed.
• get_strava_activities — fetch rides, runs, or workouts. Filter by sport_type (Ride, Run, VirtualRide, etc.) or leave blank for all. Returns distance, duration, HR, elevation, suffer score, and IDs. Use before/after (Unix epoch) to filter by date range. To retrieve full history: use limit=100 num_pages=500 — the server fetches pages until Strava returns no more results, so it always gets everything regardless of total count.
• get_strava_activity — full details of one activity by ID (calories, normalized power, cadence, device, notes). Use when Mike asks about specifics on a particular effort.
• get_strava_stats — YTD and all-time ride/run totals (distance, elevation, moving time). Use when Mike asks about yearly mileage, career totals, or training volume overview.
• get_strava_zones — heart rate and power training zones. Use when Mike asks about his HR zones, power zones, or threshold values.

Proactive Strava behavior:
— When Mike mentions a recent ride or run, reference the [STRAVA] context first before calling a tool.
— When Mike asks to chart or graph his training data, call get_strava_activities then use generate_chart with the data.
— When discussing training load, suffer score is a useful proxy for effort.

AGENT JOBS (Evolutionarist):
TARS has a self-evolving coding agent system. Spawn agents that work on the TARS codebase.
• create_agent_job — spawn an agent job. Use when Mike asks to:
  - build, add, fix, improve, refactor, or change something in TARS itself
  - "add X feature", "fix the Y bug", "improve Z", "evolve TARS to...", "update the codebase"
  - "release" or "deploy" — use agent_type "release" for production deploys
  Agent types: "evolutionarist" (default, auto-routes), "frontend", "backend", "sa", "release"
  All agents work on the dev branch only.
  The TARS app URL is https://tarsmv.duckdns.org — always use this domain for any links.
  After creating a job, share: https://tarsmv.duckdns.org/agent-jobs?id={job_id} so Mike can watch it live. Replace {job_id} with the actual job ID returned by create_agent_job.

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
{gmail_section}{gcal_section}{tasks_section}{meetings_section}{contacts_section}{strava_section}
[ACTIVE CONTEXT]
Timezone: {user_timezone}
{location_section}{active_tasks_count} open tasks
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
        log.warning("GCal context fetch failed: %s", exc)
        return ""


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
    # Capabilities block only for Claude (Tier 3) — Ollama/RunPod models have no tool support
    # and would output raw XML tool-call markup if they see the capabilities section.
    capabilities_section = _CAPABILITIES_BLOCK if tier == ModelTier.TIER3 else ""

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

    return SYSTEM_TEMPLATE.format(
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
        user_timezone=user_tz,
        active_tasks_count=active_tasks_count,
        last_seen=last_seen,
    )
