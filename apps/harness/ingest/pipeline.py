"""
Universal file ingest pipeline.

Given raw bytes + metadata, routes to the correct parser and returns:
  - extracted text content
  - detected artifact type (document | code | spreadsheet | transcript)
  - a display-friendly summary title
"""
from __future__ import annotations
import mimetypes
from typing import Optional

from ingest.parsers import text as text_parser
from ingest.parsers.text import TEXT_EXTENSIONS


# ─── MIME → artifact type ──────────────────────────────────────────────────────

def _artifact_type_from_ext(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in {"py", "ts", "tsx", "js", "jsx", "go", "rs", "java", "rb", "sh",
               "diff", "patch", "c", "cpp", "h", "cs", "swift", "kt", "sql",
               "css", "scss", "graphql", "bash", "zsh", "ps1", "dart", "r"}:
        return "code"
    if ext in {"csv", "xlsx", "xls"}:
        return "spreadsheet"
    if ext in {"txt", "vtt", "srt"}:
        return "transcript"
    if ext in {"jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff"}:
        return "document"  # stores vision description as a document
    return "document"


def detect_mime(filename: str, content_bytes: bytes) -> str:
    """Best-effort MIME type from filename first, then magic bytes."""
    mime, _ = mimetypes.guess_type(filename)
    if mime:
        return mime

    # Magic bytes fallback
    sig = content_bytes[:8]
    if sig[:4] == b"%PDF":
        return "application/pdf"
    if sig[:2] == b"PK":
        # ZIP-based: could be docx, pptx, xlsx
        if filename.lower().endswith(".docx"):
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if filename.lower().endswith(".pptx"):
            return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        if filename.lower().endswith(".xlsx"):
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return "application/zip"
    if sig[:3] in (b"\xff\xd8\xff",):
        return "image/jpeg"
    if sig[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if sig[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if sig[:4] == b"RIFF" and content_bytes[8:12] == b"WEBP":
        return "image/webp"

    return "text/plain"


async def ingest_file(
    content_bytes: bytes,
    filename: str,
    mime_type: Optional[str] = None,
) -> dict:
    """
    Parse file bytes into text content.

    Returns:
        {
            "content": str,          # extracted text
            "artifact_type": str,    # document | code | spreadsheet | transcript
            "display_title": str,    # human-readable title (filename without ext)
        }
    """
    if not mime_type:
        mime_type = detect_mime(filename, content_bytes)

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    artifact_type = _artifact_type_from_ext(filename)
    display_title = filename.rsplit(".", 1)[0] if "." in filename else filename

    # ── Route to parser ──────────────────────────────────────────────
    content: str

    # PDF
    if mime_type == "application/pdf" or ext == "pdf":
        from ingest.parsers import pdf as pdf_parser
        content = pdf_parser.extract(content_bytes)

    # DOCX
    elif (
        mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        or ext == "docx"
    ):
        from ingest.parsers import docx as docx_parser
        content = docx_parser.extract(content_bytes)

    # PPTX
    elif (
        mime_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        or ext == "pptx"
    ):
        from ingest.parsers import pptx as pptx_parser
        content = pptx_parser.extract(content_bytes)

    # XLSX / XLS
    elif (
        mime_type in (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
        )
        or ext in ("xlsx", "xls")
    ):
        from ingest.parsers import xlsx as xlsx_parser
        content = xlsx_parser.extract(content_bytes, filename=filename)

    # Images → Claude Vision
    elif mime_type.startswith("image/") or ext in {
        "jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "bmp", "tiff"
    }:
        from ingest.parsers import image as image_parser
        content = await image_parser.extract(content_bytes, mime_type=mime_type, filename=filename)

    # Plain text / code / JSON / CSV / HTML / etc.
    elif ext in TEXT_EXTENSIONS or mime_type.startswith("text/"):
        content = text_parser.extract(content_bytes, filename=filename, mime_type=mime_type)

    # Fallback: try UTF-8 decode
    else:
        content = text_parser.extract(content_bytes, filename=filename, mime_type=mime_type)
        if content.startswith("[Could not decode"):
            content = f"[Binary file: {filename} — {len(content_bytes):,} bytes. Cannot extract text content.]"

    return {
        "content": content,
        "artifact_type": artifact_type,
        "display_title": display_title,
    }
