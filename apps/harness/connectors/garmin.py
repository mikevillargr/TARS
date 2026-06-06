"""Garmin Connect connector — uses garth (unofficial API)."""

import asyncio
import logging
from datetime import date, timedelta
from typing import Optional

log = logging.getLogger(__name__)


class GarminClient:
    def __init__(self, config: dict):
        self._config = config

    # ── Auth ──────────────────────────────────────────────────────────────────

    @staticmethod
    async def login(email: str, password: str) -> str:
        """Authenticate and return serialised token string for DB storage."""
        def _do():
            import garth
            client = garth.Client()
            client.login(email, password)
            return client.dumps()

        return await asyncio.to_thread(_do)

    def _client(self):
        import garth
        tokens = self._config.get("garth_tokens")
        if not tokens:
            raise ValueError("Garmin not authenticated — connect first")
        c = garth.Client()
        c.loads(tokens)
        return c

    # ── API ───────────────────────────────────────────────────────────────────

    async def get_activities(self, limit: int = 20) -> list:
        def _fetch():
            c = self._client()
            return c.connectapi(
                "/activitylist-service/activities/search/activities",
                params={"limit": limit, "start": 0},
            )

        activities = await asyncio.to_thread(_fetch) or []
        return [
            {
                "id":           a.get("activityId"),
                "name":         a.get("activityName"),
                "sport_type":   a.get("activityType", {}).get("typeKey"),
                "start_date":   a.get("startTimeLocal"),
                "duration_sec": a.get("duration"),
                "distance_km":  round(a["distance"] / 1000, 2) if a.get("distance") else None,
                "elevation_m":  a.get("elevationGain"),
                "avg_hr":       a.get("averageHR"),
                "max_hr":       a.get("maxHR"),
                "calories":     a.get("calories"),
            }
            for a in activities
        ]

    async def get_sleep(self, target_date: Optional[date] = None) -> dict:
        if target_date is None:
            target_date = date.today() - timedelta(days=1)
        date_str = target_date.strftime("%Y-%m-%d")

        def _fetch():
            c = self._client()
            profile = c.connectapi("/userprofile-service/userprofile/user-settings")
            display_name = profile.get("userData", {}).get("displayName", "me")
            return c.connectapi(
                f"/wellness-service/wellness/dailySleepData/{display_name}",
                params={"date": date_str, "nonSleepBufferMinutes": 60},
            )

        data = await asyncio.to_thread(_fetch)
        sleep = (data or {}).get("dailySleepDTO", {})
        return {
            "date":           date_str,
            "sleep_score":    sleep.get("sleepScores", {}).get("overall", {}).get("value"),
            "duration_sec":   sleep.get("sleepTimeSeconds"),
            "deep_sleep_sec": sleep.get("deepSleepSeconds"),
            "light_sleep_sec": sleep.get("lightSleepSeconds"),
            "rem_sleep_sec":  sleep.get("remSleepSeconds"),
            "awake_sec":      sleep.get("awakeSleepSeconds"),
            "avg_respiration": sleep.get("averageRespirationValue"),
            "avg_spo2":       sleep.get("averageSpO2Value"),
        }

    async def get_hrv(self, target_date: Optional[date] = None) -> dict:
        if target_date is None:
            target_date = date.today()
        date_str = target_date.strftime("%Y-%m-%d")

        def _fetch():
            c = self._client()
            return c.connectapi(f"/hrv-service/hrv/{date_str}")

        data = await asyncio.to_thread(_fetch) or {}
        summary = data.get("hrvSummary", {})
        return {
            "date":             date_str,
            "status":           summary.get("status"),
            "last_night_avg":   summary.get("lastNight"),
            "last_5_night_avg": summary.get("lastNightFive"),
            "baseline_low":     summary.get("baselineLowUpper"),
            "baseline_high":    summary.get("baselineBalancedLower"),
        }

    async def get_body_battery(self, target_date: Optional[date] = None) -> dict:
        if target_date is None:
            target_date = date.today()
        date_str = target_date.strftime("%Y-%m-%d")

        def _fetch():
            c = self._client()
            profile = c.connectapi("/userprofile-service/userprofile/user-settings")
            display_name = profile.get("userData", {}).get("displayName", "me")
            return c.connectapi(
                f"/wellness-service/wellness/bodyBattery/valuesForDay/{display_name}",
                params={"date": date_str},
            )

        values = await asyncio.to_thread(_fetch) or []
        levels = [v["value"] for v in values if v.get("value") is not None]
        return {
            "date":    date_str,
            "current": values[-1].get("value") if values else None,
            "min":     min(levels) if levels else None,
            "max":     max(levels) if levels else None,
        }
