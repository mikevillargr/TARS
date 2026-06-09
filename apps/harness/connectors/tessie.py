import httpx
from typing import Any, Dict, List, Optional

TESSIE_BASE = "https://api.tessie.com"

# All valid command slugs supported by the Tessie API
VALID_COMMANDS = {
    "lock", "unlock",
    "activate_front_trunk", "activate_rear_trunk",
    "open_tonneau", "close_tonneau",
    "vent_windows", "close_windows",
    "start_climate", "stop_climate",
    "set_temperatures",
    "set_seat_heat", "set_seat_cool",
    "start_max_defrost", "stop_max_defrost",
    "start_steering_wheel_heater", "stop_steering_wheel_heater",
    "set_cabin_overheat_protection", "set_cop_temp",
    "set_bioweapon_mode", "set_climate_keeper_mode",
    "start_charging", "stop_charging",
    "set_charge_limit", "set_charging_amps",
    "open_charge_port", "close_charge_port",
    "flash", "honk",
    "trigger_homelink",
    "remote_start",
    "vent_sunroof", "close_sunroof",
    "enable_sentry", "disable_sentry",
    "enable_valet", "disable_valet",
    "enable_low_power_mode", "disable_low_power_mode",
    "enable_keep_accessory_power_mode", "disable_keep_accessory_power_mode",
}


class TessieClient:
    """HTTP client for the Tessie API (https://api.tessie.com)."""

    def __init__(self, api_key: str, vin: str):
        self.vin = vin
        self._headers = {
            "Authorization": f"Bearer {api_key}",
            "Accept": "application/json",
        }

    def _get(self, path: str, params: Optional[Dict] = None) -> Any:
        with httpx.Client(timeout=20) as client:
            r = client.get(f"{TESSIE_BASE}{path}", headers=self._headers, params=params)
            r.raise_for_status()
            return r.json()

    def _post(self, path: str, params: Optional[Dict] = None) -> Any:
        with httpx.Client(timeout=40) as client:
            r = client.post(f"{TESSIE_BASE}{path}", headers=self._headers, params=params)
            r.raise_for_status()
            return r.json()

    # ── Fleet ─────────────────────────────────────────────────────────────────

    def get_vehicles(self, only_active: bool = False) -> Dict:
        params: Dict = {}
        if only_active:
            params["only_active"] = "true"
        return self._get("/vehicles", params or None)

    # ── Vehicle state ─────────────────────────────────────────────────────────

    def get_state(self, use_cache: bool = True) -> Dict:
        return self._get(f"/{self.vin}/state", {"use_cache": str(use_cache).lower()})

    def get_status(self) -> Dict:
        """Lightweight online/asleep status check."""
        return self._get(f"/{self.vin}/status")

    def get_battery(self) -> Dict:
        return self._get(f"/{self.vin}/battery")

    def get_battery_health(self, from_ts: Optional[str] = None, to_ts: Optional[str] = None) -> Dict:
        params: Dict = {}
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts
        return self._get(f"/{self.vin}/battery_health", params or None)

    def get_location(self) -> Dict:
        return self._get(f"/{self.vin}/location")

    def get_firmware_alerts(self) -> Dict:
        return self._get(f"/{self.vin}/firmware_alerts")

    def get_consumption_since_charge(self) -> Dict:
        return self._get(f"/{self.vin}/consumption_since_charge")

    def get_weather(self) -> Dict:
        return self._get(f"/{self.vin}/weather")

    def get_tire_pressure(self, from_ts: Optional[str] = None, to_ts: Optional[str] = None) -> Dict:
        params: Dict = {}
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts
        return self._get(f"/{self.vin}/tire_pressure", params or None)

    # ── Historical data ───────────────────────────────────────────────────────

    def get_drives(
        self,
        limit: int = 10,
        from_ts: Optional[str] = None,
        to_ts: Optional[str] = None,
        timezone: str = "Asia/Manila",
        distance_format: str = "km",
    ) -> Dict:
        params: Dict = {"limit": min(limit, 200), "timezone": timezone, "distance_format": distance_format}
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts
        return self._get(f"/{self.vin}/drives", params)

    def get_charges(
        self,
        limit: int = 10,
        from_ts: Optional[str] = None,
        to_ts: Optional[str] = None,
        timezone: str = "Asia/Manila",
        superchargers_only: bool = False,
    ) -> Dict:
        params: Dict = {
            "limit": min(limit, 200),
            "timezone": timezone,
        }
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts
        if superchargers_only:
            params["superchargers_only"] = "true"
        return self._get(f"/{self.vin}/charges", params)

    def get_idles(
        self,
        limit: int = 10,
        from_ts: Optional[str] = None,
        to_ts: Optional[str] = None,
        timezone: str = "Asia/Manila",
    ) -> Dict:
        params: Dict = {"limit": min(limit, 200), "timezone": timezone}
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts
        return self._get(f"/{self.vin}/idles", params)

    def get_historical_states(
        self,
        from_ts: str,
        to_ts: str,
        interval: int = 300,
        timezone: str = "Asia/Manila",
    ) -> Dict:
        return self._get(f"/{self.vin}/states", {
            "from": from_ts,
            "to": to_ts,
            "interval": interval,
            "timezone": timezone,
        })

    def get_last_idle_state(self) -> Dict:
        return self._get(f"/{self.vin}/last_idle_state")

    def get_charging_invoices(
        self,
        from_ts: Optional[str] = None,
        to_ts: Optional[str] = None,
        timezone: str = "Asia/Manila",
    ) -> Dict:
        params: Dict = {"timezone": timezone}
        if from_ts:
            params["from"] = from_ts
        if to_ts:
            params["to"] = to_ts
        return self._get("/charging_invoices", params)

    # ── Commands ──────────────────────────────────────────────────────────────

    def wake(self) -> Dict:
        return self._post(f"/{self.vin}/wake")

    def command(self, cmd: str, extra_params: Optional[Dict] = None) -> Dict:
        """Execute any vehicle command.

        cmd must be one of the VALID_COMMANDS slugs.
        extra_params are appended as query params (e.g. temperature, amps, percent, seat, level).
        wait_for_completion is always set to true.
        """
        if cmd not in VALID_COMMANDS:
            raise ValueError(f"Unknown command: {cmd!r}. Valid: {sorted(VALID_COMMANDS)}")

        params: Dict = {"wait_for_completion": "true"}
        if extra_params:
            # Convert booleans to lowercase strings for query params
            for k, v in extra_params.items():
                params[k] = str(v).lower() if isinstance(v, bool) else v

        return self._post(f"/{self.vin}/command/{cmd}", params)

    # ── Map ───────────────────────────────────────────────────────────────────

    def get_map_url(self, width: int = 600, height: int = 400, zoom: int = 14) -> str:
        return (
            f"{TESSIE_BASE}/{self.vin}/map"
            f"?width={width}&height={height}&zoom={zoom}"
        )
