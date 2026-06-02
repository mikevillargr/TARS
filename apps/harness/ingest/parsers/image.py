"""Image parser using Claude Vision (Haiku for speed/cost)."""
from __future__ import annotations
import base64


SUPPORTED_MIME_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}

# HEIC is not natively supported by Claude Vision — we'll note it
UNSUPPORTED_MSG = "[HEIC images require conversion to JPEG/PNG before processing]"


async def extract(content_bytes: bytes, mime_type: str, filename: str = "") -> str:
    """Send image to Claude Vision and return a detailed description."""
    from core.config import settings

    # Normalise HEIC — can't send to API
    if mime_type in ("image/heic", "image/heif"):
        return UNSUPPORTED_MSG

    # Default to JPEG if mime type is unknown
    if mime_type not in SUPPORTED_MIME_TYPES:
        mime_type = "image/jpeg"

    try:
        from core.model_client import get_model_client as _gmc_img
    except ImportError:
        return "[image parser unavailable — model client not found]"

    _p = settings.tier1_provider
    client = _gmc_img().zai if _p == "zai" else _gmc_img().anthropic
    _vision_model = settings.tier1_model_override or ("glm-4.5-air" if _p == "zai" else settings.tier1_model)

    b64 = base64.standard_b64encode(content_bytes).decode()

    message = await client.messages.create(
        model=_vision_model,  # tier1 model — fast and cheap for vision
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": (
                            "Please provide a thorough description of this image. "
                            "Include: what is shown, any visible text (transcribe it exactly), "
                            "charts/graphs/data (describe the data), people/objects/settings, "
                            "and any other relevant details. Be comprehensive."
                        ),
                    },
                ],
            }
        ],
    )

    return message.content[0].text
