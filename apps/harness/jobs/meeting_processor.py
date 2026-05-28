"""
Meeting processing pipeline.
Fetches from Fireflies, runs AI extraction, saves summary + action items to DB.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from db.models import Meeting, MeetingActionItem, Task, User

log = logging.getLogger(__name__)


async def process_meeting(
    db: AsyncSession,
    meeting_id: str,
    user_id: str,
) -> bool:
    """
    Fetch transcript from Fireflies, run AI processing, update meeting record.
    Returns True if successful.
    """
    if not settings.fireflies_api_key:
        log.warning("Fireflies API key not configured")
        return False

    from connectors.fireflies import FirefliesClient, build_plain_transcript

    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        log.error("Meeting %s not found", meeting_id)
        return False

    try:
        client = FirefliesClient(settings.fireflies_api_key)
        transcript_data = await client.fetch_transcript(meeting.connector_ref)
        if not transcript_data:
            log.error("Could not fetch Fireflies transcript %s", meeting.connector_ref)
            meeting.status = "error"
            await db.commit()
            return False

        plain_text = build_plain_transcript(transcript_data.get("sentences") or [])
        meeting.transcript = plain_text

        ff_summary = transcript_data.get("summary") or {}
        ff_overview = ff_summary.get("overview") or ""
        ff_action_items = ff_summary.get("action_items") or ""

        # Update attendees from Fireflies
        participants = transcript_data.get("participants") or []
        if participants:
            meeting.attendees = participants

        # AI-enhanced summary + structured action items
        ai_summary, action_items = await _ai_process(
            title=meeting.title,
            transcript=plain_text,
            ff_overview=ff_overview,
            ff_action_items=ff_action_items,
        )

        meeting.summary = ai_summary
        meeting.status = "action_required" if action_items else "ready"
        await db.flush()

        # Save action items
        for item in action_items:
            db.add(MeetingActionItem(
                meeting_id=meeting.id,
                owner=item.get("owner"),
                raw_text=item.get("text", ""),
            ))

        await db.commit()
        log.info("Meeting %s processed: %d action items", meeting_id, len(action_items))
        return True

    except Exception as exc:
        log.exception("Error processing meeting %s: %s", meeting_id, exc)
        meeting.status = "error"
        await db.commit()
        return False


async def _ai_process(
    title: str,
    transcript: str,
    ff_overview: str,
    ff_action_items: str,
) -> tuple[str, list]:
    """Call Claude to generate enhanced summary and structured action items."""
    import anthropic

    if not settings.anthropic_api_key:
        summary = ff_overview or "Summary unavailable."
        return summary, _parse_ff_action_items(ff_action_items)

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)

    context_parts = [f"Meeting title: {title}"]
    if ff_overview:
        context_parts.append(f"\nFireflies overview:\n{ff_overview}")
    if ff_action_items:
        context_parts.append(f"\nFireflies action items:\n{ff_action_items}")
    if transcript:
        context_parts.append(f"\nFull transcript:\n{transcript[:8000]}")

    prompt = "\n".join(context_parts)

    system = """You are processing a meeting transcript for TARS, Mike Villar's personal AI assistant.

Extract two things and return valid JSON only, no commentary:

{
  "summary": "3-5 sentence summary of the meeting — what was discussed, decisions made, and key outcomes",
  "action_items": [
    {"text": "clear description of the action item", "owner": "person responsible or null"}
  ]
}

Be specific and concrete. If no action items, return an empty array."""

    resp = await client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=system,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = resp.content[0].text.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        parsed = json.loads(raw)
        summary = parsed.get("summary", ff_overview or "")
        action_items = parsed.get("action_items", [])
        return summary, action_items
    except Exception:
        log.warning("Failed to parse AI meeting response as JSON")
        return ff_overview or raw[:500], _parse_ff_action_items(ff_action_items)


def _parse_ff_action_items(raw: str) -> list:
    """Convert Fireflies plain text action items string into list dicts."""
    if not raw:
        return []
    items = []
    for line in raw.strip().splitlines():
        line = line.strip().lstrip("-•*").strip()
        if line:
            items.append({"text": line, "owner": None})
    return items


async def ingest_from_webhook(
    db: AsyncSession,
    user_id: str,
    transcript_id: str,
) -> Optional[str]:
    """
    Create a Meeting record from a Fireflies webhook event and kick off processing.
    Returns the new meeting's DB id, or None on failure.
    """
    if not settings.fireflies_api_key:
        return None

    # Avoid duplicate ingestion
    existing = await db.execute(
        select(Meeting).where(
            Meeting.connector_ref == transcript_id,
            Meeting.user_id == user_id,
        )
    )
    if existing.scalar_one_or_none():
        log.info("Meeting with connector_ref %s already exists, skipping", transcript_id)
        return None

    from connectors.fireflies import FirefliesClient
    client = FirefliesClient(settings.fireflies_api_key)

    # Fetch minimal metadata for the record title
    transcript_data = await client.fetch_transcript(transcript_id)
    if not transcript_data:
        log.error("Could not fetch Fireflies transcript %s for initial ingest", transcript_id)
        return None

    title = transcript_data.get("title") or "Untitled Meeting"
    participants = transcript_data.get("participants") or []
    date_ms = transcript_data.get("date")
    started_at = (
        datetime.fromtimestamp(date_ms / 1000, tz=timezone.utc) if date_ms else None
    )

    meeting = Meeting(
        user_id=user_id,
        title=title,
        attendees=participants,
        connector_ref=transcript_id,
        status="processing",
        started_at=started_at,
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)

    return meeting.id
