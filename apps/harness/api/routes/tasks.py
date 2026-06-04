from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc, func, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import Task, TaskColumn
from db.session import get_db

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class TaskColumnOut(BaseModel):
    id: str
    name: str
    color: str
    position: int

    class Config:
        from_attributes = True


class CreateColumnRequest(BaseModel):
    name: str
    color: str = "var(--c-ink-muted)"


class UpdateColumnRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    position: Optional[int] = None


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
    linked_artifacts: list = []
    linked_knowledge: list = []
    checklist: list = []
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
    linked_artifacts: List[str] = []
    linked_knowledge: List[str] = []
    checklist: List[dict] = []


class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_at: Optional[datetime] = None
    linked_artifacts: Optional[List[str]] = None
    linked_knowledge: Optional[List[str]] = None
    checklist: Optional[List[dict]] = None


# ── Default columns ───────────────────────────────────────────────────────────

_DEFAULT_COLUMNS = [
    ("inbox",       "Inbox",       "var(--c-ink-muted)", 0),
    ("todo",        "Todo",        "var(--c-moss)",      1),
    ("in_progress", "In Progress", "var(--c-amber)",     2),
    ("done",        "Done",        "var(--c-moss)",      3),
    ("snoozed",     "Snoozed",     "var(--c-ink-faint)", 4),
]


async def _seed_columns(user_id: str, db: AsyncSession) -> List[TaskColumn]:
    for col_id, name, color, pos in _DEFAULT_COLUMNS:
        col = TaskColumn(id=col_id, user_id=user_id, name=name, color=color, position=pos)
        db.add(col)
    await db.commit()
    result = await db.execute(
        select(TaskColumn)
        .where(TaskColumn.user_id == user_id)
        .order_by(TaskColumn.position, TaskColumn.created_at)
    )
    return result.scalars().all()


# ── Column routes (must precede /{task_id} routes) ────────────────────────────

@router.get("/columns", response_model=List[TaskColumnOut])
async def list_columns(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TaskColumn)
        .where(TaskColumn.user_id == user_id)
        .order_by(TaskColumn.position, TaskColumn.created_at)
    )
    cols = result.scalars().all()
    if not cols:
        cols = await _seed_columns(user_id, db)
    return cols


@router.post("/columns", response_model=TaskColumnOut, status_code=201)
async def create_column(
    body: CreateColumnRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    max_result = await db.execute(
        select(func.max(TaskColumn.position)).where(TaskColumn.user_id == user_id)
    )
    max_pos = max_result.scalar() or 0

    col = TaskColumn(
        user_id=user_id,
        name=body.name,
        color=body.color,
        position=max_pos + 1,
    )
    db.add(col)
    await db.commit()
    await db.refresh(col)
    return col


@router.patch("/columns/{col_id}", response_model=TaskColumnOut)
async def update_column(
    col_id: str,
    body: UpdateColumnRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TaskColumn).where(TaskColumn.id == col_id, TaskColumn.user_id == user_id)
    )
    col = result.scalar_one_or_none()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(col, field, value)
    await db.commit()
    await db.refresh(col)
    return col


@router.delete("/columns/{col_id}", status_code=204)
async def delete_column(
    col_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TaskColumn).where(TaskColumn.id == col_id, TaskColumn.user_id == user_id)
    )
    col = result.scalar_one_or_none()
    if not col:
        raise HTTPException(status_code=404, detail="Column not found")

    count_result = await db.execute(
        select(func.count(TaskColumn.id)).where(TaskColumn.user_id == user_id)
    )
    if (count_result.scalar() or 0) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last column")

    next_result = await db.execute(
        select(TaskColumn)
        .where(TaskColumn.user_id == user_id, TaskColumn.id != col_id)
        .order_by(TaskColumn.position)
        .limit(1)
    )
    next_col = next_result.scalar_one_or_none()

    if next_col:
        await db.execute(
            sa_update(Task)
            .where(Task.user_id == user_id, Task.status == col_id)
            .values(status=next_col.id)
        )

    await db.delete(col)
    await db.commit()


# ── Task routes ───────────────────────────────────────────────────────────────

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
        linked_artifacts=body.linked_artifacts,
        linked_knowledge=body.linked_knowledge,
        checklist=body.checklist,
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
