"""DOCX parser using python-docx."""
from __future__ import annotations
import io


def extract(content_bytes: bytes) -> str:
    try:
        from docx import Document
    except ImportError:
        return "[DOCX parser unavailable — install python-docx]"

    doc = Document(io.BytesIO(content_bytes))
    parts = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if not text:
            continue
        style = para.style.name if para.style else ""
        if style.startswith("Heading"):
            level = style.split()[-1] if style.split()[-1].isdigit() else "1"
            parts.append(f"{'#' * int(level)} {text}")
        else:
            parts.append(text)
    return "\n\n".join(parts)
