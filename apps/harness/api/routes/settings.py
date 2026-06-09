import os
import time
from pathlib import Path
from typing import Optional

import bcrypt
from dotenv import set_key as dotenv_set_key
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth, verify_password
from core.config import settings
from db.models import User
from db.session import get_db

router = APIRouter()

# Path to the .env file the harness reads (apps/harness/.env)
_ENV_PATH = Path(__file__).resolve().parents[2] / ".env"


def _set_env(key: str, value: str) -> None:
    """Persist a value to .env and update the live settings object in memory."""
    # quote_mode="never" prevents dotenv_set_key from wrapping values in single
    # quotes, which would make pydantic-settings read "'zai'" instead of "zai"
    dotenv_set_key(str(_ENV_PATH), key, value, quote_mode="never")
    object.__setattr__(settings, key, value)


def _mask(key: str, show: int = 6) -> str:
    if not key or len(key) <= show:
        return "•" * 8
    return "•" * (len(key) - show) + key[-show:]


# ─── User profile ─────────────────────────────────────────────────────────────

class SettingsOut(BaseModel):
    name: str
    timezone: str

    class Config:
        from_attributes = True


class SettingsUpdate(BaseModel):
    name: Optional[str] = None
    timezone: Optional[str] = None


@router.get("", response_model=SettingsOut)
async def get_settings(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return SettingsOut(name=user.name, timezone=user.timezone or "Asia/Manila")


@router.patch("", response_model=SettingsOut)
async def update_settings(
    body: SettingsUpdate,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    updates: dict = {}
    if body.name is not None:
        updates["name"] = body.name
    if body.timezone is not None:
        updates["timezone"] = body.timezone

    if updates:
        await db.execute(sa_update(User).where(User.id == user_id).values(**updates))
        await db.commit()

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    return SettingsOut(name=user.name, timezone=user.timezone or "Asia/Manila")


# ─── Change password ─────────────────────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    _user_id: str = Depends(require_auth),
):
    if not settings.tars_password_hash or not verify_password(body.current_password, settings.tars_password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    new_hash = bcrypt.hashpw(body.new_password.encode(), bcrypt.gensalt()).decode()
    _set_env("tars_password_hash", new_hash)
    return {"ok": True}


# ─── Model routing ────────────────────────────────────────────────────────────

class TierConfig(BaseModel):
    provider: str   # "anthropic" | "zai"
    model: str      # resolved effective model name


class ModelRoutingOut(BaseModel):
    tier1: TierConfig
    tier2: TierConfig
    tier3: TierConfig
    vision: TierConfig


class TierUpdate(BaseModel):
    provider: Optional[str] = None
    model_override: Optional[str] = None   # "" clears override → use provider default


class ModelRoutingUpdate(BaseModel):
    tier1: Optional[TierUpdate] = None
    tier2: Optional[TierUpdate] = None
    tier3: Optional[TierUpdate] = None
    vision: Optional[TierUpdate] = None


_PROVIDER_DEFAULTS = {
    ("anthropic", "tier1"):  "claude-haiku-4-5-20251001",
    ("anthropic", "tier2"):  "claude-sonnet-4-6",
    ("anthropic", "tier3"):  "claude-sonnet-4-6",
    ("anthropic", "vision"): "claude-sonnet-4-6",
    ("zai",       "tier1"):  "glm-4.5-air",
    ("zai",       "tier2"):  "glm-4.7",
    ("zai",       "tier3"):  "glm-5.1",
    ("zai",       "vision"): "glm-5v-turbo",  # OpenAI endpoint, now supported
}


def _resolved_provider(tier_key: str) -> str:
    if tier_key == "vision":
        p = settings.vision_provider
        if not p:
            return "anthropic" if settings.anthropic_api_key else settings.tier3_provider
        return p
    return getattr(settings, f"{tier_key}_provider", "anthropic")


def _resolved_model(tier_key: str) -> str:
    provider = _resolved_provider(tier_key)
    override = getattr(settings, f"{tier_key}_model_override", "")
    if override:
        return override
    return _PROVIDER_DEFAULTS.get((provider, tier_key), "claude-sonnet-4-6")


@router.get("/model-routing", response_model=ModelRoutingOut)
async def get_model_routing(_user_id: str = Depends(require_auth)):
    return ModelRoutingOut(
        tier1=TierConfig(provider=settings.tier1_provider,  model=_resolved_model("tier1")),
        tier2=TierConfig(provider=settings.tier2_provider,  model=_resolved_model("tier2")),
        tier3=TierConfig(provider=settings.tier3_provider,  model=_resolved_model("tier3")),
        vision=TierConfig(provider=_resolved_provider("vision"), model=_resolved_model("vision")),
    )


@router.patch("/model-routing", response_model=ModelRoutingOut)
async def update_model_routing(
    body: ModelRoutingUpdate,
    _user_id: str = Depends(require_auth),
):
    for tier_key in ("tier1", "tier2", "tier3", "vision"):
        update: Optional[TierUpdate] = getattr(body, tier_key, None)
        if update is None:
            continue
        if update.provider is not None:
            if update.provider not in ("anthropic", "zai"):
                raise HTTPException(status_code=400, detail="provider must be 'anthropic' or 'zai'")
            _set_env(f"{tier_key}_provider", update.provider)
        if update.model_override is not None:
            _set_env(f"{tier_key}_model_override", update.model_override)

    # Reset cached clients so new config is picked up immediately
    from core.model_client import get_model_client
    get_model_client().reset()

    return await get_model_routing(_user_id=_user_id)


# ─── API keys ─────────────────────────────────────────────────────────────────

class ApiKeysOut(BaseModel):
    anthropic: str     # masked
    zai: str           # masked
    runpod: str        # masked
    tavily: str        # masked
    fireflies: str     # masked
    github: str        # masked
    always_sunny: str  # masked


class ApiKeyUpdate(BaseModel):
    provider: str   # "anthropic" | "zai" | "runpod" | "tavily" | "fireflies" | "github"
    key: str


class ApiKeyTestRequest(BaseModel):
    provider: str   # "anthropic" | "zai"


class ApiKeyTestResult(BaseModel):
    ok: bool
    latency_ms: Optional[int] = None
    error: Optional[str] = None


@router.get("/api-keys", response_model=ApiKeysOut)
async def get_api_keys(_user_id: str = Depends(require_auth)):
    return ApiKeysOut(
        anthropic=_mask(settings.anthropic_api_key),
        zai=_mask(settings.zai_api_key),
        runpod=_mask(settings.runpod_api_key),
        tavily=_mask(settings.tavily_api_key),
        fireflies=_mask(settings.fireflies_api_key),
        github=_mask(settings.github_token),
        always_sunny=_mask(settings.always_sunny_api_key),
    )


@router.patch("/api-keys")
async def update_api_key(
    body: ApiKeyUpdate,
    _user_id: str = Depends(require_auth),
):
    env_map = {
        "anthropic":    "tars_anthropic_api_key",
        "zai":          "zai_api_key",
        "runpod":       "runpod_api_key",
        "tavily":       "tavily_api_key",
        "fireflies":    "fireflies_api_key",
        "github":       "github_token",
        "always_sunny": "always_sunny_api_key",
    }
    if body.provider not in env_map:
        raise HTTPException(status_code=400, detail="Unknown provider")

    _set_env(env_map[body.provider], body.key)
    if body.provider in ("anthropic", "zai", "runpod"):
        from core.model_client import get_model_client
        get_model_client().reset()

    return {"ok": True}


@router.post("/api-keys/test", response_model=ApiKeyTestResult)
async def test_api_key(
    body: ApiKeyTestRequest,
    _user_id: str = Depends(require_auth),
):
    import anthropic as _anthropic

    if body.provider == "anthropic":
        if not settings.anthropic_api_key:
            return ApiKeyTestResult(ok=False, error="No Anthropic key configured")
        client = _anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        model = "claude-haiku-4-5-20251001"
    elif body.provider == "zai":
        if not settings.zai_api_key:
            return ApiKeyTestResult(ok=False, error="No Z.ai key configured")
        # Test via OpenAI endpoint (glm-5.1) since that's what tier3 uses
        from openai import AsyncOpenAI
        t0 = time.monotonic()
        try:
            oai_client = AsyncOpenAI(
                api_key=settings.zai_api_key,
                base_url=settings.zai_openai_base_url,
            )
            await oai_client.chat.completions.create(
                model="glm-5.1",
                max_tokens=8,
                messages=[{"role": "user", "content": "Hi"}],
            )
            latency = int((time.monotonic() - t0) * 1000)
            return ApiKeyTestResult(ok=True, latency_ms=latency)
        except Exception as exc:
            return ApiKeyTestResult(ok=False, error=str(exc)[:200])
    else:
        raise HTTPException(status_code=400, detail="Provider must be 'anthropic' or 'zai'")

    t0 = time.monotonic()
    try:
        msg = await client.messages.create(
            model=model,
            max_tokens=8,
            messages=[{"role": "user", "content": "Hi"}],
        )
        latency = int((time.monotonic() - t0) * 1000)
        return ApiKeyTestResult(ok=True, latency_ms=latency)
    except Exception as exc:
        return ApiKeyTestResult(ok=False, error=str(exc)[:200])
