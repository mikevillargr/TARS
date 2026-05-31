import asyncio
import logging
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import Task, Meeting, Connector
from db.session import get_db

log = logging.getLogger(__name__)

router = APIRouter()


class CalendarEventOut(BaseModel):
    id: str
    type: str  # "gcal" | "task" | "meeting"
    title: str
    start: str
    end: Optional[str]
    duration_min: int
    all_day: bool
    location: Optional[str]
    attendees: List[str]
    source_id: Optional[str]
    description: Optional[str]


class CreateEventRequest(BaseModel):
    title: str
    start: str
    end: Optional[str] = None
    duration_min: int = 60
    description: Optional[str] = None
    location: Optional[str] = None


@router.get("/events", response_model=List[CalendarEventOut])
async def list_events(
    start: str = Query(...),
    end: str = Query(...),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    try:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")

    events: List[CalendarEventOut] = []

    # Google Calendar events
    try:
        r = await db.execute(
            select(Connector).where(
                Connector.user_id == user_id,
                Connector.name == "Google Calendar",
            )
        )
        conn = r.scalar_one_or_none()
        if conn and conn.auth.get("refresh_token"):
            from connectors.google_calendar import GoogleCalendarClient
            loop = asyncio.get_event_loop()
            client = GoogleCalendarClient(conn.auth)
            gcal_events = await loop.run_in_executor(
                None,
                lambda: client.list_events(
                    calendar_id="primary",
                    time_min=start_dt,
                    time_max=end_dt,
                    max_results=100,
                ),
            )
            for e in gcal_events:
                s = e.get("start", {})
                en = e.get("end", {})
                start_str = s.get("dateTime") or s.get("date", "")
                end_str = en.get("dateTime") or en.get("date", "")
                all_day = "date" in s and "dateTime" not in s
                duration_min = 60
                if not all_day and start_str and end_str:
                    try:
                        sd = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                        ed = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                        duration_min = max(15, int((ed - sd).total_seconds() / 60))
                    except Exception:
                        pass
                attendees = [
                    a.get("displayName") or a.get("email", "")
                    for a in e.get("attendees", [])
                ]
                events.append(CalendarEventOut(
                    id=f"gcal-{e['id']}",
                    type="gcal",
                    title=e.get("summary", "Untitled"),
                    start=start_str,
                    end=end_str,
                    duration_min=duration_min,
                    all_day=all_day,
                    location=e.get("location"),
                    attendees=attendees,
                    source_id=e["id"],
                    description=e.get("description"),
                ))
    except Exception as exc:
        log.warning("GCal events fetch failed: %s", exc)

    # Tasks with due dates in range
    try:
        task_r = await db.execute(
            select(Task).where(
                Task.user_id == user_id,
                Task.due_at >= start_dt,
                Task.due_at < end_dt,
                Task.status != "done",
            )
        )
        for t in task_r.scalars().all():
            events.append(CalendarEventOut(
                id=f"task-{t.id}",
                type="task",
                title=t.title,
                start=t.due_at.isoformat(),
                end=None,
                duration_min=30,
                all_day=False,
                location=None,
                attendees=[],
                source_id=t.id,
                description=t.description,
            ))
    except Exception as exc:
        log.warning("Task calendar fetch failed: %s", exc)

    # Meetings in range
    try:
        meeting_r = await db.execute(
            select(Meeting).where(
                Meeting.user_id == user_id,
                Meeting.started_at >= start_dt,
                Meeting.started_at < end_dt,
            )
        )
        for m in meeting_r.scalars().all():
            duration_min = 60
            if m.started_at and m.ended_at:
                duration_min = max(15, int((m.ended_at - m.started_at).total_seconds() / 60))
            events.append(CalendarEventOut(
                id=f"meeting-{m.id}",
                type="meeting",
                title=m.title,
                start=m.started_at.isoformat() if m.started_at else "",
                end=m.ended_at.isoformat() if m.ended_at else None,
                duration_min=duration_min,
                all_day=False,
                location=None,
                attendees=m.attendees or [],
                source_id=m.id,
                description=m.summary,
            ))
    except Exception as exc:
        log.warning("Meeting calendar fetch failed: %s", exc)

    return sorted(events, key=lambda ev: ev.start or "")


@router.post("/events", response_model=CalendarEventOut, status_code=201)
async def create_event(
    body: CreateEventRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    r = await db.execute(
        select(Connector).where(
            Connector.user_id == user_id,
            Connector.name == "Google Calendar",
        )
    )
    conn = r.scalar_one_or_none()
    if not conn or not conn.auth.get("refresh_token"):
        raise HTTPException(status_code=400, detail="Google Calendar not connected")

    from connectors.google_calendar import GoogleCalendarClient
    loop = asyncio.get_event_loop()
    client = GoogleCalendarClient(conn.auth)

    start_dt = datetime.fromisoformat(body.start.replace("Z", "+00:00"))
    end_dt = (
        datetime.fromisoformat(body.end.replace("Z", "+00:00"))
        if body.end
        else start_dt + timedelta(minutes=body.duration_min)
    )

    event_body = {
        "summary": body.title,
        "start": {"dateTime": start_dt.isoformat()},
        "end": {"dateTime": end_dt.isoformat()},
    }
    if body.description:
        event_body["description"] = body.description
    if body.location:
        event_body["location"] = body.location

    try:
        created = await loop.run_in_executor(
            None, lambda: client.create_event(calendar_id="primary", **event_body)
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Calendar API error: {exc}")

    start_str = created.get("start", {}).get("dateTime") or created.get("start", {}).get("date", "")
    end_str = created.get("end", {}).get("dateTime") or created.get("end", {}).get("date", "")

    return CalendarEventOut(
        id=f"gcal-{created['id']}",
        type="gcal",
        title=created.get("summary", body.title),
        start=start_str,
        end=end_str,
        duration_min=body.duration_min,
        all_day=False,
        location=created.get("location"),
        attendees=[],
        source_id=created["id"],
        description=created.get("description"),
    )
