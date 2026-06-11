"""
Text-to-speech via kokoro-onnx (embedded in harness process).

POST /tts
  Body: {"text": "...", "voice": "af_bella", "speed": 1.0}
  Returns: audio/wav bytes

GET /tts/voices
  Returns: {"voices": [...]}

Text is pre-processed before synthesis:
  - Markdown stripped (bold, italics, code blocks, links, headings, bullets)
  - ISO dates (2024-06-11) → "June eleventh, twenty twenty-four"
  - 24-hour times (14:30) → "two thirty PM"
"""

import asyncio
import io
import logging
import re
from datetime import datetime
from threading import Lock
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from core.config import settings
from db.models import User
from db.session import get_db

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
        model_dir   = settings.kokoro_model_dir
        model_path  = f"{model_dir}/kokoro-v1.0.onnx"
        voices_path = f"{model_dir}/voices-v1.0.bin"
        log.info("Loading Kokoro ONNX model from %s…", model_path)
        _kokoro = Kokoro(model_path, voices_path)
        voice_count = len(_kokoro.voices.files) if hasattr(_kokoro.voices, "files") else "?"
        log.info("Kokoro TTS loaded — %s voices available.", voice_count)
    return _kokoro


# ── Text preprocessing ─────────────────────────────────────────────────────────

_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

_ORDINALS = {
    1: "first", 2: "second", 3: "third", 4: "fourth", 5: "fifth",
    6: "sixth", 7: "seventh", 8: "eighth", 9: "ninth", 10: "tenth",
    11: "eleventh", 12: "twelfth", 13: "thirteenth", 14: "fourteenth",
    15: "fifteenth", 16: "sixteenth", 17: "seventeenth", 18: "eighteenth",
    19: "nineteenth", 20: "twentieth", 21: "twenty-first", 22: "twenty-second",
    23: "twenty-third", 24: "twenty-fourth", 25: "twenty-fifth", 26: "twenty-sixth",
    27: "twenty-seventh", 28: "twenty-eighth", 29: "twenty-ninth", 30: "thirtieth",
    31: "thirty-first",
}

_ONES = ["", "one", "two", "three", "four", "five",
         "six", "seven", "eight", "nine"]
_TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen",
          "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty",
         "sixty", "seventy", "eighty", "ninety"]


def _year_spoken(year: int) -> str:
    if 2000 <= year <= 2009:
        return "two thousand" if year == 2000 else f"two thousand {_ONES[year - 2000]}"
    if 2010 <= year <= 2019:
        return f"twenty {_TEENS[year - 2010]}"
    if 2020 <= year <= 2099:
        rest = year - 2000
        tens_d, ones_d = rest // 10, rest % 10
        base = f"twenty {_TENS[tens_d]}"
        return base if ones_d == 0 else f"{base}-{_ONES[ones_d]}"
    return str(year)


def _time_spoken(h: int, m: int) -> str:
    ampm = "AM" if h < 12 else "PM"
    h12  = h % 12 or 12
    if m == 0:
        if h == 0:  return "midnight"
        if h == 12: return "noon"
        return f"{h12} {ampm}"
    if m < 10:
        return f"{h12} oh {m} {ampm}"
    return f"{h12} {m} {ampm}"


def _int_to_words(n: int) -> str:
    """Convert a non-negative integer to English words."""
    _B20 = [
        "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
        "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
        "seventeen", "eighteen", "nineteen",
    ]
    _T = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

    def _u1000(x: int) -> str:
        if x == 0:     return ""
        if x < 20:     return _B20[x]
        if x < 100:
            t, o = divmod(x, 10)
            return _T[t] + ("-" + _B20[o] if o else "")
        h, r = divmod(x, 100)
        return _B20[h] + " hundred" + (" " + _u1000(r) if r else "")

    if n == 0:
        return "zero"
    parts: list[str] = []
    for val, name in [(1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand")]:
        if n >= val:
            chunk, n = divmod(n, val)
            parts.append(_u1000(chunk) + " " + name)
    if n:
        parts.append(_u1000(n))
    return " ".join(parts)


def _strip_markdown(text: str) -> str:
    # Fenced code blocks — remove entirely
    text = re.sub(r"```[^\n]*\n[\s\S]*?```", "", text, flags=re.MULTILINE)
    # Inline code — keep text, drop backticks
    text = re.sub(r"`([^`]+)`", r"\1", text)
    # Markdown images
    text = re.sub(r"!\[[^\]]*\]\([^\)]*\)", "", text)
    # Markdown links — keep link text
    text = re.sub(r"\[([^\]]+)\]\([^\)]*\)", r"\1", text)
    # ATX headings
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    # Bold / bold-italic
    text = re.sub(r"\*{2,3}([^\*]+)\*{2,3}", r"\1", text)
    text = re.sub(r"_{2,3}([^_]+)_{2,3}", r"\1", text)
    # Italic
    text = re.sub(r"\*([^\*\s][^\*]*[^\*\s])\*|\*([^\*\s])\*", lambda m: m.group(1) or m.group(2), text)
    text = re.sub(r"(?<![a-zA-Z0-9])\*(?![a-zA-Z0-9])", "", text)
    # Blockquotes
    text = re.sub(r"^>\s*", "", text, flags=re.MULTILINE)
    # Horizontal rules
    text = re.sub(r"^[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    # Unordered list bullets
    text = re.sub(r"^[ \t]*[-*+]\s+", "", text, flags=re.MULTILINE)
    # Ordered list numbers
    text = re.sub(r"^[ \t]*\d+\.\s+", "", text, flags=re.MULTILINE)
    # Inline HTML tags
    text = re.sub(r"<[^>]+>", "", text)
    # Common HTML entities
    for ent, word in [("&amp;", "and"), ("&lt;", "less than"), ("&gt;", "greater than"), ("&nbsp;", " ")]:
        text = text.replace(ent, word)
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"  +", " ", text)
    return text.strip()


def _normalize_dates(text: str) -> str:
    # ISO datetime: 2024-06-11T14:30:00
    def _iso_dt(m: re.Match) -> str:
        raw = m.group()
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
            try:
                dt = datetime.strptime(raw[:16] if fmt == "%Y-%m-%dT%H:%M" else raw[:19], fmt)
                return (
                    f"{_MONTHS[dt.month - 1]} {_ORDINALS[dt.day]}, "
                    f"{_year_spoken(dt.year)} at {_time_spoken(dt.hour, dt.minute)}"
                )
            except ValueError:
                pass
        return raw
    text = re.sub(
        r"\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?\b",
        _iso_dt, text,
    )

    # ISO date: 2024-06-11
    def _iso_date(m: re.Match) -> str:
        try:
            dt = datetime.strptime(m.group(), "%Y-%m-%d")
            return f"{_MONTHS[dt.month - 1]} {_ORDINALS[dt.day]}, {_year_spoken(dt.year)}"
        except ValueError:
            return m.group()
    text = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", _iso_date, text)

    # 24-hour time: 14:30
    def _time_24h(m: re.Match) -> str:
        h, mins = int(m.group(1)), int(m.group(2))
        if h > 23 or mins > 59:
            return m.group()
        return _time_spoken(h, mins)
    text = re.sub(r"\b([01]?\d|2[0-3]):([0-5]\d)\b", _time_24h, text)
    return text


def _normalize_text(text: str) -> str:
    """Normalize numbers, symbols, abbreviations, and punctuation for natural speech."""

    # URLs → "link"
    text = re.sub(r"https?://\S+", "link", text)
    text = re.sub(r"\bwww\.\S+\.\S+", "link", text)

    # Email addresses → "email"
    text = re.sub(r"\b[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}\b", "email", text)

    # Ellipsis → brief pause
    text = text.replace("…", ", ")
    text = re.sub(r"\.{2,}", ", ", text)

    # Em dash / en dash → natural pause
    text = re.sub(r"\s*[—–]\s*", ", ", text)

    # Currency: $100, $1,500.50, ₱500, €50, £30
    _CURR = {"$": "dollars", "₱": "pesos", "€": "euros", "£": "pounds"}
    def _currency(m: re.Match) -> str:
        sym, num_str = m.group(1), m.group(2).replace(",", "")
        try:
            int_part, _, dec_part = num_str.partition(".")
            words = _int_to_words(int(int_part))
            if dec_part.rstrip("0"):
                words += " point " + " ".join(dec_part.rstrip("0"))
            unit = _CURR.get(sym, "")
            return (words + (" " + unit if unit else "")).strip()
        except ValueError:
            return m.group()
    text = re.sub(r"([$₱€£])([\d,]+(?:\.\d{1,2})?)", _currency, text)

    # Percentages: 75% → "seventy-five percent", 3.5% → "three point five percent"
    def _percent(m: re.Match) -> str:
        num = m.group(1)
        try:
            if "." in num:
                i, d = num.split(".", 1)
                return _int_to_words(int(i)) + " point " + " ".join(d) + " percent"
            return _int_to_words(int(num)) + " percent"
        except ValueError:
            return m.group()
    text = re.sub(r"\b(\d+(?:\.\d+)?)%", _percent, text)

    # Ordinals: 1st, 2nd, 3rd … 31st
    _ORD = {
        "1st": "first", "2nd": "second", "3rd": "third", "4th": "fourth",
        "5th": "fifth", "6th": "sixth", "7th": "seventh", "8th": "eighth",
        "9th": "ninth", "10th": "tenth", "11th": "eleventh", "12th": "twelfth",
        "13th": "thirteenth", "14th": "fourteenth", "15th": "fifteenth",
        "16th": "sixteenth", "17th": "seventeenth", "18th": "eighteenth",
        "19th": "nineteenth", "20th": "twentieth", "21st": "twenty-first",
        "22nd": "twenty-second", "23rd": "twenty-third", "24th": "twenty-fourth",
        "25th": "twenty-fifth", "26th": "twenty-sixth", "27th": "twenty-seventh",
        "28th": "twenty-eighth", "29th": "twenty-ninth", "30th": "thirtieth",
        "31st": "thirty-first",
    }
    text = re.sub(
        r"\b(\d{1,2}(?:st|nd|rd|th))\b",
        lambda m: _ORD.get(m.group().lower(), m.group()),
        text, flags=re.IGNORECASE,
    )

    # Size/measurement units attached to numbers: 100MB, 5km, 200ms
    _UNITS = {
        "kb": "kilobytes", "mb": "megabytes", "gb": "gigabytes", "tb": "terabytes",
        "ms": "milliseconds", "km": "kilometers", "kg": "kilograms",
        "mph": "miles per hour", "kph": "kilometers per hour",
    }
    def _unit_match(m: re.Match) -> str:
        try:
            return _int_to_words(int(m.group(1))) + " " + _UNITS.get(m.group(2).lower(), m.group(2))
        except ValueError:
            return m.group()
    text = re.sub(r"\b(\d+)\s*(KB|MB|GB|TB|kb|mb|gb|tb|ms|km|kg|mph|kph)\b", _unit_match, text)

    # Version strings: v1.0, v2.3.1 → "version 1.0" (leave digits for Kokoro to read naturally)
    text = re.sub(r"\bv(\d+(?:\.\d+)+)\b", lambda m: "version " + m.group(1), text, flags=re.IGNORECASE)

    # Strip thousand separators before integer conversion: 1,000 → 1000
    text = re.sub(r"\b(\d{1,3}(?:,\d{3})+)\b", lambda m: m.group().replace(",", ""), text)

    # Large integers (4+ digits) → words
    def _large_int(m: re.Match) -> str:
        n = int(m.group())
        return _int_to_words(n) if n <= 999_999_999_999 else m.group()
    text = re.sub(r"\b(\d{4,})\b", _large_int, text)

    # Common abbreviations
    for pat, rep in [
        (r"\be\.g\.",      "for example"),
        (r"\bi\.e\.",      "that is"),
        (r"\betc\.",       "et cetera"),
        (r"\bvs\.",        "versus"),
        (r"\bapprox\.",    "approximately"),
        (r"\bDr\.",        "Doctor"),
        (r"\bMr\.",        "Mister"),
        (r"\bMrs\.",       "Missus"),
        (r"\bMs\.",        "Miss"),
        (r"\bJr\.",        "Junior"),
        (r"\bSr\.",        "Senior"),
        (r"\bNo\.\s*(\d+)", lambda mx: "number " + mx.group(1)),
    ]:
        if callable(rep):
            text = re.sub(pat, rep, text, flags=re.IGNORECASE)
        else:
            text = re.sub(pat, rep, text, flags=re.IGNORECASE)

    # Symbols
    text = re.sub(r"\s*&\s*",          " and ",    text)   # & → and
    text = re.sub(r"#(\d+)",           lambda m: "number " + m.group(1), text)  # #5 → number 5
    text = re.sub(r"(\w)\s*/\s*(\w)",  r"\1 or \2", text)  # pass/fail → pass or fail
    text = re.sub(r"\s\+\s",           " plus ",   text)   # n + m (spaced) → plus

    # Collapse whitespace
    text = re.sub(r"  +", " ", text)
    return text


def _prepare_text(text: str) -> str:
    text = _strip_markdown(text)
    text = _normalize_dates(text)
    text = _normalize_text(text)
    return text.strip()


# ── Voice → espeak language code mapping ──────────────────────────────────────

_VOICE_LANG: dict[str, str] = {
    "af": "en-us", "am": "en-us",   # American English
    "bf": "en-gb", "bm": "en-gb",   # British English
    "ef": "es",    "em": "es",       # Spanish
    "ff": "fr-fr",                   # French
    "hf": "hi",    "hm": "hi",       # Hindi
    "if": "it",    "im": "it",       # Italian
    "jf": "ja",    "jm": "ja",       # Japanese
    "pf": "pt-br", "pm": "pt-br",   # Portuguese
    "zf": "zh",    "zm": "zh",       # Chinese
}


def _lang_for_voice(voice: str) -> str:
    return _VOICE_LANG.get(voice[:2], "en-us")


# ── Request model ──────────────────────────────────────────────────────────────

class TtsRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    speed: Optional[float] = 1.0


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.post("/tts")
async def synthesize(
    req: TtsRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Synthesize text to WAV audio via Kokoro ONNX."""
    text = _prepare_text(req.text)
    if not text:
        raise HTTPException(status_code=400, detail="text is required")
    if len(text) > 4000:
        raise HTTPException(status_code=400, detail="text too long (max 4000 chars)")

    # Voice priority: request body → user's saved preference → env default
    if req.voice:
        voice = req.voice
        source = "request"
    else:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        prefs = (user.preferences or {}) if user else {}
        voice = prefs.get("tts_voice") or settings.kokoro_voice
        source = "saved" if prefs.get("tts_voice") else "default"

    speed = float(req.speed or 1.0)
    lang  = _lang_for_voice(voice)
    log.info("TTS: voice=%s (%s) lang=%s speed=%s", voice, source, lang, speed)

    try:
        def _synth() -> bytes:
            import soundfile as sf
            kokoro  = _get_kokoro()
            samples, sample_rate = kokoro.create(
                text, voice=voice, speed=speed, lang=lang
            )
            buf = io.BytesIO()
            sf.write(buf, samples, sample_rate, format="WAV")
            return buf.getvalue()

        loop       = asyncio.get_event_loop()
        audio_bytes = await loop.run_in_executor(None, _synth)

        return Response(
            content=audio_bytes,
            media_type="audio/wav",
            headers={"Cache-Control": "no-store"},
        )

    except FileNotFoundError as exc:
        log.error("Kokoro model files missing: %s", exc)
        raise HTTPException(status_code=503, detail=str(exc))
    except AssertionError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except ImportError:
        raise HTTPException(status_code=503, detail="kokoro-onnx not installed")
    except Exception as exc:
        log.error("TTS synthesis failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"TTS failed: {exc}")


@router.get("/tts/voices")
async def list_voices(user_id: str = Depends(require_auth)):
    """List all available Kokoro voice names."""
    try:
        kokoro = _get_kokoro()
        voices = sorted(kokoro.voices.files) if hasattr(kokoro.voices, "files") else []
        return JSONResponse({"voices": voices})
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))
