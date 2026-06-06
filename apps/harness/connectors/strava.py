"""Strava connector — OAuth2, httpx-native (no stravalib)."""

import time
import httpx
from typing import Optional

STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token"
STRAVA_AUTH_URL  = "https://www.strava.com/oauth/authorize"
STRAVA_API_BASE  = "https://www.strava.com/api/v3"

_SCOPES = "read,activity:read_all,profile:read_all"


def get_auth_url(client_id: str, redirect_uri: str) -> str:
    params = (
        f"client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&response_type=code"
        f"&approval_prompt=force"
        f"&scope={_SCOPES}"
    )
    return f"{STRAVA_AUTH_URL}?{params}"


async def exchange_code(client_id: str, client_secret: str, code: str) -> dict:
    async with httpx.AsyncClient() as http:
        r = await http.post(STRAVA_TOKEN_URL, data={
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
        })
        r.raise_for_status()
        data = r.json()
    return {
        "access_token":  data["access_token"],
        "refresh_token": data["refresh_token"],
        "expires_at":    data["expires_at"],
        "athlete_id":    data.get("athlete", {}).get("id"),
    }


class StravaClient:
    def __init__(self, auth: dict, client_id: str, client_secret: str):
        self._auth          = auth
        self._client_id     = client_id
        self._client_secret = client_secret

    def needs_refresh(self) -> bool:
        return time.time() >= self._auth.get("expires_at", 0) - 300

    async def refresh_token(self) -> dict:
        async with httpx.AsyncClient() as http:
            r = await http.post(STRAVA_TOKEN_URL, data={
                "client_id":     self._client_id,
                "client_secret": self._client_secret,
                "grant_type":    "refresh_token",
                "refresh_token": self._auth["refresh_token"],
            })
            r.raise_for_status()
            data = r.json()
        self._auth.update({
            "access_token":  data["access_token"],
            "refresh_token": data["refresh_token"],
            "expires_at":    data["expires_at"],
        })
        return self._auth

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._auth['access_token']}"}

    async def list_activities(self, limit: int = 20) -> list:
        async with httpx.AsyncClient() as http:
            r = await http.get(
                f"{STRAVA_API_BASE}/athlete/activities",
                headers=self._headers(),
                params={"per_page": limit},
            )
            r.raise_for_status()
            activities = r.json()

        return [
            {
                "id":           a["id"],
                "name":         a.get("name"),
                "sport_type":   a.get("sport_type") or a.get("type"),
                "distance_km":  round(a.get("distance", 0) / 1000, 2),
                "duration_sec": a.get("moving_time", 0),
                "duration":     _fmt_duration(a.get("moving_time", 0)),
                "elevation_m":  a.get("total_elevation_gain"),
                "avg_hr":       a.get("average_heartrate"),
                "max_hr":       a.get("max_heartrate"),
                "avg_watts":    a.get("average_watts"),
                "avg_speed_kph": round(a.get("average_speed", 0) * 3.6, 2),
                "start_date":   a.get("start_date"),
                "suffer_score": a.get("suffer_score"),
                "kudos":        a.get("kudos_count", 0),
                "pr_count":     a.get("pr_count", 0),
            }
            for a in activities
        ]

    async def get_activity(self, activity_id: int) -> dict:
        async with httpx.AsyncClient() as http:
            r = await http.get(
                f"{STRAVA_API_BASE}/activities/{activity_id}",
                headers=self._headers(),
            )
            r.raise_for_status()
            a = r.json()
        return {
            "id":               a["id"],
            "name":             a.get("name"),
            "description":      a.get("description"),
            "sport_type":       a.get("sport_type") or a.get("type"),
            "distance_km":      round(a.get("distance", 0) / 1000, 2),
            "duration_sec":     a.get("moving_time"),
            "duration":         _fmt_duration(a.get("moving_time", 0)),
            "elevation_m":      a.get("total_elevation_gain"),
            "avg_hr":           a.get("average_heartrate"),
            "max_hr":           a.get("max_heartrate"),
            "avg_watts":        a.get("average_watts"),
            "normalized_watts": a.get("weighted_average_watts"),
            "avg_cadence":      a.get("average_cadence"),
            "avg_speed_kph":    round(a.get("average_speed", 0) * 3.6, 2),
            "calories":         a.get("calories"),
            "device_name":      a.get("device_name"),
            "start_date":       a.get("start_date"),
        }

    async def get_athlete_stats(self) -> dict:
        async with httpx.AsyncClient() as http:
            r = await http.get(f"{STRAVA_API_BASE}/athlete", headers=self._headers())
            r.raise_for_status()
            athlete_id = r.json()["id"]

            r = await http.get(
                f"{STRAVA_API_BASE}/athletes/{athlete_id}/stats",
                headers=self._headers(),
            )
            r.raise_for_status()
            s = r.json()

        def _t(t: dict) -> dict:
            return {
                "count":           t.get("count", 0),
                "distance_km":     round(t.get("distance", 0) / 1000, 2),
                "moving_time_sec": t.get("moving_time", 0),
                "elevation_m":     round(t.get("elevation_gain", 0), 1),
            }

        return {
            "recent_ride_totals": _t(s.get("recent_ride_totals", {})),
            "ytd_ride_totals":    _t(s.get("ytd_ride_totals", {})),
            "all_ride_totals":    _t(s.get("all_ride_totals", {})),
            "recent_run_totals":  _t(s.get("recent_run_totals", {})),
            "ytd_run_totals":     _t(s.get("ytd_run_totals", {})),
        }

    async def get_athlete_zones(self) -> dict:
        async with httpx.AsyncClient() as http:
            r = await http.get(
                f"{STRAVA_API_BASE}/athlete/zones",
                headers=self._headers(),
            )
            r.raise_for_status()
            return r.json()


def _fmt_duration(seconds: int) -> str:
    h, rem = divmod(int(seconds or 0), 3600)
    m, s = divmod(rem, 60)
    return f"{h}h {m:02d}m" if h else f"{m}m {s:02d}s"
