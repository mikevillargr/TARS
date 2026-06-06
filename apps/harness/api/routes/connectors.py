import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import User, WebhookEvent, Connector
from db.session import get_db
from connectors.registry import list_connectors

log = logging.getLogger(__name__)
router = APIRouter()


# ── Single source of truth: connector id → human name / capabilities ──────────
# Used by both the OAuth callback and the status enrichment in get_connectors.
_CONNECTOR_NAMES = {
    "gmail":         "Gmail",
    "gcal":          "Google Calendar",
    "google_people": "Google Contacts",
    "strava":        "Strava",
    "garmin":        "Garmin Connect",
}
_CONNECTOR_CAPS = {
    "gmail":         ["read", "webhook"],
    "gcal":          ["read", "write"],
    "google_people": ["read", "write"],
    "strava":        ["read"],
    "garmin":        ["read"],
}
_GOOGLE_CONNECTORS = {"gmail", "gcal", "google_people"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class ConnectorOut(BaseModel):
    id: str
    name: str
    status: str
    capabilities: List[str]
    last_synced_at: Optional[str]
    metadata: dict


class WebhookEventOut(BaseModel):
    id: str
    connector_id: str
    event_type: str
    processed: bool
    processed_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ── Connector status ──────────────────────────────────────────────────────────

@router.get("", response_model=List[ConnectorOut])
async def get_connectors(
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    static = list_connectors()

    # Enrich each connector with last_synced_at + true connected status from DB
    # Map static.id → DB row via _CONNECTOR_NAMES (handles non-trivial mappings
    # like "gcal" → "Google Calendar" and "google_people" → "Google Contacts")
    db_result = await db.execute(select(Connector))
    db_by_name = {c.name: c for c in db_result.scalars().all()}

    out = []
    for c in static:
        # Prefer mapped name; fall back to lookup-by-name for any id we don't
        # know about (e.g. Fireflies — name in DB == name in registry)
        db_conn = db_by_name.get(_CONNECTOR_NAMES.get(c.id, c.name))
        last_synced = (
            db_conn.last_synced_at.isoformat() if db_conn and db_conn.last_synced_at else None
        )
        if db_conn:
            # OAuth connectors: check for refresh_token in auth
            # Strava: check for access_token in auth
            # Garmin: check for garth_tokens in config
            if c.id == "garmin":
                if db_conn.config.get("garth_tokens"):
                    c.status = "connected"
            elif c.id == "strava":
                if db_conn.auth.get("access_token"):
                    c.status = "connected"
            elif db_conn.auth.get("refresh_token"):
                c.status = "connected"
        out.append(ConnectorOut(
            id=c.id,
            name=c.name,
            status=c.status,
            capabilities=c.capabilities,
            last_synced_at=last_synced,
            metadata=c.metadata,
        ))
    return out


# ── Google OAuth flow ─────────────────────────────────────────────────────────

@router.get("/oauth/authorize/{connector}")
async def oauth_authorize(connector: str, request: Request):
    """Redirect user to Google's OAuth consent page. No auth needed — just a redirect."""
    if connector not in _GOOGLE_CONNECTORS:
        raise HTTPException(status_code=400, detail="Unknown connector")

    from connectors.google_oauth import get_auth_url
    via_prod = "localhost" not in str(request.base_url)
    url = get_auth_url(connector, via_production=via_prod)
    return RedirectResponse(url)


@router.get("/oauth/callback/{connector}")
async def oauth_callback(
    connector: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    code: Optional[str] = None,
    error: Optional[str] = None,
):
    """Google redirects here after user grants access. No JWT needed — browser-driven."""
    if connector not in _GOOGLE_CONNECTORS:
        raise HTTPException(status_code=400, detail="Unknown connector")

    # Google sends ?error=... if user denies or there's a scope/config problem
    if error or not code:
        via_prod = "localhost" not in str(request.base_url)
        base = "https://tarsmv.duckdns.org" if via_prod else "http://localhost:3000"
        log.warning("OAuth callback error for %s: %s", connector, error or "missing code")
        return RedirectResponse(f"{base}/connectors?error={error or 'missing_code'}")

    from connectors.google_oauth import exchange_code

    via_prod = "localhost" not in str(request.base_url)
    try:
        auth = await exchange_code(connector, code, via_production=via_prod)
    except Exception as exc:
        log.exception("OAuth exchange failed for %s: %s", connector, exc)
        raise HTTPException(status_code=400, detail=f"OAuth exchange failed: {exc}")

    # Single-user: get or create the one user
    user_result = await db.execute(select(User).limit(1))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=500, detail="No user in database")

    conn_result = await db.execute(
        select(Connector).where(
            Connector.user_id == user.id,
            Connector.name == _CONNECTOR_NAMES[connector],
        )
    )
    conn = conn_result.scalar_one_or_none()
    if conn:
        conn.auth = auth
        conn.status = "connected"
    else:
        conn = Connector(
            user_id=user.id,
            name=_CONNECTOR_NAMES[connector],
            status="connected",
            auth=auth,
            capabilities=_CONNECTOR_CAPS[connector],
        )
        db.add(conn)

    await db.commit()
    log.info("%s connected for user %s", _CONNECTOR_NAMES[connector], user.id)

    # Redirect back to connectors page
    base = "https://tarsmv.duckdns.org" if via_prod else "http://localhost:3000"
    return RedirectResponse(f"{base}/connectors?connected={connector}")


@router.delete("/oauth/{connector}", status_code=204)
async def oauth_disconnect(
    connector: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if connector not in _GOOGLE_CONNECTORS and connector != "strava":
        raise HTTPException(status_code=400, detail="Unknown connector")

    result = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id,
            Connector.name == _CONNECTOR_NAMES[connector],
        )
    )
    conn = result.scalar_one_or_none()
    if conn:
        conn.auth = {}
        conn.status = "disconnected"
        await db.commit()


# ── Strava OAuth flow ─────────────────────────────────────────────────────────

@router.get("/oauth/authorize/strava")
async def strava_authorize(request: Request):
    from core.config import settings
    if not settings.strava_client_id:
        raise HTTPException(status_code=503, detail="STRAVA_CLIENT_ID not configured")

    via_prod = "localhost" not in str(request.base_url)
    redirect_uri = (
        "https://tarsmv.duckdns.org/api/connectors/oauth/callback/strava"
        if via_prod
        else "http://localhost:8000/api/connectors/oauth/callback/strava"
    )
    from connectors.strava import get_auth_url
    return RedirectResponse(get_auth_url(settings.strava_client_id, redirect_uri))


@router.get("/oauth/callback/strava")
async def strava_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
    code: Optional[str] = None,
    error: Optional[str] = None,
):
    via_prod = "localhost" not in str(request.base_url)
    base = "https://tarsmv.duckdns.org" if via_prod else "http://localhost:3000"

    if error or not code:
        log.warning("Strava OAuth error: %s", error or "missing code")
        return RedirectResponse(f"{base}/connectors?error={error or 'missing_code'}")

    from core.config import settings
    from connectors.strava import exchange_code

    redirect_uri = (
        "https://tarsmv.duckdns.org/api/connectors/oauth/callback/strava"
        if via_prod
        else "http://localhost:8000/api/connectors/oauth/callback/strava"
    )
    try:
        auth = await exchange_code(settings.strava_client_id, settings.strava_client_secret, code)
    except Exception as exc:
        log.exception("Strava token exchange failed: %s", exc)
        raise HTTPException(status_code=400, detail=f"Strava token exchange failed: {exc}")

    user_result = await db.execute(select(User).limit(1))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=500, detail="No user in database")

    conn_result = await db.execute(
        select(Connector).where(Connector.user_id == user.id, Connector.name == "Strava")
    )
    conn = conn_result.scalar_one_or_none()
    if conn:
        conn.auth = auth
        conn.status = "connected"
    else:
        conn = Connector(
            user_id=user.id,
            name="Strava",
            status="connected",
            auth=auth,
            capabilities=["read"],
        )
        db.add(conn)

    await db.commit()
    log.info("Strava connected for user %s", user.id)
    return RedirectResponse(f"{base}/connectors?connected=strava")


# ── Garmin credentials flow ───────────────────────────────────────────────────

class GarminConnectBody(BaseModel):
    email: str
    password: str


@router.post("/garmin/connect", status_code=200)
async def garmin_connect(
    body: GarminConnectBody,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    from connectors.garmin import GarminClient
    try:
        tokens = await GarminClient.login(body.email, body.password)
    except Exception as exc:
        log.exception("Garmin login failed: %s", exc)
        raise HTTPException(status_code=400, detail=f"Garmin login failed: {exc}")

    conn_result = await db.execute(
        select(Connector).where(Connector.user_id == user_id, Connector.name == "Garmin Connect")
    )
    conn = conn_result.scalar_one_or_none()
    if conn:
        conn.config = {**conn.config, "garth_tokens": tokens}
        conn.status = "connected"
    else:
        conn = Connector(
            user_id=user_id,
            name="Garmin Connect",
            status="connected",
            config={"garth_tokens": tokens},
            capabilities=["read"],
        )
        db.add(conn)

    await db.commit()
    log.info("Garmin connected for user %s", user_id)
    return {"ok": True}


@router.delete("/garmin/disconnect", status_code=204)
async def garmin_disconnect(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Connector).where(Connector.user_id == user_id, Connector.name == "Garmin Connect")
    )
    conn = result.scalar_one_or_none()
    if conn:
        conn.config = {k: v for k, v in conn.config.items() if k != "garth_tokens"}
        conn.status = "disconnected"
        await db.commit()


# ── Connector config (sync interval etc.) ────────────────────────────────────

class ConnectorConfigPatch(BaseModel):
    sync_interval_minutes: Optional[int] = None


@router.patch("/{connector_id}/config", status_code=200)
async def patch_connector_config(
    connector_id: str,
    body: ConnectorConfigPatch,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    name = _CONNECTOR_NAMES.get(connector_id)
    if not name:
        raise HTTPException(status_code=400, detail="Unknown connector")

    result = await db.execute(
        select(Connector).where(Connector.user_id == user_id, Connector.name == name)
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connector not found — connect it first")

    patch = body.model_dump(exclude_none=True)
    conn.config = {**conn.config, **patch}

    # Live-update the scheduler interval if it's a registered job
    if body.sync_interval_minutes:
        job_name = f"{connector_id}_sync"
        try:
            from jobs.scheduler import update_interval
            update_interval(job_name, body.sync_interval_minutes * 60)
            log.info("%s sync interval updated to %d min", connector_id, body.sync_interval_minutes)
        except KeyError:
            pass  # Scheduler job may not be registered yet (harness restart will pick it up)

    await db.commit()
    return {"ok": True, "config": conn.config}


# ── Webhook log ───────────────────────────────────────────────────────────────

@router.get("/webhooks", response_model=List[WebhookEventOut])
async def list_webhook_events(
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(WebhookEvent)
        .order_by(desc(WebhookEvent.created_at))
        .limit(50)
    )
    return result.scalars().all()


# ── Fireflies webhook (no auth — inbound from Fireflies servers) ──────────────

@router.post("/webhooks/fireflies", status_code=200)
async def fireflies_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    payload = await request.json()
    transcript_id = payload.get("meetingId")
    event_type = payload.get("eventType", "unknown")

    log.info("Fireflies webhook: %s / transcript %s", event_type, transcript_id)

    if not transcript_id:
        return {"ok": False, "error": "missing meetingId"}

    user_result = await db.execute(select(User).limit(1))
    user = user_result.scalar_one_or_none()
    if not user:
        return {"ok": False, "error": "no user"}

    connector_result = await db.execute(
        select(Connector).where(Connector.name == "Fireflies").limit(1)
    )
    connector = connector_result.scalar_one_or_none()
    if not connector:
        connector = Connector(
            user_id=user.id,
            name="Fireflies",
            status="connected",
            capabilities=["read", "webhook"],
        )
        db.add(connector)
        await db.flush()

    event = WebhookEvent(
        connector_id=connector.id,
        event_type=event_type,
        payload=payload,
    )
    db.add(event)
    await db.commit()

    # Capture IDs now — the request-scoped session closes after this handler returns
    event_id   = event.id
    user_id    = user.id

    async def _process():
        """Background task: own session, independent of request lifecycle."""
        from db.session import AsyncSessionLocal
        from jobs.meeting_processor import ingest_from_webhook, process_meeting
        from sqlalchemy import select as sa_select

        async with AsyncSessionLocal() as bg_db:
            try:
                meeting_id = await ingest_from_webhook(bg_db, user_id, transcript_id)
                if meeting_id:
                    await process_meeting(bg_db, meeting_id, user_id)

                # Mark webhook event as processed
                ev_result = await bg_db.execute(
                    sa_select(WebhookEvent).where(WebhookEvent.id == event_id)
                )
                ev = ev_result.scalar_one_or_none()
                if ev:
                    ev.processed    = True
                    ev.processed_at = datetime.now(timezone.utc)
                    await bg_db.commit()
            except Exception:
                log.exception("Background meeting processing failed for transcript %s", transcript_id)

    background_tasks.add_task(_process)
    return {"ok": True, "queued": transcript_id}
