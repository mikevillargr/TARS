from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import User
from db.session import get_db

router = APIRouter()


class SettingsOut(BaseModel):
    name: str
    timezone: str

    class Config:
        from_attributes = True


class SettingsUpdate(BaseModel):
    name: Optional[str] = None
    timezone: Optional[str] = None


@router.get("", response_model=SettingsOut)
async def get_settings(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return SettingsOut(name=user.name, timezone=user.timezone or "Asia/Manila")


@router.patch("", response_model=SettingsOut)
async def update_settings(
    body: SettingsUpdate,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.timezone is not None:
        updates["timezone"] = body.timezone

    if updates:
        await db.execute(sa_update(User).where(User.id == user_id).values(**updates))
        await db.commit()

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    return SettingsOut(name=user.name, timezone=user.timezone or "Asia/Manila")
