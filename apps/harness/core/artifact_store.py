"""
Persisting an uploaded file as an Artifact.

Shared by POST /artifacts/ingest (Artifacts page, Second Brain capture) and chat
file uploads: text-bearing formats go through the ingest pipeline so they stay
searchable; binary payloads go to the disk blob store and the row keeps only a
storage_path pointer.
"""

from typing import Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core import blob_store
from db.models import Artifact
from ingest.pipeline import detect_mime, ingest_file, _artifact_type_from_ext

# Formats kept as binary blobs — the original file stays downloadable/previewable
# and text is extracted on demand (chat injection, /preview) rather than on ingest.
_BINARY_EXTS = {"pdf", "docx", "ppt", "pptx", "xls", "xlsx"}
_BINARY_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
_IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "webp"}
_IMAGE_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"}
# Legacy .doc: no text extraction
_DOC_LEGACY_EXTS = {"doc"}
_DOC_LEGACY_MIMES = {"application/msword"}
# Audio/video/archives: keep the original downloadable
_MEDIA_EXTS = {"mp3", "wav", "m4a", "aac", "ogg", "flac",
               "mp4", "mov", "avi", "mkv", "webm", "m4v", "wmv",
               "rtf", "zip", "tar", "gz", "bz2", "7z", "rar"}
_MEDIA_MIMES = {
    "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4",
    "audio/aac", "audio/ogg", "audio/flac",
    "video/mp4", "video/quicktime", "video/x-msvideo",
    "video/x-matroska", "video/webm", "video/x-ms-wmv",
    "application/rtf", "text/rtf",
    "application/zip", "application/x-tar",
    "application/gzip", "application/x-bzip2",
    "application/x-7z-compressed", "application/vnd.rar",
}


async def store_upload_as_artifact(
    user_id: str,
    data: bytes,
    filename: str,
    source: str,
    db: AsyncSession,
    mime_type: str = "",
) -> Artifact:
    """Store an uploaded file as an Artifact row (committed) and return it.

    Binary payloads go to the blob store (content stays NULL); everything else
    is parsed by the ingest pipeline and stored as extracted text. Raises 422
    for HEIC/BMP/TIFF images the vision model cannot analyze.
    """
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    detected_mime = mime_type or detect_mime(filename, data)
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    artifact_type = _artifact_type_from_ext(filename)

    # HEIC/HEIF photos: reject at upload time with a clear message
    if ext in ("heic", "heif") or detected_mime in ("image/heic", "image/heif"):
        raise HTTPException(
            status_code=422,
            detail=(
                "HEIC photos cannot be analyzed directly. "
                "Please export the photo as JPEG or PNG (in your Photos app: Share → Save as JPEG) and try again."
            ),
        )

    # BMP/TIFF: image-like but Anthropic Vision doesn't accept them
    if ext in ("bmp", "tiff", "tif") or detected_mime in ("image/bmp", "image/tiff", "image/x-tiff", "image/x-bmp"):
        raise HTTPException(
            status_code=422,
            detail=(
                f"'{filename}' is in {ext.upper()} format which cannot be analyzed. "
                "Please convert to JPEG or PNG and try again."
            ),
        )

    content: Optional[str] = None
    storage_path: Optional[str] = None
    if (ext in _BINARY_EXTS or detected_mime in _BINARY_MIMES
            or ext in _IMAGE_EXTS or detected_mime in _IMAGE_MIMES
            or ext in _DOC_LEGACY_EXTS or detected_mime in _DOC_LEGACY_MIMES
            or ext in _MEDIA_EXTS or detected_mime in _MEDIA_MIMES):
        storage_path = blob_store.store(data, ext or "bin", user_id)
        size_bytes = len(data)
        # Override type for images so the UI can distinguish and render them correctly
        if ext in _IMAGE_EXTS or detected_mime in _IMAGE_MIMES:
            artifact_type = "image"
    else:
        result = await ingest_file(
            content_bytes=data,
            filename=filename,
            mime_type=detected_mime,
        )
        content = result["content"]
        artifact_type = result["artifact_type"]
        size_bytes = len(content.encode("utf-8"))

    artifact = Artifact(
        user_id=user_id,
        filename=filename,
        type=artifact_type,
        source=source,
        content=content,
        storage_path=storage_path,
        version=1,
        size_bytes=size_bytes,
        tags=[],
    )
    db.add(artifact)
    await db.commit()
    await db.refresh(artifact)
    return artifact
