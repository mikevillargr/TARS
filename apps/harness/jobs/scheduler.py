"""
Harness scheduler — two types of periodic jobs.

1. Connector jobs: interval-based (fireflies sync, people sync, etc.)
   State kept in-memory, exposed via /api/cron.

2. Prompt jobs: wall-clock scheduled (daily at 8 AM, every Monday at 9 PM, etc.)
   Stored in DB (cron_jobs table), checked every 60 s by _prompt_cron_loop.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Callable, Coroutine, Any, Optional

log = logging.getLogger(__name__)


# ─── Job registry ─────────────────────────────────────────────────────────────

@dataclass
class JobState:
    name:          str
    description:   str
    interval_sec:  int                   # how often to run
    last_run_at:   Optional[datetime] = None
    last_status:   str                   = "pending"   # pending | running | ok | error
    last_error:    Optional[str]         = None
    run_count:     int                   = 0
    run_immediately: bool                = True        # run on startup before first sleep?

    @property
    def next_run_at(self) -> Optional[datetime]:
        if not self.last_run_at:
            return None
        return self.last_run_at + timedelta(seconds=self.interval_sec)

    def to_dict(self) -> dict:
        return {
            "name":          self.name,
            "description":   self.description,
            "interval_sec":  self.interval_sec,
            "last_run_at":   self.last_run_at.isoformat() if self.last_run_at else None,
            "next_run_at":   self.next_run_at.isoformat() if self.next_run_at else None,
            "last_status":   self.last_status,
            "last_error":    self.last_error,
            "run_count":     self.run_count,
        }


_registry: dict[str, JobState] = {}


def get_jobs() -> list[dict]:
    return [j.to_dict() for j in _registry.values()]


def update_interval(name: str, interval_sec: int) -> JobState:
    if name not in _registry:
        raise KeyError(name)
    _registry[name].interval_sec = interval_sec
    return _registry[name]


# ─── Runner ───────────────────────────────────────────────────────────────────

async def _run_job(
    state: JobState,
    fn: Callable[[], Coroutine[Any, Any, None]],
) -> None:
    state.last_status = "running"
    state.last_run_at = datetime.now(timezone.utc)
    try:
        await fn()
        state.last_status = "ok"
        state.last_error  = None
        state.run_count  += 1
        log.info("Cron job '%s' completed OK (run #%d)", state.name, state.run_count)
    except Exception as exc:
        state.last_status = "error"
        state.last_error  = str(exc)
        state.run_count  += 1
        log.exception("Cron job '%s' failed: %s", state.name, exc)


async def _loop(
    state: JobState,
    fn: Callable[[], Coroutine[Any, Any, None]],
) -> None:
    """Infinite loop: optionally run immediately, then sleep-and-repeat."""
    if not state.run_immediately:
        await asyncio.sleep(state.interval_sec)

    while True:
        await _run_job(state, fn)
        await asyncio.sleep(state.interval_sec)


# ─── Job definitions ──────────────────────────────────────────────────────────

async def _sync_fireflies() -> None:
    """Pull latest Fireflies transcripts and ingest any not yet in DB."""
    from core.config import settings
    if not settings.fireflies_api_key:
        log.info("Fireflies sync skipped — no API key configured")
        return

    from db.session import AsyncSessionLocal
    from db.models import User
    from sqlalchemy import select
    from connectors.fireflies import FirefliesClient
    from jobs.meeting_processor import ingest_from_webhook, process_meeting

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).limit(1))
        user   = result.scalar_one_or_none()
        if not user:
            return

    client      = FirefliesClient(settings.fireflies_api_key)
    transcripts = await client.list_recent(limit=20)
    ingested    = 0

    for t in transcripts:
        tid = t.get("id")
        if not tid:
            continue
        async with AsyncSessionLocal() as db:
            new_id = await ingest_from_webhook(db, user.id, tid)
            if new_id:
                await process_meeting(db, new_id, user.id)
                ingested += 1

    log.info("Fireflies sync: %d new meeting(s) ingested", ingested)


async def _sync_google_people() -> None:
    """Pull Google Contacts diffs via sync token (or full sync on first run)."""
    from jobs.people_sync import sync_people
    await sync_people()


# ─── Public API ───────────────────────────────────────────────────────────────

_FOUR_HOURS  = 4 * 60 * 60
_FIVE_MINUTES = 5 * 60
_ONE_WEEK    = 7 * 24 * 60 * 60

async def _prompt_cron_loop() -> None:
    """
    Every 60 s: check all enabled prompt cron jobs in DB and fire any that are due.
    Runs concurrently — each job fires in its own task so one slow job doesn't block others.

    Race-condition fix: next_run_at is stamped to the NEXT occurrence in the DB
    before the task is spawned, so a second loop iteration 60 s later won't
    re-fire the same window even if execute() is still running.

    Stale-fire protection: is_due() returns False when the job is >30 min overdue
    (e.g. harness was down for hours). We still advance next_run_at so the job
    resumes on its normal future schedule.
    """
    # Initial delay so harness fully starts before first check
    await asyncio.sleep(30)

    while True:
        try:
            from db.session import AsyncSessionLocal
            from db.models import CronJob
            from sqlalchemy import select
            from jobs.prompt_cron import is_due, execute as _exec, next_run_at as _nxt

            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(CronJob).where(
                        CronJob.type == "prompt",
                        CronJob.enabled == True,
                    )
                )
                jobs = result.scalars().all()
                due_ids: list[str] = []

                now_utc = datetime.now(timezone.utc)
                changed = False
                for job in jobs:
                    if not job.schedule_config:
                        continue
                    tz = job.timezone or "Asia/Manila"
                    if is_due(job.schedule_config, tz, job.last_run_at, job.next_run_at):
                        log.info("Prompt cron '%s' is due — firing", job.name)
                        due_ids.append(job.id)
                        # Immediately stamp next_run_at so a second loop
                        # iteration can't double-fire this window.
                        job.next_run_at = _nxt(job.schedule_config, tz, job.last_run_at)
                        changed = True
                    elif job.next_run_at and now_utc > job.next_run_at:
                        # Stale window (>30 min overdue) — advance to next occurrence
                        log.info(
                            "Prompt cron '%s' missed its window (>30 min late) — skipping to next", job.name
                        )
                        job.next_run_at = _nxt(job.schedule_config, tz, job.last_run_at)
                        changed = True

                if changed:
                    await db.commit()

            for job_id in due_ids:
                asyncio.create_task(_exec(job_id))

        except Exception as exc:
            log.exception("Prompt cron loop error: %s", exc)

        await asyncio.sleep(60)


def build_tasks() -> list[asyncio.Task]:
    """
    Create and start all scheduled jobs.
    Call once from the FastAPI lifespan — returns asyncio Tasks to cancel on shutdown.
    """
    connector_jobs = [
        (
            JobState(
                name="fireflies_sync",
                description="Pull latest Fireflies transcripts every 4 hours",
                interval_sec=_FOUR_HOURS,
                run_immediately=True,
            ),
            _sync_fireflies,
        ),
        (
            JobState(
                name="google_people_sync",
                description="Pull Google Contacts diffs once a week",
                interval_sec=_ONE_WEEK,
                run_immediately=True,
            ),
            _sync_google_people,
        ),
    ]

    tasks = []
    for state, fn in connector_jobs:
        _registry[state.name] = state
        tasks.append(asyncio.create_task(_loop(state, fn)))
        log.info("Connector cron '%s' scheduled every %ds", state.name, state.interval_sec)

    # Prompt cron wall-clock checker
    tasks.append(asyncio.create_task(_prompt_cron_loop()))
    log.info("Prompt cron wall-clock checker started (60 s interval)")

    return tasks
