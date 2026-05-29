import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import Meeting, MeetingActionItem, Task
from db.session import get_db
from jobs.meeting_processor import process_meeting

log = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ActionItemOut(BaseModel):
    id: str
    raw_text: str
    owner: Optional[str]
    task_id: Optional[str]

    class Config:
        from_attributes = True


class MeetingOut(BaseModel):
    id: str
    title: str
    status: str
    attendees: list
    summary: Optional[str]
    started_at: Optional[datetime]
    ended_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class MeetingDetailOut(MeetingOut):
    transcript: Optional[str]
    action_items: List[ActionItemOut]


class CreateTaskFromActionItemRequest(BaseModel):
    title: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[MeetingOut])
async def list_meetings(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Meeting)
        .where(Meeting.user_id == user_id)
        .order_by(desc(Meeting.created_at))
        .limit(50)
    )
    return result.scalars().all()


@router.get("/{meeting_id}", response_model=MeetingDetailOut)
async def get_meeting(
    meeting_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")

    items_result = await db.execute(
        select(MeetingActionItem).where(MeetingActionItem.meeting_id == meeting_id)
    )
    action_items = items_result.scalars().all()

    return MeetingDetailOut(
        **{c.key: getattr(meeting, c.key) for c in Meeting.__table__.columns},
        action_items=action_items,
    )


@router.delete("/{meeting_id}", status_code=204)
async def delete_meeting(
    meeting_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found")
    await db.delete(meeting)
    await db.commit()


@router.post("/{meeting_id}/process", status_code=202)
async def trigger_processing(
    meeting_id: str,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Manually re-trigger AI processing for a meeting."""
    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Meeting not found")

    background_tasks.add_task(process_meeting, db, meeting_id, user_id)
    return {"queued": True}


@router.post("/{meeting_id}/action-items/{item_id}/create-task", status_code=201)
async def create_task_from_action_item(
    meeting_id: str,
    item_id: str,
    body: CreateTaskFromActionItemRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    item_result = await db.execute(
        select(MeetingActionItem).where(
            MeetingActionItem.id == item_id,
            MeetingActionItem.meeting_id == meeting_id,
        )
    )
    item = item_result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Action item not found")

    # Verify meeting belongs to user
    mtg_result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user_id)
    )
    if not mtg_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Meeting not found")

    title = body.title or item.raw_text[:120]
    task = Task(
        user_id=user_id,
        title=title,
        status="inbox",
        source="meeting",
        source_id=meeting_id,
        assigned_to=item.owner,
    )
    db.add(task)
    await db.flush()

    item.task_id = task.id
    await db.commit()
    await db.refresh(task)

    return {"task_id": task.id, "title": task.title}


@router.post("/sync", status_code=202)
async def sync_from_fireflies(
    background_tasks: BackgroundTasks,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Pull the last 20 Fireflies transcripts and ingest any not already in DB."""
    from core.config import settings
    if not settings.fireflies_api_key:
        raise HTTPException(status_code=503, detail="Fireflies not configured")

    captured_user_id = user_id  # capture before session closes

    async def _sync():
        from db.session import AsyncSessionLocal
        from connectors.fireflies import FirefliesClient
        from jobs.meeting_processor import ingest_from_webhook, process_meeting

        client = FirefliesClient(settings.fireflies_api_key)
        transcripts = await client.list_recent(limit=20)
        for t in transcripts:
            tid = t.get("id")
            if not tid:
                continue
            async with AsyncSessionLocal() as bg_db:
                try:
                    new_id = await ingest_from_webhook(bg_db, captured_user_id, tid)
                    if new_id:
                        await process_meeting(bg_db, new_id, captured_user_id)
                except Exception:
                    log.exception("Sync failed for transcript %s", tid)

    background_tasks.add_task(_sync)
    return {"queued": True}
