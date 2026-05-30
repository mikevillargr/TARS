"""
REST routes for the contact graph.

Reads come from the local mirror (`contacts` table). Writes that go to Google
(approve a PendingContact) use GooglePeopleClient. After a successful Google
write the local row is created immediately — we don't wait for the next sync.
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, or_, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from db.models import Contact, PendingContact, Connector
from connectors.google_people import GooglePeopleClient, to_contact_dict

log = logging.getLogger(__name__)
router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────
class ContactOut(BaseModel):
    id: str
    google_resource_name: Optional[str]
    display_name: Optional[str]
    primary_email: Optional[str]
    primary_phone: Optional[str]
    organization: Optional[str]
    job_title: Optional[str]
    biography: Optional[str]
    tars_context: Optional[str]
    emails: list
    phones: list
    is_directory: bool
    is_other_contact: bool
    last_synced_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ContactPatch(BaseModel):
    display_name:  Optional[str] = None
    organization:  Optional[str] = None
    job_title:     Optional[str] = None
    tars_context:  Optional[str] = None


class PendingContactOut(BaseModel):
    id: str
    detected_name: Optional[str]
    detected_email: str
    detected_phone: Optional[str]
    source: str
    source_id: Optional[str]
    extracted_context: Optional[str]
    status: str
    created_at: datetime

    class Config:
        from_attributes = True


class SyncOut(BaseModel):
    changed: Optional[int] = None
    other_contacts: Optional[int] = None
    full_sync: Optional[bool] = None
    skipped: Optional[bool] = None
    reason: Optional[str] = None
    error: Optional[str] = None


# ── Helpers ──────────────────────────────────────────────────────────────────
async def _get_people_client(db: AsyncSession, user_id: str) -> GooglePeopleClient:
    """Build a People API client from the stored connector auth. 409 if not connected."""
    result = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id,
            Connector.name == "Google Contacts",
        )
    )
    conn = result.scalar_one_or_none()
    if not conn or not conn.auth or not conn.auth.get("refresh_token"):
        raise HTTPException(status_code=409, detail="Google Contacts not connected")
    return GooglePeopleClient(conn.auth)


# ── Routes: contact reads ────────────────────────────────────────────────────
@router.get("", response_model=List[ContactOut])
async def list_contacts(
    limit: int = 100,
    offset: int = 0,
    include_other: bool = True,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List local contacts. Other-contacts (emailed but not saved) included by default."""
    stmt = select(Contact).where(Contact.user_id == user_id)
    if not include_other:
        stmt = stmt.where(Contact.is_other_contact == False)  # noqa: E712
    stmt = stmt.order_by(Contact.display_name.asc().nulls_last()).limit(limit).offset(offset)
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/search", response_model=List[ContactOut])
async def search_contacts(
    q: str,
    limit: int = 20,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """ILIKE search across display_name, primary_email, organization."""
    if not q.strip():
        return []
    needle = f"%{q.strip()}%"
    stmt = (
        select(Contact)
        .where(
            Contact.user_id == user_id,
            or_(
                Contact.display_name.ilike(needle),
                Contact.primary_email.ilike(needle),
                Contact.organization.ilike(needle),
            ),
        )
        .limit(limit)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/pending", response_model=List[PendingContactOut])
async def list_pending(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List people detected from meetings/email/chat awaiting approval."""
    result = await db.execute(
        select(PendingContact)
        .where(PendingContact.user_id == user_id, PendingContact.status == "pending")
        .order_by(PendingContact.created_at.desc())
    )
    return result.scalars().all()


@router.get("/pending/count")
async def pending_count(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Badge count for the Connectors page."""
    result = await db.execute(
        select(func.count(PendingContact.id)).where(
            PendingContact.user_id == user_id,
            PendingContact.status == "pending",
        )
    )
    return {"count": result.scalar() or 0}


@router.get("/{contact_id}", response_model=ContactOut)
async def get_contact(
    contact_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.user_id == user_id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.patch("/{contact_id}", response_model=ContactOut)
async def patch_contact(
    contact_id: str,
    body: ContactPatch,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    Local-only edit. tars_context is local-only by design and survives until the next
    full re-sync (where Google's biographies field overwrites our `biography`).
    """
    result = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.user_id == user_id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    for k, v in body.dict(exclude_none=True).items():
        setattr(contact, k, v)
    contact.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return contact


# ── Routes: pending queue actions ────────────────────────────────────────────
@router.post("/pending/{pending_id}/approve", response_model=ContactOut)
async def approve_pending(
    pending_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Push to Google via createContact, then insert locally and mark approved."""
    p_result = await db.execute(
        select(PendingContact).where(
            PendingContact.id == pending_id,
            PendingContact.user_id == user_id,
        )
    )
    pending = p_result.scalar_one_or_none()
    if not pending:
        raise HTTPException(status_code=404, detail="Pending contact not found")
    if pending.status != "pending":
        raise HTTPException(status_code=409, detail=f"Already {pending.status}")

    client = await _get_people_client(db, user_id)

    # Build the biography from extracted context (becomes the seed of tars_context)
    biography = pending.extracted_context

    try:
        person = client.create_contact(
            name=pending.detected_name or pending.detected_email,
            email=pending.detected_email,
            phone=pending.detected_phone,
            biography=biography,
        )
    except Exception as exc:
        log.exception("createContact failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Google API error: {exc}")

    # Insert locally so it's immediately visible
    data = to_contact_dict(person)
    data["tars_context"] = biography
    data["last_synced_at"] = datetime.now(timezone.utc)

    # Check if already present (race with sync job)
    existing_result = await db.execute(
        select(Contact).where(Contact.google_resource_name == data["google_resource_name"])
    )
    existing = existing_result.scalar_one_or_none()
    if existing:
        for k, v in data.items():
            setattr(existing, k, v)
        contact = existing
    else:
        contact = Contact(user_id=user_id, **data)
        db.add(contact)

    pending.status     = "approved"
    pending.decided_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(contact)
    return contact


@router.post("/pending/{pending_id}/reject", status_code=204)
async def reject_pending(
    pending_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    p_result = await db.execute(
        select(PendingContact).where(
            PendingContact.id == pending_id,
            PendingContact.user_id == user_id,
        )
    )
    pending = p_result.scalar_one_or_none()
    if not pending:
        raise HTTPException(status_code=404, detail="Pending contact not found")
    pending.status     = "rejected"
    pending.decided_at = datetime.now(timezone.utc)
    await db.commit()


# ── Routes: manual sync trigger ──────────────────────────────────────────────
@router.post("/sync", response_model=SyncOut)
async def manual_sync(
    user_id: str = Depends(require_auth),
):
    """Run a sync pass immediately (without waiting for the 5-min cron tick)."""
    from jobs.people_sync import sync_people_for_user
    return await sync_people_for_user(user_id)
