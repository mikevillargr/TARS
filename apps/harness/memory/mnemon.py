"""
Mnemon — episodic memory store.
What happened: conversations, decisions, personal facts, key events.
"""

from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import select, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import Memory
from memory.embeddings import embed_one


async def write(
    db: AsyncSession,
    user_id: str,
    content: str,
    domain: str = "work",
    source: str = "conversation",
    importance: int = 3,
    expires_at: Optional[datetime] = None,
) -> Memory:
    """Save a memory with its embedding."""
    embedding = embed_one(content)
    mem = Memory(
        user_id=user_id,
        content=content,
        embedding=embedding,
        domain=domain,
        source=source,
        importance=importance,
        expires_at=expires_at,
    )
    db.add(mem)
    await db.commit()
    await db.refresh(mem)
    return mem


async def search(
    db: AsyncSession,
    user_id: str,
    query: str,
    limit: int = 6,
    domain: Optional[str] = None,
    threshold: float = 0.5,
) -> List[Memory]:
    """
    Semantic search over memories using pgvector cosine distance.
    Only returns results with cosine_distance < threshold (i.e. similarity > 0.5).
    This prevents irrelevant memories from polluting the context window.
    """
    query_embedding = embed_one(query)

    stmt = (
        select(Memory)
        .where(Memory.user_id == user_id)
        .where(Memory.embedding.is_not(None))
        .where(Memory.embedding.cosine_distance(query_embedding) < threshold)
        .order_by(Memory.embedding.cosine_distance(query_embedding))
        .limit(limit)
    )
    if domain:
        stmt = stmt.where(Memory.domain == domain)

    result = await db.execute(stmt)
    return result.scalars().all()


async def list_recent(
    db: AsyncSession,
    user_id: str,
    limit: int = 50,
) -> List[Memory]:
    result = await db.execute(
        select(Memory)
        .where(Memory.user_id == user_id)
        .order_by(desc(Memory.created_at))
        .limit(limit)
    )
    return result.scalars().all()


async def get(db: AsyncSession, memory_id: str, user_id: str) -> Optional[Memory]:
    result = await db.execute(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def remove(db: AsyncSession, memory_id: str, user_id: str) -> bool:
    result = await db.execute(
        delete(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
    )
    await db.commit()
    return result.rowcount > 0


def format_for_context(memories: List[Memory]) -> str:
    if not memories:
        return "No relevant memories."
    lines = []
    for m in memories:
        ts = m.created_at.strftime("%Y-%m-%d") if m.created_at else "unknown"
        lines.append(f"[{ts} | {m.domain}] {m.content}")
    return "\n".join(lines)
