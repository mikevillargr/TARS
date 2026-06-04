from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from db.models import UserDomain, Memory, KnowledgeItem

router = APIRouter()

# System domains seeded for new users
_SYSTEM_DOMAINS = [
    {"name": "work",     "color": "#3B82F6", "position": 0},
    {"name": "personal", "color": "#8B5CF6", "position": 1},
    {"name": "health",   "color": "#10B981", "position": 2},
    {"name": "cycling",  "color": "#F59E0B", "position": 3},
    {"name": "client",   "color": "#EF4444", "position": 4},
    {"name": "general",  "color": "#6B7280", "position": 5},
]


class DomainOut(BaseModel):
    id: str
    name: str
    color: str
    is_system: bool
    position: int
    memory_count: int = 0
    knowledge_count: int = 0

    class Config:
        from_attributes = True


class CreateDomainRequest(BaseModel):
    name: str
    color: str = "#6B7280"


class UpdateDomainRequest(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    position: Optional[int] = None


async def _ensure_seeded(db: AsyncSession, user_id: str) -> None:
    """Seed default domains if none exist for this user yet."""
    result = await db.execute(
        select(func.count(UserDomain.id)).where(UserDomain.user_id == user_id)
    )
    if (result.scalar() or 0) == 0:
        from datetime import timezone
        from datetime import datetime as _dt
        from db.models import new_id
        now = _dt.now(timezone.utc)
        for d in _SYSTEM_DOMAINS:
            db.add(UserDomain(
                id=new_id(),
                user_id=user_id,
                name=d["name"],
                color=d["color"],
                is_system=True,
                position=d["position"],
                created_at=now,
            ))
        await db.commit()


@router.get("", response_model=List[DomainOut])
async def list_domains(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_seeded(db, user_id)

    domains = (await db.execute(
        select(UserDomain)
        .where(UserDomain.user_id == user_id)
        .order_by(UserDomain.position, UserDomain.created_at)
    )).scalars().all()

    # Count usage across both tables
    mem_counts = {
        row[0]: row[1]
        for row in (await db.execute(
            select(Memory.domain, func.count(Memory.id))
            .where(Memory.user_id == user_id)
            .group_by(Memory.domain)
        )).all()
    }
    kb_counts = {
        row[0]: row[1]
        for row in (await db.execute(
            select(KnowledgeItem.domain, func.count(KnowledgeItem.id))
            .where(KnowledgeItem.user_id == user_id)
            .group_by(KnowledgeItem.domain)
        )).all()
    }

    return [
        DomainOut(
            id=d.id,
            name=d.name,
            color=d.color,
            is_system=d.is_system,
            position=d.position,
            memory_count=mem_counts.get(d.name, 0),
            knowledge_count=kb_counts.get(d.name, 0),
        )
        for d in domains
    ]


@router.post("", response_model=DomainOut, status_code=201)
async def create_domain(
    body: CreateDomainRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _ensure_seeded(db, user_id)

    # Check for duplicate name (case-insensitive)
    existing = (await db.execute(
        select(UserDomain)
        .where(UserDomain.user_id == user_id)
        .where(func.lower(UserDomain.name) == body.name.strip().lower())
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="Domain with that name already exists")

    # Position: after the last custom domain
    max_pos_result = await db.execute(
        select(func.max(UserDomain.position)).where(UserDomain.user_id == user_id)
    )
    max_pos = max_pos_result.scalar() or 0

    from db.models import new_id
    from datetime import datetime, timezone
    domain = UserDomain(
        id=new_id(),
        user_id=user_id,
        name=body.name.strip(),
        color=body.color,
        is_system=False,
        position=max_pos + 1,
        created_at=datetime.now(timezone.utc),
    )
    db.add(domain)
    await db.commit()
    await db.refresh(domain)
    return DomainOut(id=domain.id, name=domain.name, color=domain.color,
                     is_system=domain.is_system, position=domain.position)


@router.patch("/{domain_id}", response_model=DomainOut)
async def update_domain(
    domain_id: str,
    body: UpdateDomainRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    domain = (await db.execute(
        select(UserDomain)
        .where(UserDomain.id == domain_id, UserDomain.user_id == user_id)
    )).scalar_one_or_none()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")

    if body.name is not None:
        old_name = domain.name
        new_name = body.name.strip()
        domain.name = new_name
        # Rename domain on all existing items
        if old_name != new_name:
            from sqlalchemy import update as _update
            await db.execute(
                _update(Memory)
                .where(Memory.user_id == user_id, Memory.domain == old_name)
                .values(domain=new_name)
            )
            await db.execute(
                _update(KnowledgeItem)
                .where(KnowledgeItem.user_id == user_id, KnowledgeItem.domain == old_name)
                .values(domain=new_name)
            )

    if body.color is not None:
        domain.color = body.color
    if body.position is not None:
        domain.position = body.position

    await db.commit()
    await db.refresh(domain)
    return DomainOut(id=domain.id, name=domain.name, color=domain.color,
                     is_system=domain.is_system, position=domain.position)


@router.delete("/{domain_id}", status_code=204)
async def delete_domain(
    domain_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    domain = (await db.execute(
        select(UserDomain)
        .where(UserDomain.id == domain_id, UserDomain.user_id == user_id)
    )).scalar_one_or_none()
    if not domain:
        raise HTTPException(status_code=404, detail="Domain not found")
    if domain.is_system:
        raise HTTPException(status_code=403, detail="Cannot delete system domains")

    # Reassign items to general
    from sqlalchemy import update as _update
    await db.execute(
        _update(Memory)
        .where(Memory.user_id == user_id, Memory.domain == domain.name)
        .values(domain="general")
    )
    await db.execute(
        _update(KnowledgeItem)
        .where(KnowledgeItem.user_id == user_id, KnowledgeItem.domain == domain.name)
        .values(domain="general")
    )

    await db.delete(domain)
    await db.commit()
