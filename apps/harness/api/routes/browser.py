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
from typing import Optional

from pydantic import BaseModel

from fastapi import (
    APIRouter, Depends, HTTPException, Query, Request, WebSocket, WebSocketDisconnect,
)

from core.auth import decode_token, require_auth, verify_ws_token
from core.config import settings
from core.browser_jobs import get_browser_jobs
from core.browser_manual import for_conversation, get_manual, open_manual_session

log = logging.getLogger(__name__)

router = APIRouter(prefix="/browser", tags=["browser"])


@router.get("/vnc-auth")
async def vnc_auth(request: Request):
    """Gate for nginx's `auth_request` on /browser-vnc/.

    Reads the `tars_token` cookie rather than a Bearer header: nginx forwards
    the browser's cookies, and noVNC is a plain page load with no chance to set
    an Authorization header. 200 lets the request through, 401 blocks it.

    This is the only door to interactive control of a browser holding live
    client-portal logins, so it validates the same session as the rest of the
    app and nothing weaker.
    """
    token = request.cookies.get("tars_token")
    if not token or not decode_token(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"ok": True}


@router.get("/capabilities")
async def capabilities(user_id: str = Depends(require_auth)):
    """What this deployment can actually do.

    Take-over needs the browser container: in local dev the harness launches a
    headless in-process Chromium with no display to attach to. The client asks
    rather than assuming, so the button is enabled only where it works instead
    of being permanently greyed out or, worse, opening a dead iframe.
    """
    container = bool(settings.browser_cdp_url)
    return {
        "takeover": container,
        # The full URL, params included, so exactly one place knows how to
        # build it. `path` is the load-bearing one: noVNC resolves its
        # websockify path against the SERVER ROOT, not the page, so without it
        # the client opens wss://host/websockify, which lands on the Next.js
        # catch-all and hangs on "Connecting..." forever.
        "vnc_url": (
            "/browser-vnc/?autoconnect=1&resize=scale&path=browser-vnc/websockify"
            if container
            else None
        ),
    }


class OpenSessionRequest(BaseModel):
    conversation_id: Optional[str] = None


@router.post("/sessions")
async def open_session(
    body: OpenSessionRequest, user_id: str = Depends(require_auth)
):
    """Open a browser a human drives, bound to a conversation.

    Idempotent per conversation: asking twice returns the browser you already
    have open rather than stacking up sessions against the pool's slot limit.
    """
    if not settings.browser_cdp_url:
        raise HTTPException(
            status_code=409,
            detail="Manual browser needs the browser container (BROWSER_CDP_URL unset).",
        )
    manual = await open_manual_session(body.conversation_id)
    return {
        "job_id": manual.job_id,
        "conversation_id": manual.conversation_id,
        "manual": True,
        "url": manual.url,
    }


@router.delete("/sessions/{job_id}")
async def close_session(job_id: str, user_id: str = Depends(require_auth)):
    manual = get_manual(job_id)
    if manual is None:
        raise HTTPException(status_code=404, detail="No such manual browser")
    manual.close()
    return {"ok": True}


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
    # Taking over means you are about to look at this. Raise the tab being
    # driven so VNC shows that page and not whichever window happens to be on
    # top of the X display.
    await job.session.focus()
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
    manual = get_manual(job_id)
    if manual:
        manual.touch()   # watching counts as activity against the idle timeout
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
