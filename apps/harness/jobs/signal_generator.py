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
    Signal, Task, Meeting, MeetingActionItem, Connector, User,
)
from db.session import AsyncSessionLocal

log = logging.getLogger(__name__)

# How far back to consider source material.
MEETING_LOOKBACK_DAYS = 7
STALLED_TASK_DAYS = 4
CALENDAR_LOOKAHEAD_DAYS = 7
# Cap per sweep, so one pathological day can't produce a hundred cards.
MAX_NEW_PER_SWEEP = 12


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
    """
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
        out.append(_candidate(
            dedupe_key=f"mai-batch:{meeting_id}",
            source="fireflies",
            source_label="Fireflies",
            source_ref=meeting_id,
            title=title,
            urgency="normal",
            reasoning=(
                f"Fireflies extracted {n} action item{'s' if n != 1 else ''} from this meeting "
                f"and none were converted to a task or To-Do.\n\n"
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


async def detect_calendar_conflicts(db: AsyncSession, user_id: str) -> list[Candidate]:
    """Overlapping accepted events, and days with no gap to breathe."""
    conn = (
        await db.execute(
            select(Connector).where(
                Connector.user_id == user_id,
                Connector.name == "Google Calendar",
            )
        )
    ).scalar_one_or_none()
    if not conn or not (conn.auth or {}).get("refresh_token"):
        return []

    from connectors.google_calendar import GoogleCalendarClient

    now = datetime.now(timezone.utc)
    end = now + timedelta(days=CALENDAR_LOOKAHEAD_DAYS)
    client = GoogleCalendarClient(conn.auth)
    loop = asyncio.get_event_loop()
    try:
        raw = await loop.run_in_executor(
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
        )
    except Exception as exc:  # a calendar outage must not kill the sweep
        log.warning("signal_generator: calendar fetch failed: %s", exc)
        return []

    timed = []
    for ev in raw or []:
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
            ))
        except ValueError:
            continue
    timed.sort(key=lambda x: x[0])

    out: list[Candidate] = []
    for i in range(len(timed) - 1):
        a_start, a_end, a_title, a_id = timed[i]
        b_start, b_end, b_title, b_id = timed[i + 1]
        if b_start >= a_end:
            continue
        pair = ":".join(sorted([a_id, b_id]))
        when = a_start.strftime("%a %d %b, %H:%M")
        out.append(_candidate(
            dedupe_key=f"cal-conflict:{pair}",
            source="calendar",
            source_label="Calendar",
            source_ref=a_id,
            title=f"You're double-booked {when} — {a_title} vs. {b_title}",
            urgency="time" if a_start - now < timedelta(days=2) else "normal",
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
- Skip anything already obviously done inside the meeting.
- "time" urgency only if a deadline was stated or clearly implied this week.
- If nothing qualifies, return []. An empty array is a correct, common answer —
  do not invent items to seem useful.
- Maximum 3 items per transcript. Pick the most consequential."""


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
# looking like "no commitments found".
_EXTRACTION_ERRORS: list[str] = []


async def detect_meeting_commitments(db: AsyncSession, user_id: str) -> list[Candidate]:
    """Things Mike said he'd do, that never became anything."""
    _EXTRACTION_ERRORS.clear()
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
        prompt = (
            f"Meeting: {m.title}\n"
            f"Attendees: {', '.join(str(a) for a in (m.attendees or [])) or 'unknown'}\n\n"
            f"Transcript:\n{transcript}"
        )
        try:
            raw = await _complete(EXTRACT_SYSTEM, prompt)
        except Exception as exc:
            # One bad meeting must not abort the sweep — but don't swallow it
            # either. A misconfigured tier silently yields zero commitments
            # forever, which looks identical to "nothing to report".
            log.warning("signal_generator: extraction failed for %s: %s", m.id, exc)
            _EXTRACTION_ERRORS.append(str(exc)[:200])
            continue

        for item in _extract_json_array(raw)[:3]:
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            quote = str(item.get("quote") or "").strip()
            urgency = item.get("urgency") if item.get("urgency") in ("normal", "time") else "normal"
            fingerprint = hashlib.sha1(title.lower().encode()).hexdigest()[:12]
            out.append(_candidate(
                dedupe_key=f"commit:{m.id}:{fingerprint}",
                source="fireflies",
                source_label="Fireflies",
                source_ref=m.id,
                title=title[:180],
                urgency=urgency,
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


# ─── Orchestrator ─────────────────────────────────────────────────────────────

DETECTORS = (
    ("stalled_tasks", detect_stalled_tasks),
    ("unconverted_action_items", detect_unconverted_action_items),
    ("calendar_conflicts", detect_calendar_conflicts),
    ("meeting_commitments", detect_meeting_commitments),
)

URGENCY_RANK = {"overdue": 0, "time": 1, "normal": 2}


async def generate_for_user(db: AsyncSession, user_id: str) -> dict[str, Any]:
    """Run every detector, drop anything already seen, insert the rest."""
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
        return {"created": 0, "detectors": per_detector}

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
        **({"model_errors": _EXTRACTION_ERRORS[:3]} if _EXTRACTION_ERRORS else {}),
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
