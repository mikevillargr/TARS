"""
Text-to-speech via kokoro-onnx (embedded in harness process).

POST /tts
  Body: {"text": "...", "voice": "af_bella", "speed": 1.0}
  Returns: audio/wav bytes

The ONNX model is loaded once on first use (~311MB, stored at KOKORO_MODEL_DIR).
Synthesis runs on CPU at ~200-400ms per sentence — no GPU needed.

Available voices include:
  American English: af_bella, af_heart, af_jessica, am_echo, am_michael
  British English:  bf_emma, bm_daniel, bm_fable
  (run /api/tts/voices for the full list)
"""

import asyncio
import io
import logging
from threading import Lock
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from core.auth import require_auth
from core.config import settings

log = logging.getLogger(__name__)
router = APIRouter()

# ── Lazy singleton ─────────────────────────────────────────────────────────────
_kokoro = None
_kokoro_lock = Lock()


def _get_kokoro():
    global _kokoro
    if _kokoro is not None:
        return _kokoro
    with _kokoro_lock:
        if _kokoro is not None:
            return _kokoro
        from kokoro_onnx import Kokoro
        model_dir = settings.kokoro_model_dir
        model_path  = f"{model_dir}/kokoro-v1.0.onnx"
        voices_path = f"{model_dir}/voices-v1.0.bin"
        log.info("Loading Kokoro ONNX model from %s…", model_path)
        _kokoro = Kokoro(model_path, voices_path)
        log.info("Kokoro TTS loaded — %d voices available.", len(_kokoro.voices))
    return _kokoro


# ── Request/response models ────────────────────────────────────────────────────

class TtsRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = 1.0


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/tts")
async def synthesize(
    req: TtsRequest,
    user_id: str = Depends(require_auth),
):
    """Synthesize text to WAV audio via Kokoro ONNX."""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 4000:
        raise HTTPException(status_code=400, detail="text too long (max 4000 chars)")

    voice = req.voice or settings.kokoro_voice
    speed = float(req.speed or 1.0)

    try:
        def _synth() -> bytes:
            import soundfile as sf
            kokoro = _get_kokoro()
            samples, sample_rate = kokoro.create(
                text, voice=voice, speed=speed, lang="en-us"
            )
            buf = io.BytesIO()
            sf.write(buf, samples, sample_rate, format="WAV")
            return buf.getvalue()

        # Run blocking CPU inference in thread pool — don't block the event loop
        loop = asyncio.get_event_loop()
        audio_bytes = await loop.run_in_executor(None, _synth)

        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    except FileNotFoundError as exc:
        log.error("Kokoro model files missing: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"TTS model files not found. Run: wget -P /opt/tars/models "
                   f"https://github.com/thewh1teagle/kokoro-onnx/releases/download/"
                   f"model-files-v1.0/kokoro-v1.0.onnx",
        )
    except AssertionError as exc:
        # Kokoro raises AssertionError for bad voice name or speed out of range
        raise HTTPException(status_code=400, detail=str(exc))
    except ImportError:
        log.error("kokoro-onnx not installed — run: pip install kokoro-onnx soundfile")
        raise HTTPException(status_code=503, detail="TTS not available: kokoro-onnx not installed")
    except Exception as exc:
        log.error("TTS synthesis failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"TTS failed: {exc}")


@router.get("/tts/voices")
async def list_voices(user_id: str = Depends(require_auth)):
    """List all available Kokoro voice names."""
    try:
        kokoro = _get_kokoro()
        return JSONResponse({"voices": sorted(kokoro.voices.tolist() if hasattr(kokoro.voices, "tolist") else list(kokoro.voices))})
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
