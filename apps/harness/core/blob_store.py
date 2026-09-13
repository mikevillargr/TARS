"""
Disk-backed blob store for binary artifact payloads.

Binary payloads (PDFs, DOCX, images, media, archives) used to live in the
`artifacts.content` Postgres Text column as "base64:"-prefixed strings — multi-MB
rows that slowed every list/detail load. Payloads now live on disk under
`settings.blob_dir` as <blob_dir>/<user_id>/<uuid4>.<ext>; the row keeps only
extracted text plus a `storage_path` pointer.

The blob dir is created lazily on first store — never at import.
"""

import base64
import logging
import os
import uuid

from core.config import settings

log = logging.getLogger(__name__)


def store(data: bytes, ext: str, user_id: str) -> str:
    """Write bytes to <blob_dir>/<user_id>/<uuid4>.<ext>; return the path relative to blob_dir."""
    ext = ext.lstrip(".").lower() or "bin"
    relpath = os.path.join(user_id, f"{uuid.uuid4().hex}.{ext}")
    dest = os.path.join(settings.blob_dir, relpath)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as fh:
        fh.write(data)
    return relpath


def read(relpath: str) -> bytes:
    with open(os.path.join(settings.blob_dir, relpath), "rb") as fh:
        return fh.read()


def delete(relpath: str) -> None:
    """Remove a blob. A missing file is not an error."""
    try:
        os.remove(os.path.join(settings.blob_dir, relpath))
    except FileNotFoundError:
        pass


def resolve_artifact_bytes(artifact) -> bytes | None:
    """Raw bytes for a file-backed artifact, wherever they live.

    Blob store first; fall back to decoding a legacy "base64:" content value so
    rows not yet backfilled still download/preview. Returns None for text-only
    artifacts (their payload IS the content column).
    """
    if artifact.storage_path:
        try:
            return read(artifact.storage_path)
        except FileNotFoundError:
            log.warning("artifact %s: blob missing at %s", artifact.id, artifact.storage_path)
            return None
    content = artifact.content or ""
    if content.startswith("base64:"):
        return base64.b64decode(content[7:])
    return None
