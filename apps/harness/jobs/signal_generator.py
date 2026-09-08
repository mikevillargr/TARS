"""
Signal generation — the job that fills the /today screen.

Deliberately split into two kinds of detector:

  · Deterministic — a calendar double-booking, a stalled task, a meeting action
    item that never became a task. These are *facts*, computable from data.
    Asking a model "do these two events overlap?" would be slower, cost money,
    and be less reliable than a comparison operator. No model touches them.

  · Model-assisted — "did I commit to something in this transcript?", "is this
    thread waiting on me?". These need judgement, so they go to Tier 2 with a
    strict JSON contract and a conservative prompt.

Every detector returns candidates carrying a stable `dedupe_key`. A signal is
only inserted if no signal with that key exists for the user in ANY status, so
something you dismissed does not come back on the next sweep. That is a
deliberate trade: a dismissed-but-still-true condition (a task that stays
stalled) stays dismissed. Re-nagging is how a triage surface loses trust.
"""
import asyncio
import difflib
import hashlib
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


def _owner_is_someone_else(owner: Optional[str], user_name: str) -> bool:
    """
    True only when the extracted owner is explicitly a name other than the
    user's. An unassigned item (owner is None/blank) is ambiguous, not
    "someone else's" — it stays in. This is what keeps meeting action items
    that were assigned to other attendees out of the brief; Fireflies
    extraction has no concept of "mine", so the detector has to apply it.
    """
    owner = (owner or "").strip().lower()
    if not owner:
        return False
    first_name = (user_name or "Mike Villar").strip().split()[0].lower()
    full_name = (user_name or "Mike Villar").strip().lower()
    if owner == first_name or owner == full_name or owner.startswith(first_name + " "):
        return False
    return True


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
    Fireflies extracted action items that never became work.

    Grouped by meeting, one signal per meeting — NOT one per item. A real week
    produced 225 unconverted items here; as individual cards that is not a
    triage surface, it's a wall. "4 action items from the NCH sync were never
    assigned" is one decision; four near-identical cards is four.

    Fireflies extracts every action item in the transcript regardless of who
    it's for — it has no notion of "mine". Items explicitly owned by another
    attendee are filtered out here so the brief doesn't fill up with other
    people's work; unassigned items stay in since there's no one else to
    attribute them to.
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
        if _owner_is_someone_else(item.owner, user_name):
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

EXTRACT_SYSTEM = """You extract commitments from meeting transcripts for a triage screen.

Return ONLY a JSON array. No prose, no code fence. Each element:
{"title": "<imperative, <=110 chars, what Mike must do>",
 "quote": "<short verbatim quote showing the commitment>",
 "urgency": "normal" | "time"}

Rules:
- ONLY things Mike himself committed to do, or was explicitly asked to do.
  Not other people's commitments. Not general discussion.
- Before extracting anything, check the speaker label on the line the quote
  comes from. "Let me...", "I'll...", "I'm going to..." is the SPEAKER's own
  commitment — if that speaker isn't Mike, this is someone else's item, not
  his, even if it's addressed to him ("let me send YOU the file" is the
  sender's task, not the recipient's). Only count a first-person statement as
  Mike's if the speaker label right before it is Mike's.
- "You need to / you should / can you..." IS Mike's when explicitly addressed
  to him by someone else — but not when addressed to a third person or to
  "the team" in general (e.g. "your team should review this" is the team's
  job, not a personal task for Mike unless he says he'll do it himself).
- You may be given a list of action items already extracted from this
  meeting, each with an owner. If what you're about to extract is
  substantially the same piece of work as one of those and its owner isn't
  Mike, skip it — that work is already correctly attributed to someone else,
  even if Mike was part of the same conversation about it.
- Skip anything already obviously done inside the meeting.
- "time" urgency only if a deadline was stated or clearly implied this week.
- If nothing qualifies, return []. An empty array is a correct, common answer —
  do not invent items to seem useful.
- Maximum 3 items per transcript. Pick the most consequential."""

# First-person phrasing ("I'll...", "let me...", "on me") that only counts
# as Mike's commitment if the transcript speaker immediately before the
# quote is Mike. The prompt above already asks the model to check this, but
# Tier 2 (GLM) does not reliably follow it — see v2.18.x for a long history
# of this tier's instruction-following gaps. This is the deterministic
# backstop: locate the quote in the transcript (which build_plain_transcript
# labels with "{speaker}:" headers) and check who actually said it.
_FIRST_PERSON_RE = re.compile(r"\b(i|me|my)\b", re.I)
_SPEAKER_HEADER_RE = re.compile(r"\n([A-Za-z][\w'.-]*(?: [A-Za-z][\w'.-]*){0,3}):\n")
# Below this similarity, a transcript line isn't confidently "the same
# sentence" as the model's quote — verified against real production
# quotes, which are frequently light paraphrases ("Let me message you..."
# for an actual line of "I'll message you...") rather than truly verbatim.
_QUOTE_MATCH_THRESHOLD = 0.45


def _speaker_for_quote(transcript: str, quote: str) -> Optional[str]:
    """Nearest preceding speaker for a quote inside the transcript. Tries an
    exact substring match first, then falls back to the most similar single
    transcript line (the model's "verbatim" quote is often a paraphrase, not
    an exact copy). None if nothing matches with reasonable confidence —
    callers must treat that as "can't tell", not "it's Mike"."""
    quote = (quote or "").strip()
    if not quote:
        return None

    idx = transcript.find(quote)
    if idx != -1:
        return _nearest_speaker(transcript, idx)

    best_pos, best_ratio = -1, 0.0
    pos = 0
    for line in transcript.split("\n"):
        content = line.strip()
        if content and not content.endswith(":"):
            ratio = difflib.SequenceMatcher(None, quote.lower(), content.lower()).ratio()
            if ratio > best_ratio:
                best_pos, best_ratio = pos, ratio
        pos += len(line) + 1
    if best_ratio < _QUOTE_MATCH_THRESHOLD:
        return None
    return _nearest_speaker(transcript, best_pos)


def _nearest_speaker(transcript: str, idx: int) -> Optional[str]:
    matches = list(_SPEAKER_HEADER_RE.finditer(transcript[:idx]))
    return matches[-1].group(1).strip() if matches else None


def _commitment_misattributed(transcript: str, quote: str, user_name: str) -> bool:
    """True when a first-person quote ("let me...", "I'll...") was actually
    said by someone other than Mike — the model attributing another
    attendee's own commitment to Mike, the exact failure this exists to catch."""
    if not _FIRST_PERSON_RE.search(quote or ""):
        return False
    speaker = _speaker_for_quote(transcript, quote)
    return bool(speaker) and _owner_is_someone_else(speaker, user_name)


async def _other_owned_items_block(db: AsyncSession, meeting_id: str, user_name: str) -> str:
    """
    Action items Fireflies/meeting_processor already extracted for this
    meeting and attributed to someone other than Mike — the same ownership
    data the Meetings screen trusts. Fed into the extraction prompt as
    grounding so the model can recognize "this is already someone else's
    work" by meaning, not by string-matching a freshly generated title
    against a differently-worded action-item summary (tried that; genuine
    matches came back at 20-38% similarity, indistinguishable from noise —
    the two extractions phrase the same work too differently for that to be
    a reliable filter on its own).
    """
    rows = (
        await db.execute(
            select(MeetingActionItem.owner, MeetingActionItem.raw_text).where(
                MeetingActionItem.meeting_id == meeting_id,
            )
        )
    ).all()
    others = [(o, t) for o, t in rows if _owner_is_someone_else(o, user_name)]
    if not others:
        return ""
    lines = "\n".join(f"- {owner}: {text}" for owner, text in others)
    return (
        "\n\nAction items already extracted from this meeting, with owners "
        "(do not re-extract any of these as Mike's own commitment):\n" + lines
    )


def _extract_json_array(text: str) -> list:
    """Models wrap JSON in prose or fences more often than they should."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.+?)\s*```", text, re.S)
    if fence:
        text = fence.group(1).strip()
    start, end = text.find("["), text.rfind("]")
    if start == -1 or end == -1 or end < start:
        return []
    try:
        parsed = json.loads(text[start : end + 1])
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def _extract_json_object(text: str) -> dict:
    """Same deal as _extract_json_array, for detectors returning one object."""
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
# looking like "nothing found". Shared by every model-assisted detector;
# cleared once per sweep by generate_for_user, not per-detector, so the
# second detector to run doesn't wipe out the first one's errors.
_MODEL_ERRORS: list[str] = []


async def detect_meeting_commitments(db: AsyncSession, user_id: str) -> list[Candidate]:
    """Things Mike said he'd do, that never became anything."""
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    user_name = user.name if user and user.name else "Mike Villar"

    since = datetime.now(timezone.utc) - timedelta(days=MEETING_LOOKBACK_DAYS)
    meetings = (
        await db.execute(
            select(Meeting)
            .where(
                Meeting.user_id == user_id,
                Meeting.created_at >= since,
                Meeting.transcript.is_not(None),
            )
            .order_by(Meeting.created_at.desc())
            .limit(5)
        )
    ).scalars().all()

    out: list[Candidate] = []
    for m in meetings:
        transcript = (m.transcript or "")[:12000]
        if len(transcript) < 200:
            continue
        other_items = await _other_owned_items_block(db, m.id, user_name)
        prompt = (
            f"Meeting: {m.title}\n"
            f"Attendees: {', '.join(str(a) for a in (m.attendees or [])) or 'unknown'}\n\n"
            f"Transcript:\n{transcript}"
            f"{other_items}"
        )
        try:
            raw = await _complete(EXTRACT_SYSTEM, prompt)
        except Exception as exc:
            # One bad meeting must not abort the sweep — but don't swallow it
            # either. A misconfigured tier silently yields zero commitments
            # forever, which looks identical to "nothing to report".
            log.warning("signal_generator: extraction failed for %s: %s", m.id, exc)
            _MODEL_ERRORS.append(str(exc)[:200])
            continue

        client_name = await _client_for_attendees(db, user_id, m.attendees)
        for item in _extract_json_array(raw)[:3]:
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            quote = str(item.get("quote") or "").strip()
            if _commitment_misattributed(transcript, quote, user_name):
                # The model attributed another attendee's first-person
                # commitment ("let me...", "I'll...") to Mike — the quote's
                # actual speaker isn't him. Confirmed against production data
                # to be a real, recurring failure mode of this extraction.
                continue
            urgency = item.get("urgency") if item.get("urgency") in ("normal", "time") else "normal"
            fingerprint = hashlib.sha1(title.lower().encode()).hexdigest()[:12]
            out.append(_candidate(
                dedupe_key=f"commit:{m.id}:{fingerprint}",
                source="fireflies",
                source_label="Fireflies",
                source_ref=m.id,
                title=title[:180],
                urgency=urgency,
                context_label=client_name,
                # Only claim what was actually checked. An earlier draft said
                # "No matching task, To-Do, or sent email exists" — nothing
                # verifies that, and a reasoning line that asserts unverified
                # facts is worse than a shorter one that doesn't.
                reasoning=(
                    (f"You said: \"{quote}\"\n\n" if quote else "")
                    + f"Picked up from the transcript of \"{m.title}\" as something you "
                      f"took on. Not yet checked against existing tasks or sent mail."
                ),
                citation=f"Meeting · {m.title[:60]}",
                actions=[
                    {"kind": "create_reminder", "label": "Add to To-Dos"},
                    {"kind": "draft_reply", "label": "Draft the email now"},
                    {"kind": "open_meeting", "label": "Open the meeting"},
                ],
            ))
    return out


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
    judgement, so that part goes to Tier 2 with the same conservative,
    empty-is-a-valid-answer contract as detect_meeting_commitments.

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
    ("meeting_commitments", detect_meeting_commitments),
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
