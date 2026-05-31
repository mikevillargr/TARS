"""
Mnemon — episodic memory store.
What happened: conversations, decisions, personal facts, key events.
"""

from datetime import datetime, timezone
from typing import List, Optional, Tuple
from sqlalchemy import select, desc, delete, func
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
    deduplicate: bool = True,
) -> Memory:
    """
    Save a memory with its embedding.

    If deduplicate=True (default), checks whether a near-identical memory
    already exists (cosine_distance < 0.12).  If one is found:
    - Updates it if the new content is longer (more detail) or the new
      importance is higher.
    - Otherwise returns the existing row unchanged.

    This prevents the same fact from accumulating dozens of copies over
    repeated conversations.
    """
    embedding = embed_one(content)

    if deduplicate:
        # Look for a very close match (cosine_distance < 0.12 ≈ similarity > 0.88)
        stmt = (
            select(Memory)
            .where(Memory.user_id == user_id)
            .where(Memory.embedding.is_not(None))
            .where(Memory.embedding.cosine_distance(embedding) < 0.12)
            .order_by(Memory.embedding.cosine_distance(embedding))
            .limit(1)
        )
        result = await db.execute(stmt)
        existing = result.scalar_one_or_none()
        if existing:
            updated = False
            # Richer content wins
            if len(content) > len(existing.content):
                existing.content = content
                existing.embedding = embedding
                updated = True
            # Higher importance wins
            if importance > existing.importance:
                existing.importance = importance
                updated = True
            if updated:
                await db.commit()
                await db.refresh(existing)
            return existing

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


async def list_memories(
    db: AsyncSession,
    user_id: str,
    limit: int = 100,
    offset: int = 0,
    domain: Optional[str] = None,
    source: Optional[str] = None,
) -> Tuple[List[Memory], int]:
    """
    Paginated listing of all memories, newest first.
    Returns (memories, total_count).
    """
    base = (
        select(Memory)
        .where(Memory.user_id == user_id)
    )
    if domain:
        base = base.where(Memory.domain == domain)
    if source:
        base = base.where(Memory.source == source)

    # Total count
    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    # Paginated rows
    rows_stmt = base.order_by(desc(Memory.created_at)).offset(offset).limit(limit)
    rows = (await db.execute(rows_stmt)).scalars().all()

    return rows, total


# Legacy alias — kept so existing internal callers don't break
async def list_recent(
    db: AsyncSession,
    user_id: str,
    limit: int = 100,
) -> List[Memory]:
    rows, _ = await list_memories(db, user_id, limit=limit)
    return rows


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
