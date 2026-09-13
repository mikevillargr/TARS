"""
Browser sessions a human opens, rather than ones an agent starts.

The agent-run case is a job with a beginning and an end. This is the other
shape: you open a browser from a conversation, drive it yourself over VNC, and
TARS can see what is on screen so you can ask about it in the same breath.

Bound to a conversation on purpose. "Open a browser" with no context is just a
browser; the point is that the thread you are in and the page you are on know
about each other, so `browse_web` continues in the tab you already opened and
TARS can answer "what am I looking at".

These run on the container's PERSISTENT profile, not a fresh context, because a
human may sign in here and an ephemeral context would throw that away on close.
That also means the context must never be closed: it is the container's only
browser. Stopping the screencast is the whole teardown.

They still time out. An abandoned session keeps a screencast running and keeps
claiming to be "this conversation's browser", so it should not live forever.
"""

import asyncio
import logging
import time
from typing import Dict, Optional

from connectors.browser import get_browser_pool
from core.browser_jobs import get_browser_jobs

log = logging.getLogger(__name__)

IDLE_TIMEOUT_S = 45 * 60
POLL_S = 5


class ManualSession:
    """One human-driven browser, alive until closed or idle-timed-out."""

    def __init__(self, job_id: str, conversation_id: Optional[str]):
        self.job_id = job_id
        self.conversation_id = conversation_id
        self.session = None
        self.opened_at = time.time()
        self.last_seen = time.time()
        self.url: Optional[str] = None
        self.title: Optional[str] = None
        self._close = asyncio.Event()
        self._task: Optional[asyncio.Task] = None

    def touch(self) -> None:
        self.last_seen = time.time()

    def close(self) -> None:
        self._close.set()

    async def _run(self) -> None:
        jobs = get_browser_jobs()
        pool = get_browser_pool()
        try:
            # The PERSISTENT profile, not a fresh context. A human may sign in
            # here, and an ephemeral context would discard that on close —
            # silently undoing the exact thing they were doing.
            session = await pool.persistent_session()
            self.session = session
            jobs.attach_session(self.job_id, session)
            try:
                async def on_frame(frame: dict) -> None:
                    await jobs.publish_frame(self.job_id, frame)

                await session.start_screencast(on_frame)
                await jobs.publish(
                    self.job_id,
                    {"type": "say", "text": "Browser open. Take over to drive it.", "at": time.time()},
                )

                while not self._close.is_set():
                    try:
                        await asyncio.wait_for(self._close.wait(), timeout=POLL_S)
                        break
                    except asyncio.TimeoutError:
                        pass
                    # Track where the human went, so chat can be told about it.
                    try:
                        page = session._page()
                        self.url = page.url
                        self.title = (await page.title())[:200]
                    except Exception:  # noqa: BLE001 — page may be mid-navigation
                        pass
                    if time.time() - self.last_seen > IDLE_TIMEOUT_S:
                        log.info("manual browser %s idle-closed", self.job_id)
                        await jobs.publish(
                            self.job_id,
                            {"type": "say", "text": "Closed after 45 minutes idle.",
                             "at": time.time()},
                        )
                        break
            finally:
                # Stop watching and close the tab WE opened. Never the context:
                # it is the container's only browser and closing it kills
                # everything, which is exactly the bug that took Chrome down.
                await session.stop_screencast()
                await session.close_own_page()
        except Exception as err:  # noqa: BLE001
            log.exception("manual browser %s failed", self.job_id)
            jobs.finish(self.job_id, error=str(err))
            _registry.pop(self.job_id, None)
            return
        jobs.finish(self.job_id, result=f"Browser closed ({self.url or 'no page'}).")
        _registry.pop(self.job_id, None)

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())


_registry: Dict[str, ManualSession] = {}


async def open_manual_session(conversation_id: Optional[str]) -> ManualSession:
    """Reuse this conversation's browser if it already has one."""
    existing = for_conversation(conversation_id)
    if existing:
        existing.touch()
        return existing

    jobs = get_browser_jobs()
    job = jobs.create("Browser opened manually")
    manual = ManualSession(job.id, conversation_id)
    _registry[job.id] = manual
    manual.start()
    return manual


def get_manual(job_id: str) -> Optional[ManualSession]:
    return _registry.get(job_id)


def for_conversation(conversation_id: Optional[str]) -> Optional[ManualSession]:
    if not conversation_id:
        return None
    for m in _registry.values():
        if m.conversation_id == conversation_id:
            return m
    return None
