"""
Text chunker — splits documents into ~500-token chunks with ~80-token overlap.
Uses sentence boundaries rather than raw word windows so chunks contain complete
semantic units, improving embedding quality and retrieved text readability.
"""

import re
from typing import List

CHUNK_WORDS = 375       # ≈ 500 tokens
OVERLAP_WORDS = 60      # ≈ 80 tokens

# Split on sentence-ending punctuation followed by whitespace, or paragraph breaks.
# Lookbehind ensures we split after the punctuation, not before it.
_SENTENCE_SPLIT = re.compile(r'(?<=[.!?])\s+|\n{2,}')


def chunk_text(text: str, chunk_words: int = CHUNK_WORDS, overlap_words: int = OVERLAP_WORDS) -> List[str]:
    """
    Split text into overlapping chunks at sentence boundaries.

    Strategy:
    - Split the text into sentences/paragraphs using punctuation boundaries.
    - Accumulate sentences into a chunk until the word budget is reached.
    - On overflow, emit the chunk and seed the next one with the last few
      sentences (overlap), preserving context across chunk boundaries.
    """
    if not text or not text.strip():
        return []

    # Split into sentences; filter blanks
    raw_sentences = _SENTENCE_SPLIT.split(text.strip())
    sentences = [s.strip() for s in raw_sentences if s.strip()]
    if not sentences:
        return []

    chunks: List[str] = []
    current: List[str] = []
    current_words: int = 0

    for sentence in sentences:
        s_words = len(sentence.split())

        # If adding this sentence would overflow the chunk, emit and start overlap
        if current_words + s_words > chunk_words and current:
            chunks.append(" ".join(current))

            # Seed next chunk with trailing sentences up to overlap_words
            overlap: List[str] = []
            overlap_count = 0
            for prev in reversed(current):
                w = len(prev.split())
                if overlap_count + w > overlap_words:
                    break
                overlap.insert(0, prev)
                overlap_count += w
            current = overlap
            current_words = overlap_count

        current.append(sentence)
        current_words += s_words

    # Emit the final chunk
    if current:
        chunks.append(" ".join(current))

    return [c for c in chunks if c.strip()]
