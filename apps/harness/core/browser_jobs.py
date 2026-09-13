"""
Live registry of browser runs.

Deliberately in-memory and not a DB table. A browser job has two audiences and
neither needs a row: the observation panel watches a run that is happening right
now, and the durable record of what a run produced is an Artifact. Adding a
table would mean a migration to store state whose whole lifetime is one run.

If job history ever needs to outlive the process, that is the point to add the
table, not before.
"""

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

log = logging.getLogger(__name__)

MAX_EVENTS_PER_JOB = 500   # a long run is chatty; keep the tail, drop the head
MAX_RETAINED_JOBS = 20     # finished jobs stay briefly so a late panel can catch up


@dataclass
class BrowserJob:
    id: str
    task: str
    status: str = "running"  # "running" | "done" | "failed"
    events: List[dict] = field(default_factory=list)
    subscribers: Set[asyncio.Queue] = field(default_factory=set)
    result: Optional[str] = None
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    finished_at: Optional[float] = None
    session: Any = None  # live BrowserSession, for pause/resume; cleared on finish

    def snapshot(self) -> dict:
        return {
            "id": self.id,
            "task": self.task,
            "status": self.status,
            "result": self.result,
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "event_count": len(self.events),
            "paused": bool(self.session is not None and self.session.is_paused),
        }


class BrowserJobRegistry:
    def __init__(self) -> None:
        self._jobs: Dict[str, BrowserJob] = {}

    def create(self, task: str) -> BrowserJob:
        job = BrowserJob(id=uuid.uuid4().hex[:12], task=task)
        self._jobs[job.id] = job
        self._evict()
        return job

    def get(self, job_id: str) -> Optional[BrowserJob]:
        return self._jobs.get(job_id)

    def attach_session(self, job_id: str, session: Any) -> None:
        job = self._jobs.get(job_id)
        if job:
            job.session = session

    def active(self) -> List[dict]:
        return [j.snapshot() for j in self._jobs.values() if j.status == "running"]

    def recent(self) -> List[dict]:
        return [
            j.snapshot()
            for j in sorted(self._jobs.values(), key=lambda j: -j.started_at)
        ]

    async def publish(self, job_id: str, event: dict) -> None:
        """Record an event and fan it out to anyone watching."""
        job = self._jobs.get(job_id)
        if job is None:
            return
        job.events.append(event)
        if len(job.events) > MAX_EVENTS_PER_JOB:
            del job.events[: len(job.events) - MAX_EVENTS_PER_JOB]
        for queue in list(job.subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # A panel that can't keep up loses frames rather than stalling
                # the run. The run is the thing that matters.
                log.debug("browser job %s: subscriber queue full", job_id)

    async def publish_frame(self, job_id: str, frame: dict) -> None:
        """Fan out a screencast frame WITHOUT retaining it.

        Frames are live-only. Storing them would put ~25MB of stale JPEG in
        memory per job, and a replayed frame from four minutes ago tells a
        late watcher nothing that the action feed doesn't already say.
        """
        job = self._jobs.get(job_id)
        if job is None:
            return
        for queue in list(job.subscribers):
            if queue.qsize() > 8:
                continue  # a slow panel drops frames; it never stalls the run
            try:
                queue.put_nowait(frame)
            except asyncio.QueueFull:
                pass

    def has_watchers(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        return bool(job and job.subscribers)

    def subscribe(self, job_id: str) -> Optional[asyncio.Queue]:
        job = self._jobs.get(job_id)
        if job is None:
            return None
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        for event in job.events:  # replay so a late watcher sees the whole run
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                break
        job.subscribers.add(queue)
        return queue

    def unsubscribe(self, job_id: str, queue: asyncio.Queue) -> None:
        job = self._jobs.get(job_id)
        if job:
            job.subscribers.discard(queue)

    def finish(self, job_id: str, *, result: str = None, error: str = None) -> None:
        job = self._jobs.get(job_id)
        if job is None:
            return
        job.status = "failed" if error else "done"
        job.result = result
        job.error = error
        job.finished_at = time.time()
        # Drop the session reference so a finished job can't hold a closed
        # browser context alive, and so pause/resume 409s instead of no-oping.
        job.session = None

    def _evict(self) -> None:
        finished = sorted(
            (j for j in self._jobs.values() if j.status != "running"),
            key=lambda j: j.finished_at or 0,
        )
        while len(self._jobs) > MAX_RETAINED_JOBS and finished:
            self._jobs.pop(finished.pop(0).id, None)


_registry: Optional[BrowserJobRegistry] = None


def get_browser_jobs() -> BrowserJobRegistry:
    global _registry
    if _registry is None:
        _registry = BrowserJobRegistry()
    return _registry
