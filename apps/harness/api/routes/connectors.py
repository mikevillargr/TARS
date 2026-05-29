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

    # Enrich Gmail / GCal with last_synced_at from DB if tokens stored
    db_result = await db.execute(select(Connector))
    db_connectors = {c.name.lower(): c for c in db_result.scalars().all()}

    out = []
    for c in static:
        db_conn = db_connectors.get(c.id)
        last_synced = (
            db_conn.last_synced_at.isoformat() if db_conn and db_conn.last_synced_at else None
        )
        # If tokens are in DB, mark as connected regardless of env vars
        if db_conn and db_conn.auth.get("refresh_token"):
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
    if connector not in ("gmail", "gcal"):
        raise HTTPException(status_code=400, detail="Unknown connector")

    from connectors.google_oauth import get_auth_url
    via_prod = "localhost" not in str(request.base_url)
    url = get_auth_url(connector, via_production=via_prod)
    return RedirectResponse(url)


@router.get("/oauth/callback/{connector}")
async def oauth_callback(
    connector: str,
    code: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Google redirects here after user grants access. No JWT needed — browser-driven."""
    if connector not in ("gmail", "gcal"):
        raise HTTPException(status_code=400, detail="Unknown connector")
    if not code:
        raise HTTPException(status_code=400, detail="Missing code")

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

    name_map = {"gmail": "Gmail", "gcal": "Google Calendar"}
    caps_map = {"gmail": ["read", "webhook"], "gcal": ["read", "write"]}

    conn_result = await db.execute(
        select(Connector).where(
            Connector.user_id == user.id,
            Connector.name == name_map[connector],
        )
    )
    conn = conn_result.scalar_one_or_none()
    if conn:
        conn.auth = auth
        conn.status = "connected"
    else:
        conn = Connector(
            user_id=user.id,
            name=name_map[connector],
            status="connected",
            auth=auth,
            capabilities=caps_map[connector],
        )
        db.add(conn)

    await db.commit()
    log.info("%s connected for user %s", name_map[connector], user.id)

    # Redirect back to connectors page
    base = "https://tarsmv.duckdns.org" if via_prod else "http://localhost:3000"
    return RedirectResponse(f"{base}/connectors?connected={connector}")


@router.delete("/oauth/{connector}", status_code=204)
async def oauth_disconnect(
    connector: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    name_map = {"gmail": "Gmail", "gcal": "Google Calendar"}
    if connector not in name_map:
        raise HTTPException(status_code=400, detail="Unknown connector")

    result = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id,
            Connector.name == name_map[connector],
        )
    )
    conn = result.scalar_one_or_none()
    if conn:
        conn.auth = {}
        conn.status = "disconnected"
        await db.commit()


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
