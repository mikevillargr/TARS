import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
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


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[ConnectorOut])
async def get_connectors(_: str = Depends(require_auth)):
    return [
        ConnectorOut(
            id=c.id,
            name=c.name,
            status=c.status,
            capabilities=c.capabilities,
            last_synced_at=c.last_synced_at,
            metadata=c.metadata,
        )
        for c in list_connectors()
    ]


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
    """
    Fireflies calls this when a transcription is complete.
    Payload: {"meetingId": "...", "eventType": "Transcription completed"}
    """
    payload = await request.json()
    transcript_id = payload.get("meetingId")
    event_type = payload.get("eventType", "unknown")

    log.info("Fireflies webhook: %s / transcript %s", event_type, transcript_id)

    if not transcript_id:
        log.warning("Fireflies webhook missing meetingId")
        return {"ok": False, "error": "missing meetingId"}

    # Look up the single user (TARS is single-user)
    user_result = await db.execute(select(User).limit(1))
    user = user_result.scalar_one_or_none()
    if not user:
        log.error("No user found for webhook processing")
        return {"ok": False, "error": "no user"}

    # Log the webhook event (using a pseudo connector_id for Fireflies)
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
    await db.refresh(event)

    # Process in background so we return immediately to Fireflies
    async def _process():
        from jobs.meeting_processor import ingest_from_webhook, process_meeting
        meeting_id = await ingest_from_webhook(db, user.id, transcript_id)
        if meeting_id:
            await process_meeting(db, meeting_id, user.id)
            # Mark webhook event processed
            event.processed = True
            event.processed_at = datetime.now(timezone.utc)
            await db.commit()

    background_tasks.add_task(_process)

    return {"ok": True, "queued": transcript_id}
