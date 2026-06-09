"""
Tesla / Tessie API route.
Exposes vehicle state, history, and commands to the TARS frontend.
All endpoints require auth and delegate to TessieClient.
"""
import asyncio
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from core.auth import require_auth
from core.config import settings
from connectors.tessie import TessieClient, VALID_COMMANDS

router = APIRouter()


def _client() -> TessieClient:
    if not settings.tessie_api_key:
        raise HTTPException(status_code=503, detail="Tessie API key not configured. Add it in Settings → API Keys.")
    if not settings.tessie_vin:
        raise HTTPException(status_code=503, detail="Tessie VIN not configured. Add it in Settings → API Keys.")
    return TessieClient(settings.tessie_api_key, settings.tessie_vin)


async def _run(fn, *args, **kwargs) -> Any:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))


# ── State & status ─────────────────────────────────────────────────────────────

@router.get("/state")
async def get_state(
    use_cache: bool = Query(True),
    _user_id: str = Depends(require_auth),
):
    client = _client()
    return await _run(client.get_state, use_cache)


@router.get("/status")
async def get_status(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.get_status)


@router.get("/battery")
async def get_battery(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.get_battery)


@router.get("/battery-health")
async def get_battery_health(
    from_ts: Optional[str] = Query(None, alias="from"),
    to_ts: Optional[str] = Query(None, alias="to"),
    _user_id: str = Depends(require_auth),
):
    client = _client()
    return await _run(client.get_battery_health, from_ts, to_ts)


@router.get("/location")
async def get_location(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.get_location)


@router.get("/weather")
async def get_weather(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.get_weather)


@router.get("/tire-pressure")
async def get_tire_pressure(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.get_tire_pressure)


@router.get("/consumption")
async def get_consumption(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.get_consumption_since_charge)


@router.get("/firmware-alerts")
async def get_firmware_alerts(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.get_firmware_alerts)


# ── History ────────────────────────────────────────────────────────────────────

@router.get("/drives")
async def get_drives(
    limit: int = Query(10, ge=1, le=200),
    from_ts: Optional[str] = Query(None, alias="from"),
    to_ts: Optional[str] = Query(None, alias="to"),
    _user_id: str = Depends(require_auth),
):
    client = _client()
    return await _run(client.get_drives, limit, from_ts, to_ts)


@router.get("/charges")
async def get_charges(
    limit: int = Query(10, ge=1, le=200),
    from_ts: Optional[str] = Query(None, alias="from"),
    to_ts: Optional[str] = Query(None, alias="to"),
    superchargers_only: bool = Query(False),
    _user_id: str = Depends(require_auth),
):
    client = _client()
    return await _run(client.get_charges, limit, from_ts, to_ts, "Asia/Manila", superchargers_only)


@router.get("/idles")
async def get_idles(
    limit: int = Query(10, ge=1, le=200),
    from_ts: Optional[str] = Query(None, alias="from"),
    to_ts: Optional[str] = Query(None, alias="to"),
    _user_id: str = Depends(require_auth),
):
    client = _client()
    return await _run(client.get_idles, limit, from_ts, to_ts)


@router.get("/charging-invoices")
async def get_charging_invoices(
    from_ts: Optional[str] = Query(None, alias="from"),
    to_ts: Optional[str] = Query(None, alias="to"),
    _user_id: str = Depends(require_auth),
):
    client = _client()
    return await _run(client.get_charging_invoices, from_ts, to_ts)


# ── Commands ───────────────────────────────────────────────────────────────────

class CommandRequest(BaseModel):
    params: Optional[Dict[str, Any]] = None


@router.post("/wake")
async def wake_vehicle(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.wake)


@router.post("/command/{cmd}")
async def run_command(
    cmd: str,
    body: CommandRequest = CommandRequest(),
    _user_id: str = Depends(require_auth),
):
    if cmd not in VALID_COMMANDS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown command '{cmd}'. Valid commands: {sorted(VALID_COMMANDS)}",
        )
    client = _client()
    return await _run(client.command, cmd, body.params)


# ── Meta ───────────────────────────────────────────────────────────────────────

@router.get("/vehicles")
async def list_vehicles(_user_id: str = Depends(require_auth)):
    client = _client()
    return await _run(client.get_vehicles)


@router.get("/commands")
async def list_commands(_user_id: str = Depends(require_auth)):
    return {"commands": sorted(VALID_COMMANDS)}
