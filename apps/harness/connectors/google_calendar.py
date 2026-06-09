"""
Google Calendar connector — read and write events.
"""

import logging
from datetime import datetime, timezone
from typing import List, Optional

from googleapiclient.discovery import build
from google.auth.transport.requests import Request

from connectors.google_oauth import credentials_from_auth

log = logging.getLogger(__name__)


class GoogleCalendarClient:
    def __init__(self, auth: dict):
        creds = credentials_from_auth(auth)
        if not creds:
            raise ValueError("No valid Calendar credentials")
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
        self._service = build("calendar", "v3", credentials=creds, cache_discovery=False)

    def list_calendars(self) -> List[dict]:
        result = self._service.calendarList().list().execute()
        return result.get("items", [])

    def list_events(
        self,
        calendar_id: str = "primary",
        time_min: Optional[datetime] = None,
        time_max: Optional[datetime] = None,
        max_results: int = 50,
    ) -> List[dict]:
        if time_min is None:
            time_min = datetime.now(timezone.utc)

        kwargs = dict(
            calendarId=calendar_id,
            timeMin=time_min.isoformat(),
            maxResults=max_results,
            singleEvents=True,
            orderBy="startTime",
        )
        if time_max:
            kwargs["timeMax"] = time_max.isoformat()

        result = self._service.events().list(**kwargs).execute()
        return result.get("items", [])

    def get_upcoming_summary(self, days: int = 7, max_results: int = 15) -> List[dict]:
        """Upcoming events summary for context injection."""
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        time_max = now + timedelta(days=days)
        events = self.list_events(
            calendar_id="primary",
            time_min=now,
            time_max=time_max,
            max_results=max_results,
        )
        summaries = []
        for e in events:
            start = e.get("start", {})
            end = e.get("end", {})
            start_str = start.get("dateTime") or start.get("date", "")
            end_str = end.get("dateTime") or end.get("date", "")
            all_day = "date" in start and "dateTime" not in start
            attendees = [a.get("displayName") or a.get("email", "") for a in e.get("attendees", [])]
            summaries.append({
                "id": e.get("id", ""),
                "title": e.get("summary", "Untitled"),
                "start": start_str,
                "end": end_str,
                "all_day": all_day,
                "location": e.get("location"),
                "attendees": attendees,
                "description": (e.get("description") or "")[:200],
            })
        return summaries

    def create_event(self, calendar_id: str = "primary", **event_body) -> dict:
        return self._service.events().insert(
            calendarId=calendar_id, body=event_body
        ).execute()

    def patch_event(self, event_id: str, calendar_id: str = "primary", **fields) -> dict:
        """Partial update — only supplied fields are changed."""
        return self._service.events().patch(
            calendarId=calendar_id, eventId=event_id, body=fields
        ).execute()

    def delete_event(self, event_id: str, calendar_id: str = "primary") -> None:
        self._service.events().delete(
            calendarId=calendar_id, eventId=event_id
        ).execute()


def normalize_event(event: dict) -> dict:
    """Flatten a Google Calendar event into a simple dict."""
    start = event.get("start", {})
    end = event.get("end", {})
    return {
        "id": event.get("id"),
        "title": event.get("summary", "Untitled"),
        "description": event.get("description"),
        "location": event.get("location"),
        "start": start.get("dateTime") or start.get("date"),
        "end": end.get("dateTime") or end.get("date"),
        "all_day": "date" in start,
        "attendees": [a.get("email") for a in event.get("attendees", [])],
        "status": event.get("status"),
        "html_link": event.get("htmlLink"),
        "connector_ref": event.get("id"),
    }
