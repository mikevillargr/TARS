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
    ]
