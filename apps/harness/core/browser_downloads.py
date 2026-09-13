"""
Files a browser run brought back.

A download is the point of a lot of browser work — the invoice, the CSV export,
the monthly report — so it has to land somewhere durable rather than existing
only as a sentence the agent wrote about it.

Two destinations, deliberately different:
  - **Artifacts** always. That is TARS's library of generated files and a
    download is exactly that. Text-bearing files are parsed on the way in so
    they are searchable rather than an opaque blob.
  - **Second Brain** on request, not automatically. Second Brain is knowledge
    Mike chose to keep; auto-filing every invoice into it would bury the things
    he actually curated.
"""

import logging
import os
from typing import List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from core import blob_store
from db.models import Artifact
from ingest.pipeline import detect_mime, ingest_file

log = logging.getLogger(__name__)

# Same ceiling as run media. Kept even though payloads now land on disk rather
# than in a Text column — the cap stops a pathological download filling the
# blob store, not Postgres rows.
MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024


async def artifacts_for_downloads(
    downloads: List[dict],
    job_id: str,
    user_id: str,
) -> List[Artifact]:
    """Turn captured downloads into Artifact rows. Caller adds and commits."""
    out: List[Artifact] = []
    for item in downloads:
        path, name = item.get("path"), item.get("filename") or "download"
        if not path or not os.path.exists(path):
            continue
        try:
            size = os.path.getsize(path)
            if size > MAX_DOWNLOAD_BYTES:
                log.info("browser %s: download %s too large (%.1fMB)", job_id, name, size / 1e6)
                continue
            with open(path, "rb") as fh:
                raw = fh.read()

            mime = detect_mime(name, raw)
            artifact_type = "document"
            content: Optional[str] = None
            storage_path: Optional[str] = None
            # Try to extract text so the file is searchable in Artifacts instead
            # of being an opaque blob. Binary or unparseable falls back.
            try:
                parsed = await ingest_file(content_bytes=raw, filename=name, mime_type=mime)
                if parsed.get("content"):
                    content = parsed["content"]
                    artifact_type = parsed.get("artifact_type") or "document"
            except Exception as err:  # noqa: BLE001
                log.debug("download %s not text-extractable: %s", name, err)

            if content is None:
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else "bin"
                storage_path = blob_store.store(raw, ext, user_id)

            out.append(
                Artifact(
                    user_id=user_id,
                    filename=name,
                    type=artifact_type,
                    source="browser",
                    source_id=job_id,
                    content=content,
                    storage_path=storage_path,
                    size_bytes=size,
                    tags=["browser", "download"],
                )
            )
        except Exception as err:  # noqa: BLE001 — a bad file is not a failed run
            log.warning("browser %s: could not store download %s: %s", job_id, name, err)
    return out


async def save_artifact_to_brain(
    db: AsyncSession,
    artifact: Artifact,
    user_id: str,
    note: str = "",
    tags: Optional[List[str]] = None,
) -> Optional[str]:
    """Push an artifact's text into Second Brain. Returns the item id.

    Only text-bearing artifacts: a blob-stored (or legacy base64) payload has
    nothing to embed, so saving one would create an item that can never be
    found by search.
    """
    content = artifact.content or ""
    if artifact.storage_path or content.startswith("base64:"):
        return None
    from memory import second_brain

    item = await second_brain.ingest_document(
        db=db,
        user_id=user_id,
        content=content,
        title=artifact.filename,
        personal_note=note,
        tags=(tags or []) + ["browser"],
    )
    return item.id
