"""
Gmail attachment sync — hourly sweep for incoming attachments worth keeping.

The Gmail connector historically walked text body parts only; every attachment
was silently dropped. This job searches both Gmail account slots for recent
messages with attachments, keeps only reference-worthy files (boarding passes,
tickets, receipts, invoices, real documents), and stores them as Artifacts
(source="email") so they show up in the library and stay searchable.

Keeping vs. dropping is judgement, so it goes to Tier 1 with a strict JSON
contract — but only after a cheap deterministic pre-filter (tiny images,
logo/signature filenames) that needs no model call. Any model or parse failure
defaults to keep=false: a missed attachment is recoverable, a library full of
marketing banners is not.

Dedupe lives on the connector row (config["processed_attachment_ids"], capped
at the last 2000) rather than in a new table — an attachment is processed
exactly once even across restarts, and a dismissed Signal never re-raises
because the underlying attachment never gets re-evaluated.

First run seeds the dedupe set with everything currently matching the search
WITHOUT downloading: deploying this job must not import a two-day backlog of
attachments all at once.
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.model_client import ModelTier, complete_text
from db.models import Artifact, Connector, Signal, User
from db.session import AsyncSessionLocal

log = logging.getLogger(__name__)

# Both account slots, same as core/context_assembler._fetch_gmail_context.
GMAIL_CONNECTOR_NAMES = ("Gmail", "Gmail (Personal)")

SEARCH_QUERY = "has:attachment newer_than:2d"
MAX_THREADS_PER_RUN = 20
MAX_PROCESSED_IDS = 2000

# Cheap pre-filter — no model call. Small images are almost always signatures,
# logos, or tracking pixels; same for these filename giveaways.
MIN_IMAGE_BYTES = 50 * 1024
JUNK_FILENAME_RE = re.compile(r"logo|signature|banner|icon|spacer|pixel", re.I)

CATEGORIES = ("boarding_pass", "ticket", "receipt", "invoice", "document", "junk")
SIGNAL_CATEGORIES = ("boarding_pass", "ticket")

_CLASSIFY_SYSTEM = """You decide whether an email attachment is worth saving to a personal knowledge base.
Keep boarding passes, event tickets, receipts, invoices, and real documents (contracts, statements, reports, forms).
Reject marketing images, logos, signature blocks, newsletters, and decorative content.
Reply with strict JSON only: {"keep": true|false, "category": "boarding_pass"|"ticket"|"receipt"|"invoice"|"document"|"junk"}"""


@dataclass
class _ConnInfo:
    """Detached snapshot of a Connector row, safe to use after its session closes."""
    id: str
    auth: dict
    config: dict


def _extract_json_object(text: str) -> dict:
    """Same contract as signal_generator's: models wrap JSON in prose/fences."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1 or end < start:
        return {}
    try:
        parsed = json.loads(text[start : end + 1])
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        return {}


def _prefilter_skip(att: dict) -> bool:
    """Deterministic junk check — True means skip without a model call."""
    filename = att.get("filename", "")
    if JUNK_FILENAME_RE.search(filename):
        return True
    if (att.get("mime_type") or "").startswith("image/") and (att.get("size") or 0) < MIN_IMAGE_BYTES:
        return True
    return False


async def _classify(att: dict, subject: str, sender: str) -> tuple[bool, str]:
    """Tier-1 keep/drop judgement. Any failure → keep=False (safe) + log."""
    prompt = (
        f"From: {sender}\nSubject: {subject}\n"
        f"Attachment: {att['filename']} ({att['mime_type']}, {att.get('size') or 0} bytes)"
    )
    try:
        raw = await complete_text(_CLASSIFY_SYSTEM, prompt, tier=ModelTier.TIER1, max_tokens=100)
    except Exception as exc:
        log.warning("gmail_attachment_sync: classification failed for %s: %s", att["filename"], exc)
        return False, "junk"
    parsed = _extract_json_object(raw)
    keep = bool(parsed.get("keep"))
    category = parsed.get("category") if parsed.get("category") in CATEGORIES else "junk"
    if not parsed or (keep and category == "junk"):
        # Unparseable, or the contradiction "keep this junk" — safe default.
        log.warning("gmail_attachment_sync: bad verdict for %s: %s", att["filename"], raw[:200])
        return False, "junk"
    return keep, category


def _message_headers(message: dict) -> tuple[str, str]:
    headers = {h["name"]: h["value"] for h in message.get("payload", {}).get("headers", [])}
    return headers.get("Subject", "(no subject)"), headers.get("From", "")


async def _save_attachment(
    db: AsyncSession,
    user_id: str,
    client,
    message_id: str,
    att: dict,
    category: str,
    subject: str,
) -> Optional[Artifact]:
    """Download → blob store → Artifact row → notify → maybe Signal."""
    from core.artifact_store import store_upload_as_artifact
    from core.notifications import publish

    data = await asyncio.get_event_loop().run_in_executor(
        None, lambda: client.get_attachment(message_id, att["attachment_id"])
    )
    if not data:
        return None

    artifact = await store_upload_as_artifact(
        user_id, data, att["filename"], source="email", db=db, mime_type=att.get("mime_type", ""),
    )
    artifact.tags = [category]
    artifact.source_id = message_id
    await db.commit()

    await publish(user_id, {
        "type": "attachment_saved",
        "artifact_id": artifact.id,
        "filename": artifact.filename,
        "category": category,
    })

    if category in SIGNAL_CATEGORIES:
        dedupe_key = f"email-attachment:{message_id}:{att['attachment_id']}"
        exists = (await db.execute(
            select(Signal.id).where(
                Signal.user_id == user_id, Signal.dedupe_key == dedupe_key,
            )
        )).scalar_one_or_none()
        if not exists:
            label = "Boarding pass" if category == "boarding_pass" else "Ticket"
            db.add(Signal(
                user_id=user_id,
                kind="fyi",
                source="gmail",
                source_label="Gmail",
                source_ref=artifact.id,
                title=f"{label}: {artifact.filename}",
                urgency="time",
                reasoning=f"Arrived in \"{subject}\" and was saved to Artifacts.",
                citation=f"Gmail · {subject[:60]}",
                actions=[],
                status="open",
                dedupe_key=dedupe_key,
            ))
            await db.commit()

    return artifact


async def _process_attachment(
    db: AsyncSession,
    user_id: str,
    client,
    message_id: str,
    att: dict,
    subject: str,
    sender: str,
    stats: dict,
) -> None:
    """Decide on one attachment and act. Exceptions propagate to the caller's
    per-attachment guard — one bad attachment must not abort the batch."""
    if _prefilter_skip(att):
        keep, category = False, "junk"
    else:
        keep, category = await _classify(att, subject, sender)

    if not keep:
        stats["skipped"] += 1
        return

    artifact = await _save_attachment(db, user_id, client, message_id, att, category, subject)
    if artifact:
        stats["saved"] += 1
    else:
        stats["errors"] += 1


async def _sync_connector(user_id: str, conn: _ConnInfo, stats: dict) -> None:
    """One Gmail account slot."""
    from connectors.gmail import GmailClient

    client = GmailClient(conn.auth)
    loop = asyncio.get_event_loop()

    processed: list[str] = list(conn.config.get("processed_attachment_ids", []))
    processed_set = set(processed)
    first_run = "processed_attachment_ids" not in conn.config

    threads = await loop.run_in_executor(
        None, lambda: client.list_threads(query=SEARCH_QUERY, max_results=MAX_THREADS_PER_RUN)
    )

    async with AsyncSessionLocal() as db:
        for t in threads:
            try:
                thread = await loop.run_in_executor(
                    None, lambda tid=t["id"]: client.get_thread(tid)
                )
            except Exception as exc:
                log.warning("gmail_attachment_sync: thread fetch failed %s: %s", t.get("id"), exc)
                stats["errors"] += 1
                continue

            for message in thread.get("messages", []) or []:
                message_id = message.get("id")
                if not message_id:
                    continue
                subject, sender = _message_headers(message)
                for att in client.list_attachments(message):
                    dedupe_id = f"{message_id}:{att['attachment_id']}"
                    if dedupe_id in processed_set:
                        continue
                    stats["scanned"] += 1

                    if first_run:
                        # Seed only — never download the backlog.
                        processed.append(dedupe_id)
                        processed_set.add(dedupe_id)
                        stats["seeded"] += 1
                        continue

                    try:
                        await _process_attachment(
                            db, user_id, client, message_id, att, subject, sender, stats,
                        )
                        # Decision made (kept, junked, or classify-failed-safe) —
                        # don't re-spend a model call on it next hour.
                        processed.append(dedupe_id)
                        processed_set.add(dedupe_id)
                    except Exception as exc:
                        log.warning(
                            "gmail_attachment_sync: failed on %s (%s): %s",
                            att.get("filename"), dedupe_id, exc,
                        )
                        stats["errors"] += 1
                        # Not marked processed — retried next run, bounded by
                        # the 2d search window.

    # Write the dedupe list back (capped) and stamp the sync time — separate
    # session so Gmail API latency never holds a transaction open on config.
    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            select(Connector).where(Connector.id == conn.id)
        )).scalar_one_or_none()
        if row:
            config = dict(row.config or {})
            config["processed_attachment_ids"] = processed[-MAX_PROCESSED_IDS:]
            row.config = config
            row.last_synced_at = datetime.now(timezone.utc)
            await db.commit()


async def run_sync() -> dict:
    """Hourly entry point registered with the scheduler."""
    stats = {"scanned": 0, "seeded": 0, "saved": 0, "skipped": 0, "errors": 0}

    async with AsyncSessionLocal() as db:
        # Resolve the canonical user deterministically (prefer the configured
        # TARS_USERNAME) — same pattern as scheduler._sync_fireflies.
        user = (await db.execute(
            select(User).where(User.id == settings.tars_username)
        )).scalar_one_or_none()
        if not user:
            user = (await db.execute(select(User).limit(1))).scalar_one_or_none()
        if not user:
            return stats
        user_id = user.id

        conns = (await db.execute(
            select(Connector).where(
                Connector.user_id == user_id,
                Connector.name.in_(GMAIL_CONNECTOR_NAMES),
                Connector.status == "connected",
            )
        )).scalars().all()
        conn_infos = [
            _ConnInfo(id=c.id, auth=dict(c.auth or {}), config=dict(c.config or {}))
            for c in conns
            if (c.auth or {}).get("refresh_token")
        ]

    for conn in conn_infos:
        try:
            await _sync_connector(user_id, conn, stats)
        except Exception as exc:
            log.exception("gmail_attachment_sync: connector %s failed: %s", conn.id, exc)
            stats["errors"] += 1

    log.info("gmail_attachment_sync: %s", stats)
    return stats
