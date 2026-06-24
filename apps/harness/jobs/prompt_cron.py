"""
Prompt Cron executor.

Runs a user-defined prompt through the full model pipeline (Tier 3 — Claude Sonnet)
and saves the response as a new chat conversation.

schedule_config shape:
  {
    "frequency": "daily" | "weekdays" | "weekly" | "biweekly" | "monthly",
    "time":      "HH:MM",           # wall-clock time in job.timezone
    "day_of_week": 0-6,             # 0=Monday … 6=Sunday (weekly/biweekly)
  }
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

import pytz

from core.config import settings

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Schedule math
# ---------------------------------------------------------------------------

def next_run_at(
    schedule_config: dict,
    tz_name: str,
    last_run_at: Optional[datetime],
) -> datetime:
    """
    Return the next UTC datetime this job should run, given the schedule config
    and when it last ran (or None if never).
    """
    tz = pytz.timezone(tz_name)
    now_local = datetime.now(tz)

    time_str = schedule_config.get("time", "08:00")
    hour, minute = map(int, time_str.split(":"))
    frequency = schedule_config.get("frequency", "daily")
    dow = schedule_config.get("day_of_week", 0)  # 0=Monday

    # Candidate = today at the scheduled time in user's timezone
    candidate = now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)

    if frequency == "daily":
        if candidate <= now_local:
            candidate += timedelta(days=1)

    elif frequency == "weekdays":
        # advance until it's a weekday AND in the future
        if candidate <= now_local:
            candidate += timedelta(days=1)
        while candidate.weekday() >= 5:  # 5=Sat, 6=Sun
            candidate += timedelta(days=1)

    elif frequency == "weekly":
        # advance to the next occurrence of dow
        days_ahead = (dow - candidate.weekday()) % 7
        if days_ahead == 0 and candidate <= now_local:
            days_ahead = 7
        candidate += timedelta(days=days_ahead)

    elif frequency == "biweekly":
        # Next occurrence of dow, then check it's ≥2 weeks after last run
        days_ahead = (dow - candidate.weekday()) % 7
        if days_ahead == 0 and candidate <= now_local:
            days_ahead = 7
        candidate += timedelta(days=days_ahead)
        if last_run_at:
            last_local = last_run_at.astimezone(tz)
            while (candidate - last_local).days < 14:
                candidate += timedelta(weeks=1)

    elif frequency == "monthly":
        # 1st of next month (or this month if not yet passed)
        candidate = candidate.replace(day=1)
        if candidate <= now_local:
            if candidate.month == 12:
                candidate = candidate.replace(year=candidate.year + 1, month=1)
            else:
                candidate = candidate.replace(month=candidate.month + 1)

    return candidate.astimezone(timezone.utc)


_STALE_WINDOW_MINUTES = 30  # skip if job is more than this many minutes overdue


def is_due(
    schedule_config: dict,
    tz_name: str,
    last_run_at: Optional[datetime],
    next_run_at_stored: Optional[datetime],
) -> bool:
    """
    Return True if the job should fire right now.

    Stale-fire protection: if the job is more than STALE_WINDOW_MINUTES past
    its scheduled time (e.g. harness was down for hours), skip it — we don't
    want a 7 AM morning brief running at noon.  next_run_at will be advanced
    to the following occurrence by the caller.
    """
    now = datetime.now(timezone.utc)
    nxt = next_run_at_stored or next_run_at(schedule_config, tz_name, last_run_at)
    if now < nxt:
        return False
    overdue_minutes = (now - nxt).total_seconds() / 60
    if overdue_minutes > _STALE_WINDOW_MINUTES:
        return False  # too late — caller will advance next_run_at
    return True


def human_schedule(schedule_config: dict) -> str:
    """Return a human-readable description of the schedule."""
    freq = schedule_config.get("frequency", "daily")
    time_str = schedule_config.get("time", "08:00")
    dow = schedule_config.get("day_of_week", 0)

    # Format time as "8:00 AM"
    h, m = map(int, time_str.split(":"))
    ampm = "AM" if h < 12 else "PM"
    h12 = h % 12 or 12
    t = f"{h12}:{m:02d} {ampm}"

    days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    if freq == "daily":
        return f"Every day at {t}"
    if freq == "weekdays":
        return f"Weekdays at {t}"
    if freq == "weekly":
        return f"Every {days[dow]} at {t}"
    if freq == "biweekly":
        return f"Every 2 weeks on {days[dow]} at {t}"
    if freq == "monthly":
        return f"1st of every month at {t}"
    return f"Custom schedule at {t}"


# ---------------------------------------------------------------------------
# Executor
# ---------------------------------------------------------------------------

async def execute(job_id: str) -> str | None:
    """
    Run a prompt cron job end-to-end:
      1. Load job from DB
      2. Build full context via context assembler (Tier 3 — includes capabilities + Gmail + tasks + calendar)
      3. Call Claude Sonnet (Tier 3) with the same tool set as chat
      4. Save response as a new conversation
      5. Publish new_message notification
      6. Update job state (last_run_at, next_run_at, last_output, status)

    Returns the new conversation ID on success, None on failure.
    """
    from db.session import AsyncSessionLocal
    from db.models import CronJob, Conversation, Message, User, Task
    from sqlalchemy import select
    from core.model_client import (
        get_model_client, ModelTier,
        CREATE_TASK_TOOL, SAVE_MEMORY_TOOL, SAVE_TO_SECOND_BRAIN_TOOL,
        READ_EMAIL_TOOL, SEND_EMAIL_TOOL, READ_MEETING_TOOL, SYNC_MEETINGS_TOOL,
        WEB_SEARCH_TOOL, LOOKUP_CONTACT_TOOL, SEARCH_CONTACTS_TOOL,
        CREATE_CONTACT_TOOL, UPDATE_CONTACT_TOOL,
    )
    from core.context_assembler import assemble
    from agents.notifications import publish as _notify

    # ── Load job ──────────────────────────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(CronJob).where(CronJob.id == job_id))
        job = result.scalar_one_or_none()
        if not job or job.type != "prompt" or not job.prompt_text:
            log.warning("Prompt cron %s not found or misconfigured", job_id)
            return None

        user_result = await db.execute(select(User).where(User.id == job.user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            return None

        prompt = job.prompt_text
        user_id = job.user_id
        tz_name = job.timezone or "Asia/Manila"
        job_name = job.name

    # ── Assemble full context (Tier 3 = capabilities block + Gmail + tasks + calendar) ──
    async with AsyncSessionLocal() as assemble_db:
        try:
            system_prompt = await assemble(
                user_id, prompt,
                db=assemble_db,
                tier=ModelTier.TIER3,
                user_timezone=tz_name,
            )
        except Exception as exc:
            log.warning("Context assembly failed for cron %s: %s", job_id, exc)
            system_prompt = (
                "You are TARS, Mike Villar's personal AI operating system. "
                "Be direct, precise, and efficient."
            )

    # ── Stream the model with tools ────────────────────────────────────────────
    client = get_model_client()

    tools = [
        CREATE_TASK_TOOL,
        SAVE_MEMORY_TOOL,
        SAVE_TO_SECOND_BRAIN_TOOL,
        READ_EMAIL_TOOL,
        SEND_EMAIL_TOOL,
        READ_MEETING_TOOL,
        SYNC_MEETINGS_TOOL,
        WEB_SEARCH_TOOL,
        LOOKUP_CONTACT_TOOL,
        SEARCH_CONTACTS_TOOL,
        CREATE_CONTACT_TOOL,
        UPDATE_CONTACT_TOOL,
    ]

    log.info("Executing prompt cron '%s' (job %s)", job_name, job_id)

    full_response = ""
    try:
        async with AsyncSessionLocal() as tool_db:
            async def _tool_executor(name: str, tool_input: dict) -> str:
                if name == "create_task":
                    task = Task(
                        user_id=user_id,
                        title=tool_input["title"],
                        description=tool_input.get("description"),
                        priority=tool_input.get("priority", "normal"),
                        status="inbox",
                        source="cron",
                    )
                    tool_db.add(task)
                    await tool_db.commit()
                    return f"Task created: '{tool_input['title']}'"

                if name == "save_memory":
                    try:
                        from memory import mnemon
                        await mnemon.save(
                            tool_db, user_id,
                            content=tool_input["content"],
                            domain=tool_input.get("domain", "work"),
                            source="cron",
                            importance=tool_input.get("importance", 3),
                        )
                        return "Memory saved."
                    except Exception as exc:
                        return f"Failed to save memory: {exc}"

                if name == "save_to_second_brain":
                    try:
                        from memory.second_brain import ingest_text
                        item_id = await ingest_text(
                            tool_db, user_id,
                            content=tool_input["content"],
                            title=tool_input.get("title", "Cron note"),
                            tags=tool_input.get("tags", []),
                        )
                        return f"Saved to Second Brain (id: {item_id})."
                    except Exception as exc:
                        return f"Failed to save to Second Brain: {exc}"

                if name == "read_email":
                    try:
                        from db.models import Connector
                        from connectors.gmail import GmailClient, extract_thread_text
                        import asyncio as _asyncio
                        loop = _asyncio.get_event_loop()

                        gmail_conns: list[tuple[str, object]] = []
                        for conn_name, acct_label in [("Gmail", "work"), ("Gmail (Personal)", "personal")]:
                            r = await tool_db.execute(
                                select(Connector).where(
                                    Connector.user_id == user_id,
                                    Connector.name == conn_name,
                                )
                            )
                            c = r.scalar_one_or_none()
                            if c and c.auth.get("refresh_token"):
                                gmail_conns.append((acct_label, c))

                        if not gmail_conns:
                            return "Gmail not connected."

                        thread_id = tool_input.get("thread_id", "").strip()
                        search_query = tool_input.get("search_query", "")

                        if not thread_id and search_query:
                            for acct_label, c in gmail_conns:
                                gclient = GmailClient(c.auth)
                                threads = await loop.run_in_executor(
                                    None,
                                    lambda gc=gclient: gc.list_threads(query=search_query, max_results=1),
                                )
                                if threads:
                                    thread_id = threads[0]["id"]
                                    break
                            if not thread_id:
                                return "No email found matching that search."

                        if not thread_id:
                            return "Provide a thread_id or search_query."

                        gclient = GmailClient(gmail_conns[0][1].auth)
                        if len(thread_id) == 8:
                            candidates = await loop.run_in_executor(
                                None,
                                lambda: gclient.list_threads(query="in:inbox", max_results=20),
                            )
                            match = next((t["id"] for t in candidates if t["id"].startswith(thread_id)), None)
                            if match:
                                thread_id = match

                        thread = await loop.run_in_executor(None, lambda: gclient.get_thread(thread_id))
                        body = extract_thread_text(thread)
                        if not body:
                            return "Email body is empty."
                        if len(body) > 4000:
                            body = body[:4000] + "\n\n[... email truncated ...]"
                        return body
                    except Exception as exc:
                        return f"Failed to read email: {exc}"

                if name == "send_email":
                    try:
                        from db.models import Connector
                        conn_result = await tool_db.execute(
                            select(Connector).where(
                                Connector.user_id == user_id,
                                Connector.name == "Gmail",
                            )
                        )
                        conn = conn_result.scalar_one_or_none()
                        if not conn or not conn.auth.get("refresh_token"):
                            return "Gmail not connected."
                        from connectors.gmail import GmailClient
                        import asyncio as _asyncio
                        gclient = GmailClient(conn.auth)
                        loop = _asyncio.get_event_loop()
                        result = await loop.run_in_executor(
                            None,
                            lambda: gclient.send_email(
                                to=tool_input["to"],
                                subject=tool_input["subject"],
                                body=tool_input["body"],
                                cc=tool_input.get("cc"),
                                thread_id=tool_input.get("thread_id"),
                            ),
                        )
                        return result
                    except Exception as exc:
                        return f"Failed to send email: {exc}"

                if name == "sync_meetings":
                    try:
                        from core.config import settings as _settings
                        if not _settings.fireflies_api_key:
                            return "Fireflies API key not configured."
                        from connectors.fireflies import FirefliesClient
                        from jobs.meeting_processor import ingest_from_webhook, process_meeting as _proc_meeting
                        ff_client = FirefliesClient(_settings.fireflies_api_key)
                        transcripts = await ff_client.list_recent(limit=20)
                        synced = 0
                        skipped = 0
                        for t in transcripts:
                            tid = t.get("id")
                            if not tid:
                                continue
                            new_id = await ingest_from_webhook(tool_db, user_id, tid)
                            if new_id:
                                await _proc_meeting(tool_db, new_id, user_id)
                                synced += 1
                            else:
                                skipped += 1
                        if synced:
                            return f"Synced {synced} new meeting{'s' if synced != 1 else ''} ({skipped} already up to date)."
                        return f"All {skipped} recent meetings are already up to date."
                    except Exception as exc:
                        return f"Failed to sync meetings: {exc}"

                if name == "read_meeting":
                    try:
                        from db.models import Meeting, MeetingActionItem
                        meeting_id = tool_input.get("meeting_id", "").strip()
                        include_transcript = tool_input.get("include_transcript", False)
                        m_result = await tool_db.execute(
                            select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user_id)
                        )
                        meeting = m_result.scalar_one_or_none()
                        if not meeting:
                            return f"Meeting '{meeting_id}' not found."
                        ai_result = await tool_db.execute(
                            select(MeetingActionItem).where(MeetingActionItem.meeting_id == meeting_id)
                        )
                        action_items = ai_result.scalars().all()
                        parts = [f"# {meeting.title}"]
                        if meeting.started_at:
                            parts.append(f"Date: {meeting.started_at.strftime('%B %-d, %Y')}")
                        if meeting.summary:
                            parts.append(f"\n## Summary\n{meeting.summary}")
                        if action_items:
                            parts.append(f"\n## Action Items")
                            for ai in action_items:
                                parts.append(f"  • {ai.raw_text}")
                        if include_transcript and meeting.transcript:
                            transcript = meeting.transcript[:20000]
                            parts.append(f"\n## Transcript\n{transcript}")
                        return "\n".join(parts)
                    except Exception as exc:
                        return f"Failed to read meeting: {exc}"

                if name == "web_search":
                    try:
                        from core.config import settings as _settings
                        query = tool_input.get("query", "")
                        if not query:
                            return "No search query provided."
                        if _settings.tavily_api_key:
                            import httpx
                            async with httpx.AsyncClient(timeout=15) as http:
                                resp = await http.post(
                                    "https://api.tavily.com/search",
                                    json={"api_key": _settings.tavily_api_key, "query": query, "max_results": 5},
                                )
                            data = resp.json()
                            results = data.get("results", [])
                            if not results:
                                return "No results found."
                            lines = []
                            for r in results[:5]:
                                lines.append(f"**{r.get('title', '')}**\n{r.get('url', '')}\n{r.get('content', '')[:300]}")
                            return "\n\n".join(lines)
                        return "Web search not configured (no Tavily API key)."
                    except Exception as exc:
                        return f"Web search failed: {exc}"

                if name in ("lookup_contact", "search_contacts"):
                    try:
                        from db.models import Contact
                        from sqlalchemy import or_, func as _func
                        query_str = tool_input.get("query", "").strip()
                        if not query_str:
                            result = await tool_db.execute(
                                select(Contact).where(Contact.user_id == user_id).limit(10)
                            )
                            contacts = result.scalars().all()
                        else:
                            result = await tool_db.execute(
                                select(Contact).where(
                                    Contact.user_id == user_id,
                                    or_(
                                        Contact.name.ilike(f"%{query_str}%"),
                                        Contact.primary_email.ilike(f"%{query_str}%"),
                                    )
                                ).limit(10)
                            )
                            contacts = result.scalars().all()
                        if not contacts:
                            return f"No contacts found for '{query_str}'."
                        lines = []
                        for c in contacts:
                            line = f"{c.name}"
                            if c.primary_email:
                                line += f" <{c.primary_email}>"
                            if c.organization:
                                line += f" — {c.organization}"
                            lines.append(line)
                        return "\n".join(lines)
                    except Exception as exc:
                        return f"Failed to lookup contact: {exc}"

                return f"Tool '{name}' is not available in scheduled task context."

            import pytz as _pytz
            _tz_obj = _pytz.timezone(tz_name)
            _fire_time = datetime.now(_tz_obj)
            _fire_prefix = (
                f"[Scheduled run: {_fire_time.strftime('%A, %B %-d, %Y  %-I:%M %p')} {tz_name}]\n\n"
            )
            cron_tokens_used = 0
            cron_input_tokens = 0
            thinking_response = ""  # fallback if visible text is empty
            async for chunk in client.stream(
                messages=[{"role": "user", "content": _fire_prefix + prompt}],
                tier=ModelTier.TIER3,
                system=system_prompt,
                tools=tools,
                tool_executor=_tool_executor,
                max_tokens=4096,
            ):
                if isinstance(chunk, dict):
                    if chunk.get("type") == "chunk":
                        full_response += chunk.get("text", "")
                    elif chunk.get("type") == "thinking":
                        thinking_response += chunk.get("text", "")
                    elif chunk.get("type") == "error":
                        log.error("Prompt cron %s stream error: %s", job_id, chunk.get("error"))
                    elif chunk.get("type") == "done":
                        cron_tokens_used = chunk.get("tokens", 0)
                        cron_input_tokens = chunk.get("input_tokens", 0)

    except Exception as exc:
        log.error("Prompt cron %s model call failed: %s", job_id, exc)
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(CronJob).where(CronJob.id == job_id))
            job = result.scalar_one_or_none()
            if job:
                job.last_run_at = datetime.now(timezone.utc)
                job.last_run_status = "error"
                if job.schedule_config:
                    job.next_run_at = next_run_at(job.schedule_config, job.timezone or "Asia/Manila", job.last_run_at)
                await db.commit()
        return None

    if not full_response.strip():
        if thinking_response.strip():
            # Model put entire response in thinking block (token budget exhausted by thinking).
            # Salvage the thinking content so the cron isn't silently empty.
            full_response = thinking_response.strip()
            log.warning(
                "Prompt cron %s: visible response was empty — saved thinking content (%d chars). "
                "Consider increasing max_tokens or switching to a model with lower thinking overhead.",
                job_id, len(full_response),
            )
        else:
            full_response = "(No response generated)"

    # ── Save as a new conversation ─────────────────────────────────────────────
    now_local = datetime.now(pytz.timezone(tz_name))
    title = f"{job_name} — {now_local.strftime('%b %-d')}"

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(CronJob).where(CronJob.id == job_id))
        job = result.scalar_one_or_none()
        if not job:
            return None

        conv = Conversation(user_id=user_id, title=title)
        db.add(conv)
        await db.flush()

        # Only save the assistant response — prompt is cron config, not a user turn
        assistant_msg = Message(
            conversation_id=conv.id,
            role="assistant",
            content=full_response,
            model_used=settings.tier3_model_override or ("glm-4.7" if settings.tier3_provider == "zai" else "claude-sonnet-4-6"),
            tokens_used=cron_tokens_used,
            input_tokens=cron_input_tokens,
        )
        db.add(assistant_msg)
        await db.flush()

        job.last_run_at = datetime.now(timezone.utc)
        job.last_run_status = "ok"
        job.last_output = full_response[:500]
        job.output_conversation_id = conv.id
        if job.schedule_config:
            job.next_run_at = next_run_at(
                job.schedule_config, job.timezone or "Asia/Manila", job.last_run_at
            )

        await db.commit()
        await db.refresh(assistant_msg)

        conv_id = conv.id
        msg_id = str(assistant_msg.id)

    # ── Notify ────────────────────────────────────────────────────────────────
    await _notify(user_id, {
        "type": "new_message",
        "conversation_id": conv_id,
        "message_id": msg_id,
        "preview": full_response[:120],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    log.info("Prompt cron '%s' completed — conversation %s", job_name, conv_id)
    return conv_id
