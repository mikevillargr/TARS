"""
Text-to-speech via Kokoro-FastAPI (remsky/Kokoro-FastAPI).

POST /tts
  Body: {"text": "...", "voice": "af_bella", "speed": 1.0}
  Returns: audio/wav bytes

The Kokoro container exposes an OpenAI-compatible /v1/audio/speech endpoint.
This route is a thin authenticated proxy so the browser never talks to Kokoro directly.

If Kokoro is unreachable (container cold/down), returns 503 and the frontend
stays silent — voice playback is best-effort, not critical path.
"""

import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from core.auth import require_auth
from core.config import settings

log = logging.getLogger(__name__)
router = APIRouter()


class TtsRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = 1.0


@router.post("/tts")
async def synthesize(
    req: TtsRequest,
    user_id: str = Depends(require_auth),
):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 4000:
        raise HTTPException(status_code=400, detail="text too long (max 4000 chars)")

    voice = req.voice or settings.kokoro_voice
    payload = {
        "model": "kokoro",
        "input": text,
        "voice": voice,
        "response_format": "wav",
        "speed": req.speed or 1.0,
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{settings.kokoro_url}/v1/audio/speech",
                json=payload,
            )
        if res.status_code != 200:
            log.warning("Kokoro returned %s: %s", res.status_code, res.text[:200])
            raise HTTPException(status_code=503, detail="TTS service unavailable")

        return Response(
            content=res.content,
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    except httpx.ConnectError:
        log.warning("Kokoro TTS unreachable at %s", settings.kokoro_url)
        raise HTTPException(status_code=503, detail="TTS service not running")
    except httpx.TimeoutException:
        log.warning("Kokoro TTS timed out")
        raise HTTPException(status_code=503, detail="TTS service timed out")
