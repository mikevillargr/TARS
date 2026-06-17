"""
Universal cross-module linking API.

Supports polymorphic links between: task | meeting | knowledge_item | artifact | contact
"""

import logging
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, or_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from db.models import Link, KnowledgeItem, Contact, Task, Meeting, Artifact

log = logging.getLogger(__name__)
router = APIRouter()

VALID_TYPES = {"task", "meeting", "knowledge_item", "artifact", "contact"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class LinkOut(BaseModel):
    id: str
    user_id: str
    source_type: str
    source_id: str
    target_type: str
    target_id: str
    relationship: str
    context: Optional[str]
    created_at: datetime
    target_title: Optional[str] = None
    target_url: Optional[str] = None

    class Config:
        from_attributes = True


class CreateLinkRequest(BaseModel):
    source_type: str
    source_id: str
    target_type: str
    target_id: str
    relationship: str = "mentions"
    context: Optional[str] = None


class BulkCreateLinksRequest(BaseModel):
    links: List[CreateLinkRequest]


class MentionSearchResult(BaseModel):
    id: str
    type: str  # "knowledge_item" | "contact" | "task"
    title: str
    subtitle: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _resolve_title(db: AsyncSession, entity_type: str, entity_id: str) -> tuple[Optional[str], Optional[str]]:
    """Return (title, url) for a given entity. Returns (None, None) if not found."""
    if entity_type == "knowledge_item":
        row = (await db.execute(select(KnowledgeItem.source_title, KnowledgeItem.url).where(KnowledgeItem.id == entity_id))).first()
        if row:
            return row.source_title, row.url
    elif entity_type == "contact":
        row = (await db.execute(select(Contact.display_name).where(Contact.id == entity_id))).first()
        if row:
            return row.display_name, None
    elif entity_type == "task":
        row = (await db.execute(select(Task.title).where(Task.id == entity_id))).first()
        if row:
            return row.title, None
    elif entity_type == "meeting":
        row = (await db.execute(select(Meeting.title).where(Meeting.id == entity_id))).first()
        if row:
            return row.title, None
    elif entity_type == "artifact":
        row = (await db.execute(select(Artifact.filename).where(Artifact.id == entity_id))).first()
        if row:
            return row.filename, None
    return None, None


async def _enrich(db: AsyncSession, link: Link) -> LinkOut:
    title, url = await _resolve_title(db, link.target_type, link.target_id)
    out = LinkOut.model_validate(link)
    out.target_title = title
    out.target_url = url
    return out


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[LinkOut])
async def list_links(
    source_type: Optional[str] = Query(None),
    source_id: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if not ((source_type and source_id) or (target_type and target_id)):
        raise HTTPException(400, "Supply either source_type+source_id or target_type+target_id")

    q = select(Link).where(Link.user_id == user_id)
    if source_type and source_id:
        q = q.where(Link.source_type == source_type, Link.source_id == source_id)
    if target_type and target_id:
        q = q.where(Link.target_type == target_type, Link.target_id == target_id)
    q = q.order_by(Link.created_at.desc())

    rows = (await db.execute(q)).scalars().all()
    return [await _enrich(db, r) for r in rows]


@router.post("", response_model=LinkOut, status_code=201)
async def create_link(
    body: CreateLinkRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    if body.source_type not in VALID_TYPES or body.target_type not in VALID_TYPES:
        raise HTTPException(400, "Invalid entity type")

    # Upsert — if unique constraint fires, return existing
    existing = (await db.execute(
        select(Link).where(
            Link.user_id == user_id,
            Link.source_type == body.source_type,
            Link.source_id == body.source_id,
            Link.target_type == body.target_type,
            Link.target_id == body.target_id,
            Link.relationship == body.relationship,
        )
    )).scalar_one_or_none()

    if existing:
        return await _enrich(db, existing)

    link = Link(
        user_id=user_id,
        source_type=body.source_type,
        source_id=body.source_id,
        target_type=body.target_type,
        target_id=body.target_id,
        relationship=body.relationship,
        context=body.context,
    )
    db.add(link)
    await db.commit()
    await db.refresh(link)
    return await _enrich(db, link)


@router.post("/bulk", status_code=204)
async def bulk_create_links(
    body: BulkCreateLinksRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    for req in body.links:
        if req.source_type not in VALID_TYPES or req.target_type not in VALID_TYPES:
            continue
        existing = (await db.execute(
            select(Link).where(
                Link.user_id == user_id,
                Link.source_type == req.source_type,
                Link.source_id == req.source_id,
                Link.target_type == req.target_type,
                Link.target_id == req.target_id,
                Link.relationship == req.relationship,
            )
        )).scalar_one_or_none()
        if existing:
            continue
        link = Link(
            user_id=user_id,
            source_type=req.source_type,
            source_id=req.source_id,
            target_type=req.target_type,
            target_id=req.target_id,
            relationship=req.relationship,
            context=req.context,
        )
        db.add(link)
    await db.commit()


@router.delete("/{link_id}", status_code=204)
async def delete_link(
    link_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    link = (await db.execute(
        select(Link).where(Link.id == link_id, Link.user_id == user_id)
    )).scalar_one_or_none()
    if not link:
        raise HTTPException(404, "Link not found")
    await db.delete(link)
    await db.commit()


@router.get("/search", response_model=List[MentionSearchResult])
async def search_mentions(
    q: str = Query(..., min_length=1),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Autocomplete for [[mention]] picker. Returns contacts, knowledge items, tasks."""
    pattern = f"%{q}%"
    results: List[MentionSearchResult] = []

    # Contacts
    contacts = (await db.execute(
        select(Contact)
        .where(Contact.user_id == user_id)
        .where(
            or_(
                Contact.display_name.ilike(pattern),
                Contact.primary_email.ilike(pattern),
                Contact.organization.ilike(pattern),
            )
        )
        .limit(5)
    )).scalars().all()
    for c in contacts:
        results.append(MentionSearchResult(
            id=c.id,
            type="contact",
            title=c.display_name or c.primary_email or "Contact",
            subtitle=c.job_title or c.organization,
        ))

    # Knowledge items
    items = (await db.execute(
        select(KnowledgeItem)
        .where(KnowledgeItem.user_id == user_id)
        .where(KnowledgeItem.source_title.ilike(pattern))
        .limit(5)
    )).scalars().all()
    for item in items:
        results.append(MentionSearchResult(
            id=item.id,
            type="knowledge_item",
            title=item.source_title or "Note",
            subtitle=item.type,
        ))

    # Tasks
    tasks = (await db.execute(
        select(Task)
        .where(Task.user_id == user_id)
        .where(Task.title.ilike(pattern))
        .limit(5)
    )).scalars().all()
    for t in tasks:
        results.append(MentionSearchResult(
            id=t.id,
            type="task",
            title=t.title,
            subtitle=t.status,
        ))

    return results[:15]
