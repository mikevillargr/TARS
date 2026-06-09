"""Proxy external images to bypass hotlink/referer restrictions."""

import logging
import httpx
from fastapi import APIRouter, Query
from fastapi.responses import Response

log = logging.getLogger(__name__)
router = APIRouter()

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1)",
    "Referer": "https://www.google.com/",
}


@router.get("/image-proxy")
async def image_proxy(url: str = Query(...)):
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, follow_redirects=True, headers=_HEADERS)
            if resp.status_code != 200:
                return Response(status_code=404)
            ct = resp.headers.get("content-type", "image/jpeg")
            if not ct.startswith("image/"):
                return Response(status_code=400)
            return Response(
                content=resp.content,
                media_type=ct.split(";")[0].strip(),
                headers={"Cache-Control": "public, max-age=86400"},
            )
    except Exception as exc:
        log.warning("image_proxy failed for %s: %s", url, exc)
        return Response(status_code=502)
