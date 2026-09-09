"""
Signal generation — the job that fills the /today screen.

Deliberately split into two kinds of detector:

  · Deterministic — a calendar double-booking, a stalled task, a meeting action
    item that never became a task. These are *facts*, computable from data.
    Asking a model "do these two events overlap?" would be slower, cost money,
    and be less reliable than a comparison operator. No model touches them.

  · Model-assisted — "is this email thread waiting on me?". Needs judgement,
    so it goes to Tier 2 with a strict JSON contract and a conservative prompt.

There used to be a second model-assisted detector here — detect_meeting_commitments,
which re-extracted "things Mike committed to" from raw transcripts independently of
meeting_processor.py's action-item extraction. Retired in v2.19.0: it had to guess
ownership from scratch on a truncated transcript with no cross-reference, and kept
misattributing other attendees' first-person commitments to Mike (v2.18.10/v2.18.11
patched around this twice before it was clear the second extraction pass was the
actual problem). meeting_processor.py's extraction already does this reliably — it
has the full transcript, Fireflies' own overview/action-items text, and one focused
job — so its prompt was broadened to also capture informal verbal commitments, not
just explicitly-stated to-dos. detect_unconverted_action_items below now covers both.

Every detector returns candidates carrying a stable `dedupe_key`. A signal is
only inserted if no signal with that key exists for the user in ANY status, so
something you dismissed does not come back on the next sweep. That is a
deliberate trade: a dismissed-but-still-true condition (a task that stays
stalled) stays dismissed. Re-nagging is how a triage surface loses trust.
"""
import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from db.models import (
    Signal, Task, Meeting, MeetingActionItem, Connector, Contact, User,
)
from db.session import AsyncSessionLocal

log = logging.getLogger(__name__)

# How far back to consider source material.
MEETING_LOOKBACK_DAYS = 7
STALLED_TASK_DAYS = 4
CALENDAR_LOOKAHEAD_DAYS = 7
EMAIL_LOOKBACK_DAYS = 10
# Cap per sweep, so one pathological day can't produce a hundred cards.
MAX_NEW_PER_SWEEP = 12
# Threads checked deterministically (cheap metadata calls) vs. how many of
# those get a full-body model judgment (the expensive, bounded step).
MAX_EMAIL_CANDIDATES = 25
MAX_EMAIL_TO_MODEL = 10

# Domains that never identify a client — Mike's own org plus the personal
# webmail providers that regularly show up in attendee lists.
_NON_CLIENT_DOMAINS = {
    "growth-rocket.com", "gmail.com", "googlemail.com", "outlook.com",
    "hotmail.com", "yahoo.com", "icloud.com",
}


def _owner_is_mike(owner: Optional[str], user_name: str) -> bool:
    """
    True only when the action item is explicitly attached to the user by
    name — "Mike" or "Mike Villar" (or whatever User.name resolves to). An
    earlier version of this check treated an unassigned owner (None/blank)
    as ambiguous and let it through; per explicit correction, that's wrong —
    the extraction already names an owner for everything it can attribute,
    so no name means "not confirmed as his," not "maybe his." The tradeoff
    is accepted: a genuinely-his item that happened to come through
    unassigned gets missed, in exchange for zero false positives from other
    attendees' work.
    """
    owner = (owner or "").strip().lower()
    if not owner:
        return False
    first_name = (user_name or "Mike Villar").strip().split()[0].lower()
    full_name = (user_name or "Mike Villar").strip().lower()
    return owner == first_name or owner == full_name or owner.startswith(first_name + " ")


async def _client_for_attendees(
    db: AsyncSession, user_id: str, attendees: Optional[list[str]]
) -> Optional[str]:
    """
    Best-effort client name for a meeting or event, from the Contacts graph
    rather than a hardcoded client list — so it stays correct as clients
    change. Matches attendee emails (external domains only) against synced
    Google Contacts and returns the most common organization. None when
    nothing resolves — callers fall back to no client tag rather than a guess.
    """
    if not attendees:
        return None
    emails = [a.strip().lower() for a in attendees if a and "@" in a]
    emails = [e for e in emails if e.split("@", 1)[-1] not in _NON_CLIENT_DOMAINS]
    if not emails:
        return None

    rows = (
        await db.execute(
            select(Contact.organization).where(
                Contact.user_id == user_id,
                Contact.primary_email.in_(emails),
                Contact.organization.is_not(None),
            )
        )
    ).scalars().all()

    counts: dict[str, int] = {}
    for org in rows:
        org = (org or "").strip()
        if org and org.lower() != "growth rocket":
            counts[org] = counts.get(org, 0) + 1
    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0]


# ─── Candidate ────────────────────────────────────────────────────────────────

class Candidate(dict):
    """A proposed signal. Plain dict so it maps straight onto the model."""


def _candidate(
    *,
    dedupe_key: str,
    source: str,
    source_label: str,
    title: str,
    urgency: str = "normal",
    reasoning: str = "",
    citation: str = "",
    actions: Optional[list] = None,
    kind: str = "action",
    source_ref: Optional[str] = None,
    calendar_event: Optional[dict] = None,
    context_label: Optional[str] = None,
) -> Candidate:
    return Candidate(
        dedupe_key=dedupe_key,
        source=source,
        source_label=source_label,
        title=title,
        urgency=urgency,
        reasoning=reasoning,
        citation=citation,
        actions=actions or [],
        kind=kind,
        context_label=context_label,
        source_ref=source_ref,
        calendar_event=calendar_event,
    )


# ─── Deterministic detectors ──────────────────────────────────────────────────

async def detect_stalled_tasks(db: AsyncSession, user_id: str) -> list[Candidate]:
    """In-progress work that hasn't moved, and anything past its due date."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=STALLED_TASK_DAYS)
    rows = (
        await db.execute(
            select(Task).where(
                Task.user_id == user_id,
                Task.status.in_(["in_progress", "todo"]),
            )
        )
    ).scalars().all()

    out: list[Candidate] = []
    for t in rows:
        overdue = t.due_at is not None and t.due_at < now
        stalled = t.status == "in_progress" and t.updated_at < cutoff
        if not (overdue or stalled):
            continue

        if overdue:
            days = (now - t.due_at).days
            reason = (
                f"Due date passed {days} day{'s' if days != 1 else ''} ago and the task is "
                f"still in {t.status.replace('_', ' ')}."
            )
            urgency = "overdue"
        else:
            days = (now - t.updated_at).days
            reason = (
                f"Moved to In Progress {days} days ago and hasn't been touched since. "
                f"Either it's done, or it's stuck."
            )
            urgency = "normal"

        out.append(_candidate(
            dedupe_key=f"task-stalled:{t.id}",
            source="project",
            source_label="Projects",
            source_ref=t.id,
            title=f"{t.title} — {'overdue' if overdue else 'no movement in ' + str(days) + ' days'}",
            urgency=urgency,
            reasoning=reason,
            citation=f"Projects · {t.title[:60]}",
            actions=[
                {"kind": "open_meeting", "label": "Open project"},
                {"kind": "create_reminder", "label": "Add to To-Dos"},
            ],
        ))
    return out


async def detect_unconverted_action_items(db: AsyncSession, user_id: str) -> list[Candidate]:
    """
    Action items extracted from meetings that never became work — both
    explicitly-stated to-dos and, since v2.19.0, informal verbal commitments
    ("let me send that over") that meeting_processor.py's extraction now also
    captures as action items. That consolidation retired the separate
    detect_meeting_commitments detector, which re-derived ownership from a
    truncated transcript with no cross-reference and kept misattributing
    other attendees' commitments to Mike — meeting_processor.py already does
    this reliably (full transcript, Fireflies' own context, one focused job),
    so there was no reason for a second, worse extraction pass.

    Grouped by meeting, one signal per meeting — NOT one per item. A real week
    produced 225 unconverted items here; as individual cards that is not a
    triage surface, it's a wall. "4 action items from the NCH sync were never
    assigned" is one decision; four near-identical cards is four.

    Every action item is extracted regardless of who it's for — the extraction
    has no notion of "mine". Only items explicitly attached to Mike by name
    are surfaced; anything owned by someone else, or with no owner at all,
    is excluded (see _owner_is_mike — no name means "not confirmed as his,"
    not "maybe his").
    """
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    user_name = user.name if user and user.name else "Mike Villar"

    since = datetime.now(timezone.utc) - timedelta(days=MEETING_LOOKBACK_DAYS)
    rows = (
        await db.execute(
            select(MeetingActionItem, Meeting)
            .join(Meeting, MeetingActionItem.meeting_id == Meeting.id)
            .where(
                Meeting.user_id == user_id,
                MeetingActionItem.task_id.is_(None),
                Meeting.created_at >= since,
            )
        )
    ).all()

    by_meeting: dict[str, tuple[Meeting, list[MeetingActionItem]]] = {}
    for item, meeting in rows:
        if not (item.raw_text or "").strip():
            continue
        if not _owner_is_mike(item.owner, user_name):
            continue
        by_meeting.setdefault(meeting.id, (meeting, []))[1].append(item)

    out: list[Candidate] = []
    for meeting_id, (meeting, items) in by_meeting.items():
        n = len(items)
        preview = [i.raw_text.strip()[:110] for i in items[:4]]
        more = n - len(preview)
        title = (
            items[0].raw_text.strip()[:180]
            if n == 1
            else f"{n} action items from \"{meeting.title[:50]}\" were never assigned"
        )
        client_name = await _client_for_attendees(db, user_id, meeting.attendees)
        out.append(_candidate(
            dedupe_key=f"mai-batch:{meeting_id}",
            source="fireflies",
            source_label="Fireflies",
            source_ref=meeting_id,
            title=title,
            urgency="normal",
            context_label=client_name,
            reasoning=(
                f"Fireflies extracted {n} action item{'s' if n != 1 else ''} assigned to you "
                f"from this meeting and none were converted to a task or To-Do.\n\n"
                + "\n".join(f"· {p}" for p in preview)
                + (f"\n· …and {more} more" if more > 0 else "")
            ),
            citation=f"Meeting · {meeting.title[:60]}",
            actions=[
                {"kind": "open_meeting", "label": "Review in the meeting"},
                {"kind": "create_reminder", "label": "Add to To-Dos"},
                {"kind": "create_task", "label": "Add to Projects"},
            ],
        ))
    return out


async def _fetch_calendar_events(
    db: AsyncSession, user_id: str, conn_name: str, now: datetime, end: datetime,
) -> list[dict]:
    conn = (
        await db.execute(
            select(Connector).where(
                Connector.user_id == user_id,
                Connector.name == conn_name,
            )
        )
    ).scalar_one_or_none()
    if not conn or not (conn.auth or {}).get("refresh_token"):
        return []

    from connectors.google_calendar import GoogleCalendarClient

    client = GoogleCalendarClient(conn.auth)
    loop = asyncio.get_event_loop()
    try:
        return await loop.run_in_executor(
            None,
            # list_events takes datetimes and calls .isoformat() itself —
            # passing strings raised 'str' object has no attribute 'isoformat'
            # in production. It passed locally only because no calendar was
            # connected, so the function returned before ever reaching here.
            lambda: client.list_events(
                calendar_id="primary",
                time_min=now,
                time_max=end,
            ),
        ) or []
    except Exception as exc:  # a calendar outage must not kill the sweep
        log.warning("signal_generator: calendar fetch failed (%s): %s", conn_name, exc)
        return []


async def detect_calendar_conflicts(db: AsyncSession, user_id: str) -> list[Candidate]:
    """Overlapping accepted events across BOTH calendars — a work meeting double-booked
    against a personal appointment is exactly the case this exists to catch, so work and
    personal events are merged into one timeline before checking for overlap."""
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=CALENDAR_LOOKAHEAD_DAYS)

    work_raw = await _fetch_calendar_events(db, user_id, "Google Calendar", now, end)
    personal_raw = await _fetch_calendar_events(db, user_id, "Google Calendar (Personal)", now, end)
    if not work_raw and not personal_raw:
        return []

    timed = []
    for account, raw in (("work", work_raw), ("personal", personal_raw)):
        for ev in raw:
            start = (ev.get("start") or {}).get("dateTime")
            stop = (ev.get("end") or {}).get("dateTime")
            if not start or not stop:
                continue  # all-day events can't conflict in a meaningful way
            try:
                timed.append((
                    datetime.fromisoformat(start.replace("Z", "+00:00")),
                    datetime.fromisoformat(stop.replace("Z", "+00:00")),
                    ev.get("summary") or "(untitled)",
                    ev.get("id") or "",
                    [a.get("email") for a in (ev.get("attendees") or []) if a.get("email")],
                    account,
                ))
            except ValueError:
                continue
    timed.sort(key=lambda x: x[0])

    out: list[Candidate] = []
    for i in range(len(timed) - 1):
        a_start, a_end, a_title, a_id, a_attendees, a_acct = timed[i]
        b_start, b_end, b_title, b_id, b_attendees, b_acct = timed[i + 1]
        if b_start >= a_end:
            continue
        pair = ":".join(sorted([a_id, b_id]))
        when = a_start.strftime("%a %d %b, %H:%M")
        cross_account = a_acct != b_acct
        a_label = f"{a_title} (personal)" if cross_account and a_acct == "personal" else a_title
        b_label = f"{b_title} (personal)" if cross_account and b_acct == "personal" else b_title
        # A cross-account conflict has no client to resolve either side against.
        client_name = None if cross_account else await _client_for_attendees(db, user_id, a_attendees + b_attendees)
        out.append(_candidate(
            dedupe_key=f"cal-conflict:{pair}",
            source="calendar",
            source_label="Calendar",
            source_ref=a_id,
            title=f"You're double-booked {when} — {a_label} vs. {b_label}",
            urgency="time" if a_start - now < timedelta(days=2) else "normal",
            context_label=client_name,
            reasoning=(
                f"\"{a_title}\" runs {a_start.strftime('%H:%M')}–{a_end.strftime('%H:%M')} and "
                f"\"{b_title}\" starts {b_start.strftime('%H:%M')}, so they overlap."
            ),
            citation=f"Calendar · {when}",
            actions=[
                {"kind": "move_event", "label": f"Move {a_title[:28]}"},
                {"kind": "draft_reply", "label": "Ask to reschedule"},
            ],
        ))
    return out


# ─── Model-assisted detector ──────────────────────────────────────────────────

def _extract_json_object(text: str) -> dict:
    """Models wrap JSON in prose or fences more often than they should."""
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


async def _complete(system: str, prompt: str, max_tokens: int = 900) -> str:
    """Collect a non-streaming completion off the streaming client."""
    from core.model_client import get_model_client, ModelTier

    client = get_model_client()
    parts: list[str] = []
    async for event in client.stream(
        messages=[{"role": "user", "content": prompt}],
        tier=ModelTier.TIER2,
        system=system,
        max_tokens=max_tokens,
    ):
        if event.get("type") == "chunk":
            parts.append(event.get("text", ""))
        elif event.get("type") == "error":
            raise RuntimeError(event.get("error", "model error"))
    return "".join(parts)


# Populated per-sweep so a broken model tier surfaces in the result instead of
# looking like "nothing found". Cleared once per sweep by generate_for_user.
_MODEL_ERRORS: list[str] = []


EMAIL_EXTRACT_SYSTEM = """You review an inbound email thread for Mike Villar's triage screen \
and decide whether it needs a decision from him.

Return ONLY a JSON object. No prose, no code fence:
{"actionable": true | false,
 "kind": "action" | "fyi",
 "title": "<imperative, <=110 chars, what Mike must do>",
 "urgency": "normal" | "time",
 "suggested_action": "draft_reply" | "create_task" | "create_reminder",
 "category": "billing" | "legal" | "banking" | "vendor" | "recruiting" | "scheduling" | "internal" | null}

Rules:
- actionable=false for newsletters, receipts, automated notifications, threads already
  resolved, or anything that doesn't need a response or decision from Mike. This is the
  correct, common answer — do not invent an action item to seem useful.
- actionable=true only when Mike himself needs to reply, decide, approve, pay, schedule,
  or review something because of this email.
- kind="fyi" for something worth knowing but not needing a reply (rare — a contract was
  countersigned, a payment cleared). Everything else that's actionable is kind="action".
- "time" urgency only if a deadline is stated or clearly implied this week.
- suggested_action: "draft_reply" for anything needing a written response (the default for
  most actionable email); "create_task" for tracked project work; "create_reminder" for a
  simple personal reminder that needs no reply.
- category is a coarse tag for triage-screen scanning, used only when the sender is NOT a
  client/business contact (an AWS invoice is "billing", a bank notice is "banking", a job
  applicant is "recruiting", a tool/agency vendor is "vendor", a logistics/venue email is
  "scheduling", something from Mike's own team is "internal"). Use null for client or
  personal correspondence — client identification is handled separately and takes priority.
- If actionable is false, the other fields are ignored — just return {"actionable": false}."""

_EMAIL_ACTION_LABELS = {
    "draft_reply":     {"kind": "draft_reply", "label": "Draft reply"},
    "create_task":     {"kind": "create_task", "label": "Add to Projects"},
    "create_reminder": {"kind": "create_reminder", "label": "Add to To-Dos"},
}

# Display text for the model's category guess — used as the context chip only
# when no client resolves from the Contacts graph (that takes priority).
_EMAIL_CATEGORY_LABELS = {
    "billing":    "Billing",
    "legal":      "Legal",
    "banking":    "Banking",
    "vendor":     "Vendor",
    "recruiting": "Recruiting",
    "scheduling": "Scheduling",
    "internal":   "Internal",
}


def _email_actions(primary_kind: str) -> list[dict]:
    """Primary first (TARS's pick), the other two supported kinds as alternates."""
    order = [primary_kind] + [k for k in _EMAIL_ACTION_LABELS if k != primary_kind]
    return [_EMAIL_ACTION_LABELS[k] for k in order]


async def detect_actionable_emails(db: AsyncSession, user_id: str) -> list[Candidate]:
    """
    Inbound email still waiting on Mike — whether unread, or read and quietly
    never answered. "Waiting on Mike" is deterministic (GmailClient.get_awaiting_reply
    reads it off the SENT label); "does it actually need anything from him" is
    judgement, so that part goes to Tier 2 with a conservative,
    empty-is-a-valid-answer contract: newsletters/receipts/automated notices
    correctly resolve to "no action needed," not invented busywork.

    dedupe_key includes the thread's latest message id, not just the thread id,
    so a dismissed thread stays dismissed (dismissing it means "no action was
    needed") while a genuinely new reply on the same thread gets judged fresh.
    """
    conn = (
        await db.execute(
            select(Connector).where(
                Connector.user_id == user_id,
                Connector.name == "Gmail",
            )
        )
    ).scalar_one_or_none()
    if not conn or not (conn.auth or {}).get("refresh_token"):
        return []

    from connectors.gmail import GmailClient, extract_thread_text

    client = GmailClient(conn.auth)
    loop = asyncio.get_event_loop()
    try:
        pending = await loop.run_in_executor(
            None,
            lambda: client.get_awaiting_reply(MAX_EMAIL_CANDIDATES, EMAIL_LOOKBACK_DAYS),
        )
    except Exception as exc:  # a Gmail outage must not kill the sweep
        log.warning("signal_generator: gmail fetch failed: %s", exc)
        return []

    out: list[Candidate] = []
    for c in pending[:MAX_EMAIL_TO_MODEL]:
        try:
            thread = await loop.run_in_executor(
                None, lambda tid=c["thread_id"]: client.get_thread(tid)
            )
        except Exception as exc:
            log.warning("signal_generator: thread fetch failed for %s: %s", c["thread_id"], exc)
            continue
        body = extract_thread_text(thread)
        if not body:
            continue
        prompt = f"From: {c['from_name']} <{c['from_email']}>\nSubject: {c['subject']}\n\nThread:\n{body[-6000:]}"
        try:
            raw = await _complete(EMAIL_EXTRACT_SYSTEM, prompt)
        except Exception as exc:
            log.warning("signal_generator: email extraction failed for %s: %s", c["thread_id"], exc)
            _MODEL_ERRORS.append(str(exc)[:200])
            continue

        parsed = _extract_json_object(raw)
        if not parsed.get("actionable"):
            continue
        title = str(parsed.get("title") or "").strip()
        if not title:
            continue
        kind = parsed.get("kind") if parsed.get("kind") in ("action", "fyi") else "action"
        urgency = parsed.get("urgency") if parsed.get("urgency") in ("normal", "time") else "normal"
        suggested = (
            parsed.get("suggested_action")
            if parsed.get("suggested_action") in _EMAIL_ACTION_LABELS
            else "draft_reply"
        )

        client_name = await _client_for_attendees(db, user_id, [c["from_email"]])
        category_label = _EMAIL_CATEGORY_LABELS.get(parsed.get("category") or "")
        # Client identification takes priority — it's the more specific,
        # deterministic answer. Category is only a fallback for senders that
        # aren't in the Contacts graph as a client/business relationship.
        context_label = client_name or category_label

        out.append(_candidate(
            dedupe_key=f"email:{c['thread_id']}:{c['message_id']}",
            source="gmail",
            source_label="Gmail",
            source_ref=c["thread_id"],
            title=title[:180],
            urgency=urgency,
            kind=kind,
            context_label=context_label,
            reasoning=(
                f"From {c['from_name']} — \"{c['subject']}\".\n\n"
                + ("Unread. " if c["unread"] else "Read, but no reply sent. ")
                + "Not yet checked against sent mail beyond this thread."
            ),
            citation=f"Gmail · {c['subject'][:60]}",
            actions=_email_actions(suggested),
        ))
    return out


# ─── Orchestrator ─────────────────────────────────────────────────────────────

DETECTORS = (
    ("stalled_tasks", detect_stalled_tasks),
    ("unconverted_action_items", detect_unconverted_action_items),
    ("calendar_conflicts", detect_calendar_conflicts),
    ("actionable_emails", detect_actionable_emails),
)

URGENCY_RANK = {"overdue": 0, "time": 1, "normal": 2}


async def generate_for_user(db: AsyncSession, user_id: str) -> dict[str, Any]:
    """Run every detector, drop anything already seen, insert the rest."""
    _MODEL_ERRORS.clear()
    candidates: list[Candidate] = []
    per_detector: dict[str, int] = {}

    for name, fn in DETECTORS:
        try:
            found = await fn(db, user_id)
        except Exception as exc:
            # A detector failing is a bad day for that source, not for the sweep.
            log.exception("signal_generator: detector %s failed: %s", name, exc)
            per_detector[name] = -1
            continue
        per_detector[name] = len(found)
        candidates.extend(found)

    if not candidates:
        return {
            "created": 0,
            **({"model_errors": _MODEL_ERRORS[:3]} if _MODEL_ERRORS else {}),
            "detectors": per_detector,
        }

    keys = [c["dedupe_key"] for c in candidates]
    seen = {
        k for (k,) in (
            await db.execute(
                select(Signal.dedupe_key).where(
                    Signal.user_id == user_id,
                    Signal.dedupe_key.in_(keys),
                )
            )
        ).all()
    }

    unseen = [c for c in candidates if c["dedupe_key"] not in seen]
    # Most urgent first, so the per-sweep cap drops the least important.
    unseen.sort(key=lambda c: URGENCY_RANK.get(c["urgency"], 3))
    fresh = unseen[:MAX_NEW_PER_SWEEP]

    for c in fresh:
        db.add(Signal(user_id=user_id, status="open", **c))
    await db.commit()

    # Reported separately on purpose: "already seen" and "cut by the cap" mean
    # very different things, and a backlog waiting on the cap is worth knowing
    # about rather than hiding inside one number.
    result = {
        "created": len(fresh),
        **({"model_errors": _MODEL_ERRORS[:3]} if _MODEL_ERRORS else {}),
        "already_seen": len(candidates) - len(unseen),
        "deferred_by_cap": len(unseen) - len(fresh),
        "detectors": per_detector,
    }
    log.info("signal_generator: %s for %s", result, user_id)
    return result


async def run_sweep() -> dict[str, Any]:
    """Entry point for the scheduler and the manual trigger."""
    async with AsyncSessionLocal() as db:
        user = (
            await db.execute(select(User).where(User.id == settings.tars_username))
        ).scalars().first()
        if not user:
            # Never select(User).limit(1) — that ambiguity caused the duplicate
            # meeting ingestion in v2.15.9/v2.15.10.
            log.warning("signal_generator: no user matching tars_username; skipping")
            return {"created": 0, "error": "no user"}
        return await generate_for_user(db, user.id)
