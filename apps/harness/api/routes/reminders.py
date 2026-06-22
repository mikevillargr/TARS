from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import Reminder
from db.session import get_db

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ReminderOut(BaseModel):
    id: str
    text: str
    done: bool
    due_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CreateReminderRequest(BaseModel):
    text: str
    due_at: Optional[datetime] = None


class UpdateReminderRequest(BaseModel):
    text: Optional[str] = None
    done: Optional[bool] = None
    due_at: Optional[datetime] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[ReminderOut])
async def list_reminders(
    done: Optional[str] = None,  # "true" | "false" | "all" (default: "false")
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    q = select(Reminder).where(Reminder.user_id == user_id)
    if done == "true":
        q = q.where(Reminder.done.is_(True))
    elif done == "all":
        pass
    else:
        q = q.where(Reminder.done.is_(False))
    q = q.order_by(Reminder.due_at.nullslast(), Reminder.created_at.desc())
    result = await db.execute(q)
    return result.scalars().all()


@router.post("", response_model=ReminderOut, status_code=201)
async def create_reminder(
    body: CreateReminderRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    reminder = Reminder(
        user_id=user_id,
        text=body.text,
        due_at=body.due_at,
    )
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)
    return reminder


@router.patch("/{reminder_id}", response_model=ReminderOut)
async def update_reminder(
    reminder_id: str,
    body: UpdateReminderRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    result = await db.execute(
        select(Reminder).where(Reminder.id == reminder_id, Reminder.user_id == user_id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    if body.text is not None:
        reminder.text = body.text
    if body.done is not None:
        reminder.done = body.done
    if body.due_at is not None:
        reminder.due_at = body.due_at
    reminder.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(reminder)
    return reminder


@router.delete("/{reminder_id}", status_code=204)
async def delete_reminder(
    reminder_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    result = await db.execute(
        select(Reminder).where(Reminder.id == reminder_id, Reminder.user_id == user_id)
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(status_code=404, detail="Reminder not found")
    await db.delete(reminder)
    await db.commit()
