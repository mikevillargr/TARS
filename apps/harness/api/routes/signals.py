"""
Signals API — the /today screen.

A Signal is an inferred claim that something needs a decision. This module owns
its lifecycle (open → snoozed / done / dismissed, all reversible) and the
dispatch of its actions.

Dispatch splits in four, from "nothing to negotiate" to "needs real judgement":

  · Executed here, via POST /act — create_reminder / create_task / create_event /
    move_event. The card's inline form (SignalCard + InlineActionForm) lets
    Mike edit the payload before it commits — due date, title, description,
    priority, which items in a grouped batch actually become tasks, or (for
    move_event) a new time to PATCH the event to — via ActRequest.
    payload_override, merged over the action's own payload. No approval gate:
    none of these are the kind of irreversible, negotiated action
    email-sending is, and restore_signal covers what's left.

  · Pure navigation, via POST /act — open_meeting. source_ref is already the
    task or meeting id; this only ever needed a route, not a conversation.

  · Resolved in-card, via POST /draft (a separate endpoint, not /act) —
    email-sourced draft_reply. The card's ComposeStrip collects an optional
    steering note, then this generates an actual reply (Tier 2, given the
    real thread) and returns it for Mike to edit and send right there via the
    existing /email/confirm-send gate — no conversation ever created. Marks
    the signal done the moment the draft exists, same convention as every
    other acted-on signal; sending is a separate step the returned draft goes
    through afterward. Only available when source_ref is a real Gmail
    thread — calendar-conflict-sourced draft_reply ("Ask to reschedule") has
    no thread to reply to, since it's a new email to an attendee, and that
    needs the same judgement (who to address, given the Contacts graph) chat
    already applies rather than a second, narrower version of it here.

  · Handed to chat, via POST /act — anything left that still genuinely needs
    composition or judgement chat already does well (save_brain, discuss,
    calendar-sourced draft_reply). The card's ComposeStrip collects the same
    optional steering note as above; sent as ActRequest.note, prepended
    ahead of the reasoning already in the seeded prompt. These conversations
    sit behind the approval gates that already exist there.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from core.mentions import extract_mentions, strip_mention_markers
from db.models import Signal, Task, Reminder, Conversation, Message, Connector, Contact
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
    context_label: Optional[str] = None
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
    # Edits made in the card's inline form before committing — merged over the
    # action's own payload. Lets "Add to To-Dos" mean the text Mike actually
    # typed, not whatever the detector titled the card.
    payload_override: Optional[dict] = None
    # Freeform steering for the kinds still handed to chat (save_brain,
    # discuss, and calendar-sourced draft_reply) — prepended to the seeded
    # prompt as Mike's own instruction rather than left for the model to
    # infer from the card alone. May contain [[id|type|label]] mention
    # markers (ComposeStrip is a MentionTextarea) — stripped to plain labels
    # before reaching the prompt; see _seed_conversation.
    note: Optional[str] = None


class DraftRequest(BaseModel):
    # Same steering note as ActRequest.note, for the one action kind
    # (email-sourced draft_reply) that resolves in-card instead of going
    # through /act at all — see POST /{signal_id}/draft. A @-mentioned
    # contact here becomes a real CC on the generated draft (_cc_from_mentions),
    # not just prose the model might notice.
    note: Optional[str] = None


class DraftResult(BaseModel):
    ok: bool
    draft: dict  # {draft_id, to, subject, body, cc, thread_id, account} — EmailDraft shape


class SnoozeRequest(BaseModel):
    until: Optional[datetime] = None


class ActResult(BaseModel):
    ok: bool
    # Set when the action produced something to navigate to.
    conversation_id: Optional[str] = None
    reminder_id: Optional[str] = None
    task_id: Optional[str] = None
    task_ids: Optional[List[str]] = None
    event_id: Optional[str] = None
    # Set for open_meeting — an in-app route to push to, computed here since
    # the backend already knows the source→route mapping. No conversation
    # involved; this was never actually a chat handoff, just misdispatched.
    route: Optional[str] = None
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
    sig: Signal, action: dict, db: AsyncSession, user_id: str, note: Optional[str] = None
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
    # Mike's own steering, typed in the card before handing off — leads with
    # explicit priority over the reasoning above, which is TARS's inference,
    # not an instruction. Markers stripped to plain labels (not just left as
    # wire text): this message is inserted straight into history rather than
    # going through the live-composer send path, so there's no guarantee
    # _resolve_mentions ever runs on it before a model reads it — same
    # "don't feed raw id/type soup into a prompt" rule as everywhere else
    # that handles mention text server-side.
    if note and note.strip():
        lines += ["", f"**Mike's direction:** {strip_mention_markers(note.strip())}"]

    conv = Conversation(user_id=user_id, title=sig.title[:80])
    db.add(conv)
    await db.flush()

    db.add(Message(conversation_id=conv.id, role="user", content="\n".join(lines)))
    return conv.id


async def _create_event(
    sig: Signal, db: AsyncSession, user_id: str, override: Optional[dict] = None
) -> str:
    """
    Book the event the signal describes, or — via `override` from the card's
    inline form — the event Mike edited it into (different time, different
    account). Merged over the signal's own calendar_event, not a replacement
    for it, so a form that only touched one field doesn't lose the rest.
    """
    ev = {**(sig.calendar_event or {}), **(override or {})}
    if not ev.get("start"):
        raise HTTPException(status_code=400, detail="Signal has no event to create")

    conn_name = "Google Calendar (Personal)" if ev.get("account") == "personal" else "Google Calendar"
    r = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id, Connector.name == conn_name
        )
    )
    conn = r.scalar_one_or_none()
    if not conn or not conn.auth.get("refresh_token"):
        raise HTTPException(status_code=400, detail=f"{conn_name} not connected")

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


async def _update_event(
    sig: Signal, db: AsyncSession, user_id: str, override: dict
) -> str:
    """
    Reschedule the event this signal is about — move_event's resolution.
    `sig.source_ref` is the event id (detect_calendar_conflicts sets it to the
    conflicting event that should move); `override.account` says which
    calendar it lives on, since a cross-account conflict has no single answer
    otherwise. Mirrors PATCH /calendar/events/{id} (api/routes/calendar.py)
    rather than importing it directly — that route is request-shaped
    (UpdateEventRequest + auth dependency), this is signal-shaped.
    """
    if not sig.source_ref:
        raise HTTPException(status_code=400, detail="Signal has no event to move")
    if not override.get("datetime_iso"):
        raise HTTPException(status_code=400, detail="Pick a new time")

    conn_name = "Google Calendar (Personal)" if override.get("account") == "personal" else "Google Calendar"
    r = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id, Connector.name == conn_name
        )
    )
    conn = r.scalar_one_or_none()
    if not conn or not conn.auth.get("refresh_token"):
        raise HTTPException(status_code=400, detail=f"{conn_name} not connected")

    from connectors.google_calendar import GoogleCalendarClient

    client = GoogleCalendarClient(conn.auth)
    start_dt = datetime.fromisoformat(str(override["datetime_iso"]).replace("Z", "+00:00"))
    dur = int(override.get("duration_min") or 60)
    end_dt = start_dt + timedelta(minutes=dur)
    tz_str = str(start_dt.tzinfo or "UTC")

    loop = asyncio.get_event_loop()
    try:
        updated = await loop.run_in_executor(
            None,
            lambda: client.patch_event(
                sig.source_ref,
                start={"dateTime": start_dt.isoformat(), "timeZone": tz_str},
                end={"dateTime": end_dt.isoformat(), "timeZone": tz_str},
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Calendar API error: {exc}")
    return updated["id"]


REPLY_DRAFT_SYSTEM = """You draft Mike Villar's reply to an email thread. He will review and \
edit before sending — write a complete, sendable draft, not a placeholder or an outline.

Plain text only: no subject line, no signature block, no "Dear X" / "Best regards" boilerplate
unless the thread's own tone uses it. Match the register of Mike's own prior messages in the
thread if he's written in it before; otherwise professional and brief. If Mike's direction is
given, follow it exactly — it overrides your own read of what the reply should say."""


async def _generate_reply_draft(
    sig: Signal, db: AsyncSession, user_id: str, note: Optional[str]
) -> dict:
    """
    Compose a reply draft in-card — draft_reply's resolution for email-sourced
    signals. Only these have a real thread to read: source_ref is a Gmail
    thread id (set by detect_actionable_emails / the email side of
    detect_calendar_conflicts), so there's something concrete to fetch and
    reply to. Calendar-conflict-sourced draft_reply ("Ask to reschedule") has
    no such thread — that's a new email to an attendee, not a reply, which
    needs the same judgement chat already applies (who to address, given the
    Contacts graph) rather than a second, narrower version of it here. That
    case still falls through to _seed_conversation.
    """
    if sig.source != "gmail" or not sig.source_ref:
        raise HTTPException(
            status_code=400,
            detail="In-card drafting needs an email thread — use the chat handoff for this signal.",
        )

    conn = (
        await db.execute(
            select(Connector).where(Connector.user_id == user_id, Connector.name == "Gmail")
        )
    ).scalar_one_or_none()
    if not conn or not conn.auth.get("refresh_token"):
        raise HTTPException(status_code=400, detail="Gmail not connected")

    from connectors.gmail import GmailClient, extract_thread_text

    client = GmailClient(conn.auth)
    loop = asyncio.get_event_loop()
    try:
        thread = await loop.run_in_executor(None, lambda: client.get_thread(sig.source_ref))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gmail API error: {exc}")

    messages = thread.get("messages", [])
    if not messages:
        raise HTTPException(status_code=404, detail="Thread has no messages")
    last_headers = {
        h["name"]: h["value"] for h in messages[-1].get("payload", {}).get("headers", [])
    }
    from_raw = last_headers.get("From", "")
    reply_to = (
        from_raw.split("<")[-1].rstrip(">").strip() if "<" in from_raw else from_raw.strip()
    )
    subject = last_headers.get("Subject", "") or sig.title
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}"

    # @-mentioning a contact in the steering note adds them as a real CC —
    # resolved from the Contacts graph here, not left for the model to maybe
    # notice a name in prose and maybe do something useful with it. Extracted
    # from the note BEFORE stripping, since stripping is exactly what throws
    # the id away.
    cc = await _cc_from_mentions(note, db, user_id)

    thread_text = extract_thread_text(thread)
    prompt = f"Thread:\n{thread_text[-6000:]}\n\n"
    clean_note = strip_mention_markers(note).strip() if note else ""
    if clean_note:
        prompt += f"Mike's direction: {clean_note}\n\n"
    prompt += "Write Mike's reply."

    from core.model_client import complete_text

    body = await complete_text(REPLY_DRAFT_SYSTEM, prompt, max_tokens=700)

    import uuid

    return {
        "draft_id": str(uuid.uuid4()),
        "to": reply_to,
        "subject": subject,
        "body": body.strip(),
        "cc": cc,
        "thread_id": sig.source_ref,
        "account": "work",  # detect_actionable_emails is work-Gmail-only (v2.18.0 scope note)
    }


async def _cc_from_mentions(
    note: Optional[str], db: AsyncSession, user_id: str
) -> Optional[str]:
    """
    Resolve @-mentioned contacts in a steering note into real CC addresses.
    Non-contact mentions (a task, a knowledge item) are ignored here — they
    still reach the model as plain text via strip_mention_markers, just
    don't mean anything as a recipient. A mentioned contact with no email on
    file is silently skipped rather than raising: better to draft without
    them than to block the whole draft over one incomplete contact record.
    """
    if not note:
        return None
    emails: List[str] = []
    seen: set = set()
    for mention in extract_mentions(note):
        if mention.type != "contact":
            continue
        contact = await db.get(Contact, mention.id)
        if contact and contact.user_id == user_id and contact.primary_email:
            email = contact.primary_email.strip().lower()
            if email not in seen:
                seen.add(email)
                emails.append(contact.primary_email.strip())
    return ", ".join(emails) if emails else None


# Past-tense confirmations for the undo bar, keyed by action kind. Deliberately
# understated: this bar appears while the card is still sliding out, so it
# should confirm and get out of the way, not congratulate.
_RECEIPTS = {
    "create_reminder": "Added to To-Dos",
    "create_task": "Added to Projects",
    "create_event": "On your calendar",
    "move_event": "Moved",
}


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


@router.post("/generate")
async def generate_signals(
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    """
    Run a sweep now instead of waiting for the 4-hourly job.

    Runs inline rather than as a background task so the caller gets the real
    result — the frontend refresh button needs to know whether anything was
    actually found, and a fire-and-forget would just return an optimistic lie.
    """
    from jobs.signal_generator import generate_for_user

    return await generate_for_user(db, user_id)


@router.post("/{signal_id}/act", response_model=ActResult)
async def act_on_signal(
    signal_id: str,
    body: ActRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    sig = await _get_owned(signal_id, user_id, db)
    action = _action_by_kind(sig, body.kind)
    # The card's inline form edits win over whatever the detector proposed —
    # a signal's own payload is a starting draft, not a fixed instruction.
    payload = {**(action.get("payload") or {}), **(body.payload_override or {})}

    # The undo bar shows this, so it has to read as a receipt, not a command.
    # Echoing the action's own label put "Add to To-Dos" on a bar that appears
    # AFTER the thing was added, which is why the surface felt like it was
    # talking at Mike rather than back to him. Falls back to the label for any
    # kind that hands off to chat, where the label already reads as an outcome.
    result = ActResult(ok=True, message=_RECEIPTS.get(body.kind) or action.get("label", "Done"))

    if body.kind == "create_reminder":
        # The default landing place for signal-derived work. A signal is a
        # "don't forget this" prompt, which is what To-Dos are for; Projects
        # is for tracked work with a pipeline, and most signals never warrant
        # a kanban card.
        #
        # "due_at" absent from the merged payload means nobody has an opinion
        # yet — fall back to the urgency-implied default. Present-but-null
        # means the form's "No date" chip was picked explicitly, which must
        # win over that default rather than be treated the same as absent.
        if "due_at" in payload:
            due = payload["due_at"]
            due_dt = datetime.fromisoformat(str(due).replace("Z", "+00:00")) if due else None
        else:
            # Time-pressured signals arrive with today already implied;
            # dropping that would lose the only urgency the item had.
            due_dt = datetime.now(timezone.utc) if sig.urgency in ("overdue", "time") else None
        rem = Reminder(
            user_id=user_id,
            text=payload.get("text") or sig.title,
            due_at=due_dt,
        )
        db.add(rem)
        await db.flush()
        result.reminder_id = rem.id
        sig.result_ref = rem.id

    elif body.kind == "create_task":
        # Escalation path, offered as an alternate: this one really is tracked
        # project work and wants a card with a status pipeline.
        priority = payload.get("priority") or (
            "high" if sig.urgency in ("overdue", "time") else "normal"
        )
        # Grouped signals (e.g. "4 action items from X were never assigned")
        # carry the individual item texts in payload["items"]; the form lets
        # Mike tick which ones actually become tracked work instead of
        # forcing either "one task for everything" or "clean up 225 by hand".
        selected_items = payload.get("selected_items")
        if isinstance(selected_items, list) and selected_items:
            task_ids: list[str] = []
            for item_text in selected_items:
                task = Task(
                    user_id=user_id,
                    title=str(item_text)[:200],
                    status="todo",
                    priority=priority,
                    source="signal",
                    source_id=sig.id,
                )
                db.add(task)
                await db.flush()
                task_ids.append(task.id)
            result.task_ids = task_ids
            result.task_id = task_ids[0]
            sig.result_ref = task_ids[0]
        else:
            # No reasoning fallback here — a task description should be what
            # Mike chose to record, not the detector's internal "why this
            # surfaced" prose. The form pre-fills this field FROM reasoning
            # (visible, editable) so that content still reaches the task when
            # it's actually useful, but only as something Mike saw and kept.
            task = Task(
                user_id=user_id,
                title=payload.get("title") or sig.title,
                description=payload.get("description"),
                status="todo",
                priority=priority,
                source="signal",
                source_id=sig.id,
            )
            db.add(task)
            await db.flush()
            result.task_id = task.id
            sig.result_ref = task.id

    elif body.kind == "create_event":
        event_id = await _create_event(sig, db, user_id, override=payload or None)
        result.event_id = event_id
        sig.result_ref = event_id

    elif body.kind == "move_event":
        # Executed directly (since v2.19.5) — a new time is a fully specified
        # answer, same as create_event. No LLM needed to reschedule an event
        # to a time Mike picked himself; the chat handoff this used to fall
        # through to was overkill for "patch a datetime".
        event_id = await _update_event(sig, db, user_id, override=payload)
        result.event_id = event_id
        sig.result_ref = event_id

    elif body.kind == "open_meeting":
        # Pure navigation — source_ref is already the task or meeting id.
        # This never needed chat; it was falling into the conversation
        # handoff below purely because no branch claimed it first.
        if sig.source == "fireflies":
            result.route = f"/meetings?id={sig.source_ref}"
        elif sig.source == "project":
            result.route = f"/tasks?id={sig.source_ref}"
        else:
            result.route = "/today"
        sig.result_ref = sig.source_ref

    else:
        # draft_reply, save_brain, discuss, … — anything left that still
        # genuinely needs composition or judgement.
        conv_id = await _seed_conversation(sig, action, db, user_id, note=body.note)
        result.conversation_id = conv_id
        sig.result_ref = conv_id

    sig.status = "done"
    sig.acted_kind = body.kind
    sig.acted_at = datetime.now(timezone.utc)
    await db.commit()
    return result


@router.post("/{signal_id}/draft", response_model=DraftResult)
async def draft_reply_for_signal(
    signal_id: str,
    body: DraftRequest,
    db: AsyncSession = Depends(get_db),
    user_id: str = Depends(require_auth),
):
    """
    Generate a reply draft in-card — draft_reply's resolution when the signal
    has a real email thread behind it. Marks the signal done the moment the
    draft exists, same convention as every other acted-on signal (see
    restore_signal's docstring): the "work" of this action is producing the
    draft, not whatever happens to it afterward. Sending is a separate step
    the returned EmailDraft goes through — /email/confirm-send, the same gate
    chat's own drafts use — so this endpoint never sends anything itself.
    """
    sig = await _get_owned(signal_id, user_id, db)
    _action_by_kind(sig, "draft_reply")  # 404s if this signal has no such action
    draft = await _generate_reply_draft(sig, db, user_id, note=body.note)

    sig.status = "done"
    sig.acted_kind = "draft_reply"
    sig.acted_at = datetime.now(timezone.utc)
    sig.result_ref = draft["draft_id"]
    await db.commit()
    return DraftResult(ok=True, draft=draft)


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
