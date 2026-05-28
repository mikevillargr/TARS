from typing import List
from connectors.base import ConnectorStatus
from core.config import settings


def list_connectors() -> List[ConnectorStatus]:
    connectors = []

    connectors.append(ConnectorStatus(
        id="fireflies",
        name="Fireflies",
        status="connected" if settings.fireflies_api_key else "disconnected",
        capabilities=["read", "webhook"],
        metadata={"description": "Meeting transcripts and summaries"},
    ))

    connectors.append(ConnectorStatus(
        id="gmail",
        name="Gmail",
        status="connected" if settings.gmail_client_id else "disconnected",
        capabilities=["read", "webhook"],
        metadata={"description": "Email read and digest"},
    ))

    connectors.append(ConnectorStatus(
        id="gcal",
        name="Google Calendar",
        status="connected" if settings.gcal_client_id else "disconnected",
        capabilities=["read", "write"],
        metadata={"description": "Calendar events"},
    ))

    return connectors
