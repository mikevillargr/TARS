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


def is_due(
    schedule_config: dict,
    tz_name: str,
    last_run_at: Optional[datetime],
    next_run_at_stored: Optional[datetime],
) -> bool:
    """Return True if the job should fire right now."""
    if next_run_at_stored:
        return datetime.now(timezone.utc) >= next_run_at_stored
    # Fallback: compute fresh
    nxt = next_run_at(schedule_config, tz_name, last_run_at)
    return datetime.now(timezone.utc) >= nxt


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
      2. Build context via context assembler
      3. Call Claude Sonnet (Tier 3) — tool use enabled
      4. Save response as a new conversation
      5. Publish new_message notification
      6. Update job state (last_run_at, next_run_at, last_output, status)

    Returns the new conversation ID on success, None on failure.
    """
    from db.session import AsyncSessionLocal
    from db.models import CronJob, Conversation, Message, User
    from sqlalchemy import select
    from core.model_client import get_model_client, ModelTier
    from core.context_assembler import assemble
    from agents.notifications import publish as _notify

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

    # Assemble context (memory + second brain)
    try:
        system_prompt = await assemble(user_id, prompt)
    except Exception:
        system_prompt = (
            "You are TARS, Mike Villar's personal AI operating system. "
            "Be direct, precise, and efficient."
        )

    # Always Tier 3 (Sonnet) — prompt crons may use tools and need full context
    client = get_model_client()

    log.info("Executing prompt cron '%s' (job %s)", job.name if job else job_id, job_id)

    full_response = ""
    try:
        async for chunk in client.stream(
            messages=[{"role": "user", "content": prompt}],
            tier=ModelTier.TIER3,
            system=system_prompt,
            max_tokens=4096,
        ):
            if isinstance(chunk, dict) and chunk.get("type") == "chunk":
                full_response += chunk.get("text", "")
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
        full_response = "(No response generated)"

    # Build a title from the job name + date
    now_local = datetime.now(pytz.timezone(tz_name))
    title = f"[Cron] {job.name} — {now_local.strftime('%b %-d')}"

    # Save as a new conversation (or reuse existing output conversation)
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(CronJob).where(CronJob.id == job_id))
        job = result.scalar_one_or_none()
        if not job:
            return None

        # Create a fresh conversation for this run
        conv = Conversation(user_id=user_id, title=title)
        db.add(conv)
        await db.flush()

        # User prompt message
        user_msg = Message(
            conversation_id=conv.id,
            role="user",
            content=prompt,
            model_used="",
            tokens_used=0,
        )
        db.add(user_msg)

        # Assistant response message
        assistant_msg = Message(
            conversation_id=conv.id,
            role="assistant",
            content=full_response,
            model_used=settings.tier3_model_override or ("glm-4.7" if settings.tier3_provider == "zai" else "claude-sonnet-4-6"),
            tokens_used=0,
        )
        db.add(assistant_msg)
        await db.flush()

        # Update job state
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

    # Notify via WebSocket so dot/toast appears
    await _notify(user_id, {
        "type": "new_message",
        "conversation_id": conv_id,
        "message_id": msg_id,
        "preview": full_response[:120],
        "created_at": datetime.now(timezone.utc).isoformat(),
    })

    log.info("Prompt cron '%s' completed — conversation %s", job_id, conv_id)
    return conv_id
