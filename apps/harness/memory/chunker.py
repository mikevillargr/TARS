"""
Text chunker — splits documents into ~500-token chunks with 50-100 token overlap.
Uses word-count as a proxy for tokens (≈ 0.75 words per token on average).
"""

from typing import List

CHUNK_WORDS = 375       # ≈ 500 tokens
OVERLAP_WORDS = 60      # ≈ 80 tokens


def chunk_text(text: str, chunk_words: int = CHUNK_WORDS, overlap_words: int = OVERLAP_WORDS) -> List[str]:
    """Split text into overlapping word chunks."""
    words = text.split()
    if not words:
        return []

    chunks: List[str] = []
    start = 0

    while start < len(words):
        end = min(start + chunk_words, len(words))
        chunks.append(" ".join(words[start:end]))
        if end == len(words):
            break
        start += chunk_words - overlap_words

    return [c for c in chunks if c.strip()]
