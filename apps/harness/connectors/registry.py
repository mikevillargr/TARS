from typing import List
from connectors.base import ConnectorStatus
from core.config import settings


def list_connectors() -> List[ConnectorStatus]:
    return [
        ConnectorStatus(
            id="fireflies",
            name="Fireflies",
            status="connected" if settings.fireflies_api_key else "disconnected",
            capabilities=["read", "webhook"],
            metadata={"description": "Meeting transcripts and summaries", "auth_type": "api_key"},
        ),
        ConnectorStatus(
            id="gmail",
            name="Gmail",
            status="disconnected",  # upgraded to "connected" in route if DB token exists
            capabilities=["read", "webhook"],
            metadata={"description": "Email read and digest", "auth_type": "oauth2"},
        ),
        ConnectorStatus(
            id="gcal",
            name="Google Calendar",
            status="disconnected",  # upgraded to "connected" in route if DB token exists
            capabilities=["read", "write"],
            metadata={"description": "Calendar events", "auth_type": "oauth2"},
        ),
        ConnectorStatus(
            id="google_people",
            name="Google Contacts",
            status="disconnected",  # upgraded to "connected" in route if DB token exists
            capabilities=["read", "write"],
            metadata={"description": "Contact graph + auto-enrichment", "auth_type": "oauth2"},
        ),
        ConnectorStatus(
            id="google_workspace",
            name="Google Workspace",
            status="disconnected",  # upgraded to "connected" in route if DB token exists
            capabilities=["read", "write"],
            metadata={
                "description": "Read & write Google Docs, Sheets, and Slides by link",
                "auth_type": "oauth2",
            },
        ),
        ConnectorStatus(
            id="strava",
            name="Strava",
            status="disconnected",  # upgraded in route if DB token exists
            capabilities=["read"],
            metadata={
                "description": "Rides, runs, HR zones, and athlete stats",
                "auth_type": "oauth2",
                "settings_schema": [
                    {
                        "key": "client_id",
                        "label": "Client ID",
                        "type": "text",
                        "group": "credentials",
                    },
                    {
                        "key": "client_secret",
                        "label": "Client Secret",
                        "type": "password",
                        "group": "credentials",
                    },
                    {
                        "key": "sync_interval_minutes",
                        "label": "Sync every",
                        "type": "select",
                        "options": ["15", "30", "60", "120", "360"],
                        "default": "60",
                    },
                ],
            },
        ),
        ConnectorStatus(
            id="always_sunny",
            name="AlwaysSunny",
            status="connected" if settings.always_sunny_api_key else "disconnected",
            capabilities=["read", "write"],
            metadata={
                "description": "Solar energy + Tesla charging controller",
                "auth_type": "api_key",
            },
        ),
        ConnectorStatus(
            id="garmin",
            name="Garmin Connect",
            status="disconnected",  # upgraded in route if garth_tokens in config
            capabilities=["read"],
            metadata={
                "description": "Activities, sleep, HRV, and body battery",
                "auth_type": "credentials",
                "settings_schema": [
                    {
                        "key": "sync_interval_minutes",
                        "label": "Sync every",
                        "type": "select",
                        "options": ["15", "30", "60", "120", "360"],
                        "default": "60",
                    },
                ],
            },
        ),
    ]
