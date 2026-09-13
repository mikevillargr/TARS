"""
Browser job routes — status, and the live event stream the observation panel
subscribes to.

The WebSocket mirrors api/routes/rokid.py: JWT on the query string, because a
browser WebSocket cannot set an Authorization header.

This is the event half of the panel. The pixel half (CDP screencast frames) is
Phase 4 and lands on the same socket as a `frame` event, so the client only ever
opens one connection.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from core.auth import require_auth, verify_ws_token
from core.browser_jobs import get_browser_jobs

log = logging.getLogger(__name__)

router = APIRouter(prefix="/browser", tags=["browser"])


@router.get("/jobs")
async def list_jobs(user_id: str = Depends(require_auth)):
    jobs = get_browser_jobs()
    return {"active": jobs.active(), "recent": jobs.recent()}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, user_id: str = Depends(require_auth)):
    job = get_browser_jobs().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown browser job")
    return {**job.snapshot(), "events": job.events}


@router.post("/jobs/{job_id}/pause")
async def pause_job(job_id: str, user_id: str = Depends(require_auth)):
    """Hold the run. Takes effect between turns, not mid-batch.

    On mobile this is the whole story: you can't usefully drive a 1280px
    viewport with a thumb, so pausing hands the run back to you for later
    rather than pretending take-over works there.
    """
    job = get_browser_jobs().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown browser job")
    if job.session is None:
        raise HTTPException(status_code=409, detail="Job is no longer running")
    job.session.pause()
    return job.snapshot()


@router.post("/jobs/{job_id}/resume")
async def resume_job(job_id: str, user_id: str = Depends(require_auth)):
    job = get_browser_jobs().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown browser job")
    if job.session is None:
        raise HTTPException(status_code=409, detail="Job is no longer running")
    job.session.resume()
    return job.snapshot()


@router.websocket("/ws/{job_id}")
async def job_events(
    websocket: WebSocket, job_id: str, token: str = Query(...)
):
    """Stream a job's events, replaying what already happened first.

    Replay matters: a run often starts before the panel is open, and a feed that
    only shows what happened after you looked is worse than no feed.
    """
    if not verify_ws_token(token):
        await websocket.close(code=4401)
        return

    jobs = get_browser_jobs()
    job = jobs.get(job_id)
    if job is None:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    queue = jobs.subscribe(job_id)
    if queue is None:
        await websocket.close(code=4404)
        return

    try:
        await websocket.send_json({"type": "snapshot", **job.snapshot()})
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=20)
            except asyncio.TimeoutError:
                # Keepalive: idle proxies drop a silent socket, and a browser
                # run can legitimately sit on one page for a while.
                await websocket.send_json({"type": "ping"})
                continue
            await websocket.send_json(event)
            if event.get("type") in ("done", "refusal", "exhausted"):
                await websocket.send_json({"type": "snapshot", **job.snapshot()})
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        log.exception("browser ws for job %s failed", job_id)
    finally:
        jobs.unsubscribe(job_id, queue)
