"""
Harness scheduler — lightweight asyncio-based periodic jobs.
No Redis/BullMQ needed: jobs run inside the FastAPI process on a fixed cadence.

Registered jobs run on startup and repeat on their configured interval.
State (last_run, last_status, next_run) is kept in memory and exposed via
the /api/cron endpoint so the Cron Manager UI can display them.
"""

import asyncio
import logging
from dataclasses import dataclass, field
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

def build_tasks() -> list[asyncio.Task]:
    """
    Create and start all scheduled jobs.
    Call once from the FastAPI lifespan — returns asyncio Tasks to cancel on shutdown.
    """
    jobs = [
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
                description="Pull Google Contacts diffs every 5 minutes",
                interval_sec=_FIVE_MINUTES,
                run_immediately=True,
            ),
            _sync_google_people,
        ),
    ]

    tasks = []
    for state, fn in jobs:
        _registry[state.name] = state
        tasks.append(asyncio.create_task(_loop(state, fn)))
        log.info("Cron job '%s' scheduled every %ds", state.name, state.interval_sec)

    return tasks
