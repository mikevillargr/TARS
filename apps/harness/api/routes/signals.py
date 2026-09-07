"""
Signals API — the /today screen.

A Signal is an inferred claim that something needs a decision. This module owns
its lifecycle (open → snoozed / done / dismissed, all reversible) and the
dispatch of its actions.

Dispatch splits deliberately in two:

  · Executed here — actions whose outcome is unambiguous and fully specified by
    the signal's payload (create a task, create a reminder, book the event it
    already describes). Nothing to negotiate, so nothing to gate.

  · Handed to chat — anything requiring composition or judgement (drafting a
    reply, rescheduling around other commitments, digging through a transcript).
    These open a pre-seeded conversation instead, which puts them behind the
    approval gates that already exist there — email in particular must keep its
    draft-card confirm step (v2.12.1/v2.12.2), and re-implementing that here
    would be a second, weaker gate.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import Signal, Task, Reminder, Conversation, Message, Connector
from db.session import get_db

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class SignalOut(BaseModel):
    id: str
    kind: str
    source: str
    source_label: str
    source_ref: Optional[str]
    citation: Optional[str]
    title: str
    urgency: str
    reasoning: Optional[str]
    actions: list
    calendar_event: Optional[dict]
    status: str
    snoozed_until: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


class ActRequest(BaseModel):
    kind: str


class SnoozeRequest(BaseModel):
    until: Optional[datetime] = None


class ActResult(BaseModel):
    ok: bool
    # Set when the action produced something to navigate to.
    conversation_id: Optional[str] = None
    reminder_id: Optional[str] = None
    task_id: Optional[str] = None
    event_id: Optional[str] = None
    message: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_owned(signal_id: str, user_id: str, db: AsyncSession) -> Signal:
    result = await db.execute(
        select(Signal).where(Signal.id == signal_id, Signal.user_id == user_id)
    )
    sig = result.scalar_one_or_none()
    if not sig:
        raise HTTPException(status_code=404, detail="Signal not found")
    return sig


def _action_by_kind(sig: Signal, kind: str) -> dict:
    for a in (sig.actions or []):
        if a.get("kind") == kind:
            return a
    raise HTTPException(
        status_code=400, detail=f"Signal has no action of kind '{kind}'"
    )


def _tonight(now: Optional[datetime] = None) -> datetime:
    """Default snooze target: 20:00 today, or 20:00 tomorrow if already past."""
    now = now or datetime.now(timezone.utc)
    target = now.replace(hour=20, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target


async def _seed_conversation(
    sig: Signal, action: dict, db: AsyncSession, user_id: str
) -> str:
    """
    Hand the signal to chat with everything the model needs to act on it.

    Mirrors the feed → chat pattern: create the conversation with a seeded user
    message, return the id, let the frontend navigate.
    """
    lines = [
        f"{action.get('label', 'Handle this')}:",
        "",
        f"**{sig.title}**",
        f"Source: {sig.source_label}" + (f" · {sig.citation}" if sig.citation else ""),
    ]
    if sig.reasoning:
        lines += ["", f"Why this surfaced: {sig.reasoning}"]
    if sig.source_ref:
        lines += ["", f"Source reference: `{sig.source_ref}`"]
    payload = action.get("payload") or {}
    if payload:
        lines += ["", f"Context: {payload}"]

    conv = Conversation(user_id=user_id, title=sig.title[:80])
    db.add(conv)
    await db.flush()

    db.add(Message(conversation_id=conv.id, role="user", content="\n".join(lines)))
    return conv.id


async def _create_event(sig: Signal, db: AsyncSession, user_id: str) -> str:
    """Book the event the signal already fully describes."""
    ev = sig.calendar_event or {}
    if not ev.get("start"):
        raise HTTPException(status_code=400, detail="Signal has no event to create")

    r = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id, Connector.name == "Google Calendar"
        )
    )
    conn = r.scalar_one_or_none()
    if not conn or not conn.auth.get("refresh_token"):
        raise HTTPException(status_code=400, detail="Google Calendar not connected")

    from connectors.google_calendar import GoogleCalendarClient

    client = GoogleCalendarClient(conn.auth)
    start_dt = datetime.fromisoformat(str(ev["start"]).replace("Z", "+00:00"))
    end_dt = (
        datetime.fromisoformat(str(ev["end"]).replace("Z", "+00:00"))
        if ev.get("end")
        else start_dt + timedelta(minutes=int(ev.get("duration_min", 60)))
    )

    body = {
        "summary": ev.get("title") or sig.title,
        "start": {"dateTime": start_dt.isoformat()},
        "end": {"dateTime": end_dt.isoformat()},
    }
    if ev.get("notes"):
        body["description"] = ev["notes"]
    if ev.get("location"):
        body["location"] = ev["location"]

    loop = asyncio.get_event_loop()
    try:
        created = await loop.run_in_executor(
            None, lambda: client.create_event(calendar_id="primary", **body)
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Calendar API error: {exc}")
    return created["id"]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("", response_model=List[SignalOut])
async def list_signals(
    status: str = "open",
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    """
    List signals. Snoozed items whose time has come are woken here rather than
    by a background job — the read path is the only place their reappearance
    actually matters, and this keeps them from depending on a worker being up.
    """
    now = datetime.now(timezone.utc)
    due = await db.execute(
        select(Signal).where(
            Signal.user_id == user_id,
            Signal.status == "snoozed",
            Signal.snoozed_until.is_not(None),
            Signal.snoozed_until <= now,
        )
    )
    woke = False
    for sig in due.scalars().all():
        sig.status = "open"
        sig.snoozed_until = None
        woke = True
    if woke:
        await db.commit()

    q = select(Signal).where(Signal.user_id == user_id)
    if status != "all":
        q = q.where(Signal.status == status)
    # Most urgent first, then oldest — the thing that has been waiting longest
    # inside a severity band should be the one you see first.
    urgency_rank = {"overdue": 0, "time": 1, "normal": 2}
    rows = (await db.execute(q)).scalars().all()
    rows.sort(key=lambda s: (urgency_rank.get(s.urgency, 3), s.created_at))
    return rows


@router.post("/{signal_id}/act", response_model=ActResult)
async def act_on_signal(
    signal_id: str,
    body: ActRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    sig = await _get_owned(signal_id, user_id, db)
    action = _action_by_kind(sig, body.kind)
    payload = action.get("payload") or {}

    result = ActResult(ok=True, message=action.get("label", "Done"))

    if body.kind == "create_reminder":
        # The default landing place for signal-derived work. A signal is a
        # "don't forget this" prompt, which is what To-Dos are for; Projects
        # is for tracked work with a pipeline, and most signals never warrant
        # a kanban card.
        due = payload.get("due_at")
        rem = Reminder(
            user_id=user_id,
            text=payload.get("text") or sig.title,
            due_at=(
                datetime.fromisoformat(str(due).replace("Z", "+00:00"))
                if due
                # Time-pressured signals arrive with today already implied;
                # dropping that would lose the only urgency the item had.
                else datetime.now(timezone.utc)
                if sig.urgency in ("overdue", "time")
                else None
            ),
        )
        db.add(rem)
        await db.flush()
        result.reminder_id = rem.id
        sig.result_ref = rem.id

    elif body.kind == "create_task":
        # Escalation path, offered as an alternate: this one really is tracked
        # project work and wants a card with a status pipeline.
        task = Task(
            user_id=user_id,
            title=payload.get("title") or sig.title,
            description=payload.get("description") or sig.reasoning,
            status="todo",
            priority=payload.get("priority")
            or ("high" if sig.urgency in ("overdue", "time") else "normal"),
            source="signal",
            source_id=sig.id,
        )
        db.add(task)
        await db.flush()
        result.task_id = task.id
        sig.result_ref = task.id

    elif body.kind == "create_event":
        event_id = await _create_event(sig, db, user_id)
        result.event_id = event_id
        sig.result_ref = event_id

    else:
        # draft_reply, move_event, open_meeting, save_brain, discuss, …
        conv_id = await _seed_conversation(sig, action, db, user_id)
        result.conversation_id = conv_id
        sig.result_ref = conv_id

    sig.status = "done"
    sig.acted_kind = body.kind
    sig.acted_at = datetime.now(timezone.utc)
    await db.commit()
    return result


@router.post("/{signal_id}/snooze", response_model=SignalOut)
async def snooze_signal(
    signal_id: str,
    body: SnoozeRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    sig = await _get_owned(signal_id, user_id, db)
    sig.status = "snoozed"
    sig.snoozed_until = body.until or _tonight()
    await db.commit()
    await db.refresh(sig)
    return sig


@router.post("/{signal_id}/dismiss", response_model=SignalOut)
async def dismiss_signal(
    signal_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    sig = await _get_owned(signal_id, user_id, db)
    sig.status = "dismissed"
    await db.commit()
    await db.refresh(sig)
    return sig


@router.post("/{signal_id}/restore", response_model=SignalOut)
async def restore_signal(
    signal_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    """
    Undo. Deliberately does not roll back a side effect the action already
    produced — if acting created a task, that task stays and the user removes it
    themselves. Silently deleting something they may have since edited would be
    worse than leaving it.
    """
    sig = await _get_owned(signal_id, user_id, db)
    sig.status = "open"
    sig.snoozed_until = None
    sig.acted_kind = None
    sig.acted_at = None
    await db.commit()
    await db.refresh(sig)
    return sig


def _ics_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


@router.get("/{signal_id}/event.ics")
async def signal_ics(
    signal_id: str,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    """
    Serve the event as a real .ics from a real URL.

    Deliberately not generated client-side as a blob: blob URLs and
    location-navigation downloads both break inside the installed PWA shell,
    which is the v2.15.1 → v2.15.5 Second Brain export saga. A plain URL with
    text/calendar lets iOS open its native "Add to Calendar" sheet.
    """
    sig = await _get_owned(signal_id, user_id, db)
    ev = sig.calendar_event or {}
    if not ev.get("start"):
        raise HTTPException(status_code=404, detail="Signal has no event")

    def stamp(value: str) -> str:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    start = stamp(ev["start"])
    end = (
        stamp(ev["end"])
        if ev.get("end")
        else stamp(
            (
                datetime.fromisoformat(str(ev["start"]).replace("Z", "+00:00"))
                + timedelta(minutes=int(ev.get("duration_min", 60)))
            ).isoformat()
        )
    )

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//TARS//Today//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{sig.id}@tarsmv.duckdns.org",
        f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        f"DTSTART:{start}",
        f"DTEND:{end}",
        f"SUMMARY:{_ics_escape(ev.get('title') or sig.title)}",
    ]
    if ev.get("location"):
        lines.append(f"LOCATION:{_ics_escape(ev['location'])}")
    if ev.get("notes"):
        lines.append(f"DESCRIPTION:{_ics_escape(ev['notes'])}")
    lines += ["END:VEVENT", "END:VCALENDAR"]

    filename = (ev.get("title") or "event").lower().replace(" ", "-")[:48]
    return Response(
        content="\r\n".join(lines),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}.ics"'},
    )
