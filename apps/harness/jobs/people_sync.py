"""
Google People sync job.

Pulls all contacts (or only changes since last sync) using sync tokens from
people.connections.list. People API has no push notifications, so we poll
every 5 minutes — incremental polls return only changed contacts in ~100ms.

Also pulls otherContacts.list (people you've emailed but never saved) on each
full sync so that pool is also indexed locally.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from googleapiclient.errors import HttpError

from db.session import AsyncSessionLocal
from db.models import Connector, Contact, ContactSyncState, User
from connectors.google_people import GooglePeopleClient, to_contact_dict

log = logging.getLogger(__name__)


async def _get_people_auth(db: AsyncSession, user_id: str) -> Optional[dict]:
    """Return the Google Contacts OAuth auth dict if connected, else None."""
    result = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id,
            Connector.name == "Google Contacts",
        )
    )
    conn = result.scalar_one_or_none()
    if not conn or not conn.auth or not conn.auth.get("refresh_token"):
        return None
    return conn.auth


async def _upsert_contact(
    db: AsyncSession,
    user_id: str,
    contact_data: dict,
    *,
    is_other_contact: bool = False,
) -> None:
    """
    Insert or update a Contact row.

    Saved contacts   → keyed on google_resource_name (authoritative)
    Other contacts   → keyed on primary_email to avoid one-row-per-email-thread
                       explosion. If a saved contact with the same email exists,
                       skip entirely — saved contact wins.
    """
    resource_name = contact_data.get("google_resource_name")
    if not resource_name:
        return

    contact_data["is_other_contact"] = is_other_contact
    contact_data["last_synced_at"]   = datetime.now(timezone.utc)

    if is_other_contact:
        email = (contact_data.get("primary_email") or "").lower().strip()
        if not email:
            return  # no email → nothing useful to store

        # Check if a saved contact with this email already exists — skip if so
        saved_result = await db.execute(
            select(Contact).where(
                Contact.user_id == user_id,
                Contact.primary_email == email,
                Contact.is_other_contact == False,  # noqa: E712
            )
        )
        if saved_result.scalar_one_or_none():
            return  # saved contact wins

        # Check if we already have an other-contact row for this email
        other_result = await db.execute(
            select(Contact).where(
                Contact.user_id == user_id,
                Contact.primary_email == email,
                Contact.is_other_contact == True,  # noqa: E712
            )
        )
        existing_other = other_result.scalar_one_or_none()
        if existing_other:
            # Update in-place (may carry a better display_name from a later record)
            for k, v in contact_data.items():
                setattr(existing_other, k, v)
            return  # done — no new row

        db.add(Contact(user_id=user_id, **contact_data))
        return

    # Saved contact — upsert by resource_name as before
    result = await db.execute(
        select(Contact).where(Contact.google_resource_name == resource_name)
    )
    existing = result.scalar_one_or_none()
    if existing:
        for k, v in contact_data.items():
            setattr(existing, k, v)
    else:
        db.add(Contact(user_id=user_id, **contact_data))


async def _sync_other_contacts(db: AsyncSession, user_id: str, client: GooglePeopleClient) -> int:
    """Pull and upsert otherContacts. Returns count."""
    try:
        people = client.list_other_contacts()
    except HttpError as e:
        log.warning("otherContacts.list failed: %s", e)
        return 0

    count = 0
    for p in people:
        data = to_contact_dict(p)
        # otherContacts use a different resource path; keep them disambiguated
        await _upsert_contact(db, user_id, data, is_other_contact=True)
        count += 1
    return count


async def _sync_one_user(db: AsyncSession, user_id: str) -> dict:
    """Run a sync pass for a single user. Returns small status dict."""
    auth = await _get_people_auth(db, user_id)
    if not auth:
        return {"skipped": True, "reason": "not connected"}

    # Load or create sync state
    state_result = await db.execute(
        select(ContactSyncState).where(ContactSyncState.user_id == user_id)
    )
    state = state_result.scalar_one_or_none()
    if not state:
        state = ContactSyncState(user_id=user_id)
        db.add(state)
        await db.flush()

    client = GooglePeopleClient(auth)
    full_sync = state.sync_token is None

    try:
        people, new_token = client.list_connections(state.sync_token)
    except HttpError as e:
        # 410 GONE → sync token expired, fall back to full sync once
        status = getattr(e, "status_code", None) or getattr(e.resp, "status", None)
        if status == 410:
            log.info("Sync token expired for user %s — full resync", user_id)
            state.sync_token = None
            full_sync = True
            people, new_token = client.list_connections(sync_token=None)
        else:
            state.last_error = f"HTTP {status}: {e}"
            await db.commit()
            return {"error": str(e)}

    for p in people:
        await _upsert_contact(db, user_id, to_contact_dict(p), is_other_contact=False)

    other_count = 0
    if full_sync:
        # Only sync otherContacts during full sync — it doesn't support sync tokens
        other_count = await _sync_other_contacts(db, user_id, client)

    state.sync_token   = new_token or state.sync_token
    state.last_sync_at = datetime.now(timezone.utc)
    state.last_error   = None
    await db.commit()

    log.info(
        "people_sync user=%s changed=%d other=%d full=%s",
        user_id, len(people), other_count, full_sync,
    )
    return {
        "changed": len(people),
        "other_contacts": other_count,
        "full_sync": full_sync,
    }


async def sync_people() -> None:
    """Entry point for the scheduler — sync contacts for every user with the connector."""
    async with AsyncSessionLocal() as db:
        user_result = await db.execute(select(User))
        users = user_result.scalars().all()
        for u in users:
            try:
                await _sync_one_user(db, u.id)
            except Exception as exc:
                log.exception("people_sync failed for user %s: %s", u.id, exc)


async def sync_people_for_user(user_id: str) -> dict:
    """Synchronous entry point for the manual-trigger REST route."""
    async with AsyncSessionLocal() as db:
        return await _sync_one_user(db, user_id)
