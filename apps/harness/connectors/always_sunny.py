import httpx
from typing import Any, Dict, Optional


class AlwaysSunnyClient:
    """Thin HTTP client for the AlwaysSunny AI API."""

    def __init__(self, api_key: str, base_url: str = "http://76.13.191.149"):
        self.base_url = base_url.rstrip("/")
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

    def _get(self, path: str, params: Optional[Dict] = None) -> Any:
        with httpx.Client(timeout=15) as client:
            r = client.get(f"{self.base_url}{path}", headers=self._headers, params=params)
            r.raise_for_status()
            return r.json()

    def _post(self, path: str, body: Dict) -> Any:
        with httpx.Client(timeout=15) as client:
            r = client.post(f"{self.base_url}{path}", headers=self._headers, json=body)
            r.raise_for_status()
            return r.json()

    def get_context(self) -> Dict:
        """Full system context: solar, battery, Tesla state, active session, location."""
        return self._get("/api/ai/context")

    def command(self, action: str, params: Optional[Dict] = None) -> Dict:
        """Execute a control action: set_charging_amps | start_charging | stop_charging | update_settings."""
        return self._post("/api/ai/command", {"action": action, "params": params or {}})

    def get_sessions(self, limit: int = 10, offset: int = 0,
                     min_solar_pct: Optional[float] = None,
                     min_kwh: Optional[float] = None) -> Dict:
        """Fetch charging session history with optional filters."""
        params: Dict = {"limit": min(limit, 100), "offset": offset}
        if min_solar_pct is not None:
            params["min_solar_pct"] = min_solar_pct
        if min_kwh is not None:
            params["min_kwh"] = min_kwh
        return self._get("/api/ai/sessions", params=params)

    def submit_recommendation(self, amps: int, reasoning: str,
                               confidence: str = "medium",
                               trigger_reason: str = "ai_decision") -> Dict:
        return self._post("/api/ai/recommendation", {
            "recommended_amps": amps,
            "reasoning": reasoning,
            "confidence": confidence,
            "trigger_reason": trigger_reason,
        })

    def health(self) -> Dict:
        return self._get("/api/health")
