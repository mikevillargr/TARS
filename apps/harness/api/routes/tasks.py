from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import Task
from db.session import get_db

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class TaskOut(BaseModel):
    id: str
    title: str
    description: Optional[str]
    status: str
    priority: str
    due_at: Optional[datetime]
    source: Optional[str]
    source_id: Optional[str]
    assigned_to: Optional[str]
    connector_ref: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CreateTaskRequest(BaseModel):
    title: str
    description: Optional[str] = None
    status: str = "inbox"
    priority: str = "normal"
    due_at: Optional[datetime] = None


class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_at: Optional[datetime] = None


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[TaskOut])
async def list_tasks(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task)
        .where(Task.user_id == user_id)
        .order_by(desc(Task.created_at))
        .limit(200)
    )
    return result.scalars().all()


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(
    body: CreateTaskRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    task = Task(
        user_id=user_id,
        title=body.title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        due_at=body.due_at,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    return task


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: str,
    body: UpdateTaskRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(task, field, value)

    await db.commit()
    await db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=204)
async def delete_task(
    task_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.user_id == user_id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.delete(task)
    await db.commit()
