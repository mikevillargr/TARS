"""
Shared Google OAuth2 helpers for Gmail and Google Calendar.
Uses direct HTTP calls to avoid google_auth_oauthlib auto-adding PKCE,
which breaks when auth URL and token exchange happen in separate requests.
"""

import logging
import urllib.parse
from typing import Optional

import httpx
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

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
_TOKEN_URI = "https://oauth2.googleapis.com/token"
_AUTH_URI = "https://accounts.google.com/o/oauth2/auth"


def _client_id(connector: str) -> str:
    return settings.gmail_client_id if connector == "gmail" else settings.gcal_client_id


def _client_secret(connector: str) -> str:
    return settings.gmail_client_secret if connector == "gmail" else settings.gcal_client_secret


def _redirect_uri(connector: str, via_production: bool) -> str:
    base = _REDIRECT_BASE if via_production else _REDIRECT_BASE_LOCAL
    return f"{base}/api/connectors/oauth/callback/{connector}"


def get_auth_url(connector: str, via_production: bool = True) -> str:
    """Build Google auth URL without PKCE so token exchange works across requests."""
    scopes = GMAIL_SCOPES if connector == "gmail" else GCAL_SCOPES
    params = {
        "response_type": "code",
        "client_id": _client_id(connector),
        "redirect_uri": _redirect_uri(connector, via_production),
        "scope": " ".join(scopes),
        "access_type": "offline",
        "prompt": "consent",
    }
    return f"{_AUTH_URI}?{urllib.parse.urlencode(params)}"


async def exchange_code(connector: str, code: str, via_production: bool = True) -> dict:
    """Exchange auth code for tokens via direct HTTP — no PKCE."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(_TOKEN_URI, data={
            "code": code,
            "client_id": _client_id(connector),
            "client_secret": _client_secret(connector),
            "redirect_uri": _redirect_uri(connector, via_production),
            "grant_type": "authorization_code",
        })
        resp.raise_for_status()
        data = resp.json()

    scopes = GMAIL_SCOPES if connector == "gmail" else GCAL_SCOPES
    return {
        "token": data.get("access_token"),
        "refresh_token": data.get("refresh_token"),
        "token_uri": _TOKEN_URI,
        "client_id": _client_id(connector),
        "client_secret": _client_secret(connector),
        "scopes": scopes,
    }


def credentials_from_auth(auth: dict) -> Optional[Credentials]:
    if not auth.get("refresh_token"):
        return None
    creds = Credentials(
        token=auth.get("token"),
        refresh_token=auth["refresh_token"],
        token_uri=auth.get("token_uri", _TOKEN_URI),
        client_id=auth.get("client_id"),
        client_secret=auth.get("client_secret"),
        scopes=auth.get("scopes"),
    )
    if creds.expired:
        creds.refresh(Request())
    return creds
