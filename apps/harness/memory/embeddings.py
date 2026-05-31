"""
Embedding client — BAAI/bge-base-en-v1.5 via fastembed (ONNX, CPU-fast, 768 dims).
Singleton: model loads once on first call, stays resident.
"""

from typing import List, Optional
import numpy as np

_model = None
EMBEDDING_DIM = 768


def _get_model():
    global _model
    if _model is None:
        from fastembed import TextEmbedding
        _model = TextEmbedding("BAAI/bge-base-en-v1.5")
    return _model


def embed(texts: List[str]) -> List[List[float]]:
    """Embed a list of texts. Returns list of 768-dim float vectors."""
    if not texts:
        return []
    model = _get_model()
    embeddings = list(model.embed(texts))
    return [e.tolist() for e in embeddings]


def embed_one(text: str) -> List[float]:
    """Embed a single text. Returns a 768-dim float vector."""
    return embed([text])[0]


def cosine_similarity(a: List[float], b: List[float]) -> float:
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-9))
