"""
URL preview endpoint — returns OG/meta title, description, image and favicon
for a given URL. Used by the chat frontend to render inline link preview cards.
"""

import logging
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from core.auth import require_auth

log = logging.getLogger(__name__)
router = APIRouter()

_TIMEOUT = 8.0
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TARS/1.0; +https://tarsmv.duckdns.org)",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
}


class UrlPreviewOut(BaseModel):
    url: str
    title: str | None = None
    description: str | None = None
    image: str | None = None
    favicon: str | None = None
    domain: str | None = None


def _extract_meta(html: str, base_url: str) -> dict:
    """Pull title, description, image, favicon from raw HTML."""
    import re

    def get_meta(prop: str, attr: str = "content") -> str | None:
        # og: and twitter: meta tags
        m = re.search(
            rf'<meta[^>]+(?:property|name)\s*=\s*["\']?{re.escape(prop)}["\']?[^>]+{attr}\s*=\s*["\']([^"\']+)["\']',
            html, re.IGNORECASE,
        ) or re.search(
            rf'<meta[^>]+{attr}\s*=\s*["\']([^"\']+)["\'][^>]+(?:property|name)\s*=\s*["\']?{re.escape(prop)}["\']?',
            html, re.IGNORECASE,
        )
        return m.group(1).strip() if m else None

    # Title: og:title > twitter:title > <title>
    title = (
        get_meta("og:title")
        or get_meta("twitter:title")
        or (re.search(r"<title[^>]*>([^<]{1,200})</title>", html, re.IGNORECASE) or [None, None])[1]
    )
    if title:
        title = title.strip()[:200]

    # Description
    description = (
        get_meta("og:description")
        or get_meta("twitter:description")
        or get_meta("description")
    )
    if description:
        description = description.strip()[:300]

    # Image
    image = get_meta("og:image") or get_meta("twitter:image")
    if image and image.startswith("/"):
        parsed = urlparse(base_url)
        image = f"{parsed.scheme}://{parsed.netloc}{image}"

    # Favicon
    fav_match = re.search(
        r'<link[^>]+rel=["\'](?:shortcut )?icon["\'][^>]+href=["\']([^"\']+)["\']',
        html, re.IGNORECASE,
    ) or re.search(
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\'](?:shortcut )?icon["\']',
        html, re.IGNORECASE,
    )
    favicon = None
    if fav_match:
        fav = fav_match.group(1).strip()
        if fav.startswith("http"):
            favicon = fav
        elif fav.startswith("/"):
            parsed = urlparse(base_url)
            favicon = f"{parsed.scheme}://{parsed.netloc}{fav}"
    if not favicon:
        parsed = urlparse(base_url)
        favicon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"

    return {"title": title, "description": description, "image": image, "favicon": favicon}


@router.get("/preview", response_model=UrlPreviewOut)
async def get_url_preview(
    url: str = Query(..., description="URL to preview"),
    _user_id: str = Depends(require_auth),
):
    """Fetch OG metadata for a URL. Fast, no DB writes."""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.removeprefix("www.") if parsed.netloc else None

        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=_TIMEOUT,
            headers=_HEADERS,
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            html = resp.text

        meta = _extract_meta(html, url)
        return UrlPreviewOut(
            url=url,
            domain=domain,
            **meta,
        )
    except Exception as exc:
        log.warning("URL preview failed for %s: %s", url, exc)
        parsed = urlparse(url)
        return UrlPreviewOut(
            url=url,
            domain=parsed.netloc.removeprefix("www.") if parsed.netloc else None,
        )
