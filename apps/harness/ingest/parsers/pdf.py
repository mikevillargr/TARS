"""PDF parser using pymupdf (fitz)."""
from __future__ import annotations


def extract(content_bytes: bytes) -> str:
    try:
        import fitz  # pymupdf
    except ImportError:
        return "[PDF parser unavailable — install pymupdf]"

    doc = fitz.open(stream=content_bytes, filetype="pdf")
    pages = []
    for page in doc:
        text = page.get_text("text")
        if text.strip():
            pages.append(text.strip())
    doc.close()
    return "\n\n".join(pages)
