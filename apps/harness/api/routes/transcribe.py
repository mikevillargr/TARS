"""
Voice transcription via faster-whisper (self-hosted).

POST /transcribe
  Body: multipart/form-data, field "file" = audio blob (webm/mp4/wav/m4a/ogg)
  Returns: {"text": "transcribed text"}

The model is loaded once on first use and kept in memory (~500 MB for "small").
Model size is configured via WHISPER_MODEL env var (default: "small").
"""

import io
import logging
import tempfile
import os
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

from core.config import settings
from core.auth import require_auth

log = logging.getLogger(__name__)
router = APIRouter()

# ── Lazy singleton ─────────────────────────────────────────────────────────────
_model = None
_model_lock = Lock()


def _get_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        from faster_whisper import WhisperModel
        model_size = getattr(settings, "whisper_model", "small")
        log.info("Loading Whisper model '%s' (first use — this may take a moment)…", model_size)
        # cpu + int8 is plenty fast for short voice clips and uses ~500 MB RAM
        _model = WhisperModel(model_size, device="cpu", compute_type="int8")
        log.info("Whisper model loaded.")
    return _model


# ── Route ──────────────────────────────────────────────────────────────────────

@router.post("/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    user_id: str = Depends(require_auth),
):
    """
    Transcribe an audio recording to text.
    Accepts any format ffmpeg can decode: webm, mp4, m4a, wav, ogg, mp3.
    Returns {"text": "..."}.
    """
    audio_bytes = await file.read()
    if len(audio_bytes) < 100:
        raise HTTPException(status_code=400, detail="Audio too short or empty.")
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Audio too large (max 25 MB).")

    # Write to a temp file — faster-whisper needs a file path
    suffix = _ext_from_content_type(file.content_type or "audio/webm")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        model = _get_model()
        segments, info = model.transcribe(
            tmp_path,
            beam_size=5,
            language=None,          # auto-detect
            vad_filter=True,        # skip silent regions
            vad_parameters={"min_silence_duration_ms": 500},
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        log.info("Transcribed %.1fs of audio → %d chars", info.duration, len(text))
        return JSONResponse({"text": text, "language": info.language, "duration": round(info.duration, 1)})
    except Exception as exc:
        log.error("Transcription failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


def _ext_from_content_type(ct: str) -> str:
    mapping = {
        "audio/webm": ".webm",
        "audio/ogg": ".ogg",
        "audio/mp4": ".mp4",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/m4a": ".m4a",
    }
    for k, v in mapping.items():
        if k in ct:
            return v
    return ".webm"
