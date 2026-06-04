"""
Second Brain — semantic knowledge store.
What you know: saved URLs, notes, documents, research.
Two-stage retrieval: item-level summary first, then chunk-level within matched items.
"""

from typing import List, Optional
from sqlalchemy import select, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select
from db.models import KnowledgeItem, DocumentChunk, UserDomain
from memory.embeddings import embed_one, embed
from memory.chunker import chunk_text


async def classify_domain(db: AsyncSession, user_id: str, content_snippet: str) -> str:
    """Auto-classify content into a user domain using Haiku. Falls back to 'general'."""
    try:
        from sqlalchemy import func as _func
        domains = (await db.execute(
            select(UserDomain.name)
            .where(UserDomain.user_id == user_id)
            .order_by(UserDomain.position)
        )).scalars().all()
        if not domains:
            return "general"

        from core.config import settings as _s
        import anthropic as _a
        client = _a.AsyncAnthropic(api_key=_s.anthropic_api_key)
        domain_list = ", ".join(domains)
        msg = await client.messages.create(
            model=_s.tier1_model,
            max_tokens=10,
            messages=[{
                "role": "user",
                "content": (
                    f"Pick the best category for this content from: {domain_list}\n\n"
                    f"Content: {content_snippet[:300]}\n\n"
                    "Return ONLY the category name, nothing else."
                ),
            }],
        )
        result = msg.content[0].text.strip().lower()
        for d in domains:
            if d.lower() == result:
                return d
        return "general"
    except Exception:
        return "general"


# ── Ingest ────────────────────────────────────────────────────────────────────

async def ingest_url(
    db: AsyncSession,
    user_id: str,
    url: str,
    personal_note: str = "",
    tags: List[str] = [],
    domain: Optional[str] = None,
) -> KnowledgeItem:
    """Fetch URL, extract clean text, chunk, embed, save."""
    import asyncio
    import trafilatura

    # fetch_url is blocking — run off the event loop
    loop = asyncio.get_event_loop()
    downloaded = await loop.run_in_executor(None, trafilatura.fetch_url, url)
    if not downloaded:
        raise ValueError(f"Could not fetch URL: {url}")

    clean = trafilatura.extract(downloaded, include_comments=False, include_tables=True) or ""
    metadata = trafilatura.extract_metadata(downloaded)
    title = metadata.title if metadata else url
    author = metadata.author if metadata else None

    return await _ingest_content(
        db=db,
        user_id=user_id,
        item_type="url",
        content=clean,
        title=title,
        url=url,
        author=author,
        personal_note=personal_note,
        tags=tags,
        domain=domain,
    )


async def ingest_meeting(
    db: AsyncSession,
    user_id: str,
    transcript: str,
    title: str,
    summary: str = "",
    attendees: List[str] = [],
    connector_ref: str = "",
) -> KnowledgeItem:
    """
    Ingest a meeting transcript into Second Brain for semantic search.

    Uses the AI-generated summary for the item-level embedding (stage-1 retrieval)
    so queries like "TenderBites meeting last week" find the right document.
    Chunks the full transcript for stage-2 deep retrieval.
    Uses fireflies://<connector_ref> as a dedup key via the url field.
    """
    url = f"fireflies://{connector_ref}" if connector_ref else None

    # Item-level embedding: AI summary is far more meaningful than first 800 words
    embed_text = summary or title
    item_embedding = embed_one(embed_text)

    item = KnowledgeItem(
        user_id=user_id,
        type="meeting",
        url=url,
        raw_content=transcript,
        clean_content=transcript,
        tags=["meeting", "transcript"],
        domain="work",  # meetings always go to work domain
        embedding=item_embedding,
        summary=summary[:500] if summary else None,
        source_title=title,
        # Re-use topics[] to store attendee list for display
        topics=attendees[:10] if attendees else [],
    )
    db.add(item)
    await db.flush()

    chunks = chunk_text(transcript)
    if chunks:
        chunk_embeddings = embed(chunks)
        for i, (chunk_str, emb) in enumerate(zip(chunks, chunk_embeddings)):
            db.add(DocumentChunk(
                knowledge_item_id=item.id,
                chunk_index=i,
                content=chunk_str,
                embedding=emb,
                token_count=len(chunk_str.split()),
            ))

    await db.commit()
    await db.refresh(item)
    return item


async def ingest_text(
    db: AsyncSession,
    user_id: str,
    content: str,
    title: str = "",
    personal_note: str = "",
    tags: List[str] = [],
    domain: Optional[str] = None,
) -> KnowledgeItem:
    """Save a plain text or markdown note."""
    return await _ingest_content(
        db=db,
        user_id=user_id,
        item_type="note",
        content=content,
        title=title or content[:60],
        personal_note=personal_note,
        tags=tags,
        domain=domain,
    )


async def ingest_document(
    db: AsyncSession,
    user_id: str,
    content: str,
    title: str = "",
    personal_note: str = "",
    tags: List[str] = [],
    domain: Optional[str] = None,
) -> KnowledgeItem:
    """Save a rich document created in the WYSIWYG editor (Markdown content)."""
    return await _ingest_content(
        db=db,
        user_id=user_id,
        item_type="document",
        content=content,
        title=title or content[:60],
        personal_note=personal_note,
        tags=tags,
        domain=domain,
    )


async def _ingest_content(
    db: AsyncSession,
    user_id: str,
    item_type: str,
    content: str,
    title: str,
    url: str = "",
    author: str = "",
    personal_note: str = "",
    tags: List[str] = [],
    domain: Optional[str] = None,
) -> KnowledgeItem:
    # Auto-classify when domain not provided
    if not domain:
        snippet = f"{title} {content[:300]}".strip()
        domain = await classify_domain(db, user_id, snippet)

    # Generate item-level summary embedding (first 800 words as summary proxy)
    summary_text = " ".join(content.split()[:800])
    item_embedding = embed_one(summary_text) if summary_text else None

    item = KnowledgeItem(
        user_id=user_id,
        type=item_type,
        url=url or None,
        raw_content=content,
        clean_content=content,
        personal_note=personal_note or None,
        tags=tags,
        domain=domain,
        embedding=item_embedding,
        summary=summary_text[:500] if summary_text else None,
        source_title=title or None,
        source_author=author or None,
    )
    db.add(item)
    await db.flush()  # get item.id

    # Chunk and embed
    chunks = chunk_text(content)
    if chunks:
        chunk_texts = chunks
        chunk_embeddings = embed(chunk_texts)
        for i, (chunk_text_str, emb) in enumerate(zip(chunk_texts, chunk_embeddings)):
            chunk = DocumentChunk(
                knowledge_item_id=item.id,
                chunk_index=i,
                content=chunk_text_str,
                embedding=emb,
                token_count=len(chunk_text_str.split()),
            )
            db.add(chunk)

    await db.commit()
    await db.refresh(item)
    return item


# ── Search ────────────────────────────────────────────────────────────────────

async def search(
    db: AsyncSession,
    user_id: str,
    query: str,
    limit: int = 20,
    threshold: float = 0.45,
) -> List[dict]:
    """
    Two-stage retrieval:
    1. Find top matching items by item-level embedding (filtered by threshold)
    2. Find top matching chunks within those items (filtered by threshold)
    Returns list of {item, chunk} dicts with the most relevant context.
    Only results with cosine_distance < threshold are returned (similarity > 0.45).
    Falls back to keyword search when no semantic matches are found.
    """
    query_embedding = embed_one(query)

    # Stage 1: top items within similarity threshold
    item_result = await db.execute(
        select(KnowledgeItem)
        .where(KnowledgeItem.user_id == user_id)
        .where(KnowledgeItem.embedding.is_not(None))
        .where(KnowledgeItem.embedding.cosine_distance(query_embedding) < threshold)
        .order_by(KnowledgeItem.embedding.cosine_distance(query_embedding))
        .limit(limit * 2)
    )
    top_items = item_result.scalars().all()
    if not top_items:
        return await _keyword_fallback_search(db, user_id, query, top_n=limit)

    item_ids = [item.id for item in top_items]

    # Stage 2: top chunks within those items, also filtered by threshold
    chunk_result = await db.execute(
        select(DocumentChunk)
        .where(DocumentChunk.knowledge_item_id.in_(item_ids))
        .where(DocumentChunk.embedding.is_not(None))
        .where(DocumentChunk.embedding.cosine_distance(query_embedding) < threshold)
        .order_by(DocumentChunk.embedding.cosine_distance(query_embedding))
        .limit(limit)
    )
    top_chunks = chunk_result.scalars().all()

    # Build result: pair each chunk with its parent item
    item_map = {item.id: item for item in top_items}
    results = []
    seen_items = set()

    for chunk in top_chunks:
        item = item_map.get(chunk.knowledge_item_id)
        if item:
            results.append({"item": item, "chunk": chunk})
            seen_items.add(item.id)

    # If no chunks passed threshold, fall back to item-level summaries (already threshold-filtered)
    if not results:
        for item in top_items[:limit]:
            results.append({"item": item, "chunk": None})

    return results[:limit]


async def _keyword_fallback_search(
    db: AsyncSession,
    user_id: str,
    query: str,
    top_n: int = 20,
) -> List[dict]:
    """Fallback keyword-based search when semantic similarity finds no results."""
    keywords = [kw.lower() for kw in query.split() if len(kw) > 2]
    if not keywords:
        return []
    all_result = await db.execute(
        select(KnowledgeItem).where(KnowledgeItem.user_id == user_id).limit(500)
    )
    all_items = all_result.scalars().all()
    scored = []
    for item in all_items:
        text = " ".join(filter(None, [
            item.source_title or "",
            item.summary or "",
            (item.clean_content or "")[:500],
        ])).lower()
        hits = sum(1 for kw in keywords if kw in text)
        if hits > 0:
            scored.append((hits, item))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [{"item": item, "chunk": None} for _, item in scored[:top_n]]


async def list_items(
    db: AsyncSession,
    user_id: str,
    limit: int = 50,
) -> List[KnowledgeItem]:
    result = await db.execute(
        select(KnowledgeItem)
        .where(KnowledgeItem.user_id == user_id)
        .order_by(desc(KnowledgeItem.saved_at))
        .limit(limit)
    )
    return result.scalars().all()


async def get_item(
    db: AsyncSession,
    item_id: str,
    user_id: str,
) -> Optional[KnowledgeItem]:
    result = await db.execute(
        select(KnowledgeItem).where(
            KnowledgeItem.id == item_id,
            KnowledgeItem.user_id == user_id,
        )
    )
    return result.scalar_one_or_none()


async def remove_item(db: AsyncSession, item_id: str, user_id: str) -> bool:
    # Chunks cascade via FK (set up in migration); delete item
    result = await db.execute(
        delete(KnowledgeItem).where(
            KnowledgeItem.id == item_id,
            KnowledgeItem.user_id == user_id,
        )
    )
    await db.commit()
    return result.rowcount > 0


def format_for_context(results: List[dict]) -> str:
    if not results:
        return "No relevant knowledge found."
    lines = []
    for r in results:
        item = r["item"]
        chunk = r["chunk"]
        title = item.source_title or item.type
        text = chunk.content if chunk else (item.summary or "")
        lines.append(f"[{title}]\n{text}")
    return "\n\n".join(lines)
