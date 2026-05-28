"""
Shared Google OAuth2 helpers for Gmail and Google Calendar.
Tokens are stored encrypted in the Connector.auth JSON column.
"""

import json
import logging
from typing import Optional

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from core.config import settings

log = logging.getLogger(__name__)

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
]
GCAL_SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
]

_REDIRECT_BASE = "https://tarsmv.duckdns.org"
_REDIRECT_BASE_LOCAL = "http://localhost:8000"


def _client_config(connector: str) -> dict:
    if connector == "gmail":
        client_id = settings.gmail_client_id
        client_secret = settings.gmail_client_secret
    else:
        client_id = settings.gcal_client_id
        client_secret = settings.gcal_client_secret

    return {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [
                f"{_REDIRECT_BASE}/api/connectors/oauth/callback/{connector}",
                f"{_REDIRECT_BASE_LOCAL}/api/connectors/oauth/callback/{connector}",
            ],
        }
    }


def get_auth_url(connector: str, via_production: bool = True) -> str:
    scopes = GMAIL_SCOPES if connector == "gmail" else GCAL_SCOPES
    base = _REDIRECT_BASE if via_production else _REDIRECT_BASE_LOCAL
    redirect_uri = f"{base}/api/connectors/oauth/callback/{connector}"

    flow = Flow.from_client_config(
        _client_config(connector),
        scopes=scopes,
        redirect_uri=redirect_uri,
    )
    url, _ = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        include_granted_scopes="true",
    )
    return url


def exchange_code(connector: str, code: str, via_production: bool = True) -> dict:
    """Exchange auth code for tokens. Returns dict to store in Connector.auth."""
    scopes = GMAIL_SCOPES if connector == "gmail" else GCAL_SCOPES
    base = _REDIRECT_BASE if via_production else _REDIRECT_BASE_LOCAL
    redirect_uri = f"{base}/api/connectors/oauth/callback/{connector}"

    flow = Flow.from_client_config(
        _client_config(connector),
        scopes=scopes,
        redirect_uri=redirect_uri,
    )
    flow.fetch_token(code=code)
    creds = flow.credentials

    return {
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or []),
    }


def credentials_from_auth(auth: dict) -> Optional[Credentials]:
    if not auth.get("refresh_token"):
        return None
    return Credentials(
        token=auth.get("token"),
        refresh_token=auth["refresh_token"],
        token_uri=auth.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=auth.get("client_id"),
        client_secret=auth.get("client_secret"),
        scopes=auth.get("scopes"),
    )
