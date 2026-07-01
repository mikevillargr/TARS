"""
Shared helpers for auto-detecting new people and enqueuing them as
PendingContact rows. Called from meeting_processor, email_digest, and the
chat lookup_contact tool.

Dedupes against:
  - existing Contact rows (matched by primary_email == detected_email)
  - other PendingContact rows in pending status with the same detected_email
    (enforced by the partial unique index uq_pending_contacts_user_email_pending)
"""

import logging
import re
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from db.models import Contact, PendingContact

log = logging.getLogger(__name__)

# Validates a basic email. Liberal — we'd rather skip ambiguous strings than
# enqueue garbage.
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def _looks_like_email(s: str) -> bool:
    if not s or not isinstance(s, str):
        return False
    return bool(_EMAIL_RE.match(s.strip()))


def _split_name_email(raw: str) -> tuple[Optional[str], Optional[str]]:
    """Accept either 'foo@bar.com' or 'Foo Bar <foo@bar.com>'."""
    if not raw:
        return None, None
    raw = raw.strip()
    m = re.match(r"^\s*(.+?)\s*<\s*([^<>@]+@[^<>]+)\s*>\s*$", raw)
    if m:
        return m.group(1).strip().strip('"'), m.group(2).strip()
    if _looks_like_email(raw):
        return None, raw
    return None, None


async def enqueue_pending(
    db: AsyncSession,
    user_id: str,
    *,
    detected_name: Optional[str],
    detected_email: str,
    source: str,                # "meeting" | "email" | "chat"
    source_id: Optional[str] = None,
    extracted_context: Optional[str] = None,
) -> bool:
    """
    Insert one PendingContact row. Returns True if a row was created, False if
    the person already exists (as Contact) or is already pending.
    """
    if not _looks_like_email(detected_email):
        return False
    email = detected_email.strip().lower()

    # Skip if already a known contact. Use .first() (not scalar_one_or_none):
    # multiple distinct Google contacts can legitimately share an email address
    # (e.g. several cards under the same work address), and scalar_one_or_none
    # would raise MultipleResultsFound and abort the whole enqueue.
    existing = await db.execute(
        select(Contact.id).where(
            Contact.user_id == user_id,
            Contact.primary_email == email,
        )
    )
    if existing.scalars().first():
        return False

    # Skip if already pending (the partial unique index would also enforce this,
    # but checking first avoids a wasted INSERT + rollback)
    pend_existing = await db.execute(
        select(PendingContact.id).where(
            PendingContact.user_id == user_id,
            PendingContact.detected_email == email,
            PendingContact.status == "pending",
        )
    )
    if pend_existing.scalars().first():
        return False

    db.add(PendingContact(
        user_id=user_id,
        detected_name=detected_name,
        detected_email=email,
        source=source,
        source_id=source_id,
        extracted_context=extracted_context,
    ))
    try:
        await db.flush()
        return True
    except IntegrityError:
        # Race: another caller inserted between our check and our flush
        await db.rollback()
        return False


async def enqueue_from_strings(
    db: AsyncSession,
    user_id: str,
    raw_people: list[str],
    *,
    source: str,
    source_id: Optional[str] = None,
    extracted_context: Optional[str] = None,
) -> int:
    """
    Accept a list of raw strings (emails OR "Name <email>") and enqueue each as
    a PendingContact. Returns the count of new pending rows created.
    """
    created = 0
    for raw in raw_people or []:
        name, email = _split_name_email(raw)
        if not email:
            continue
        try:
            if await enqueue_pending(
                db, user_id,
                detected_name=name,
                detected_email=email,
                source=source,
                source_id=source_id,
                extracted_context=extracted_context,
            ):
                created += 1
        except Exception as exc:
            log.warning("Failed to enqueue pending contact %s: %s", raw, exc)
    return created
