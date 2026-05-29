from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from db.models import KnowledgeItem, DocumentChunk
from memory import second_brain

router = APIRouter()


# ─── Response models ──────────────────────────────────────────────────────────

class KnowledgeItemOut(BaseModel):
    id: str
    type: str
    url: Optional[str]
    source_title: Optional[str]
    source_author: Optional[str]
    summary: Optional[str]
    personal_note: Optional[str]
    tags: list
    domain: Optional[str]
    access_count: int
    saved_at: datetime

    class Config:
        from_attributes = True


class KnowledgeItemDetailOut(KnowledgeItemOut):
    """Full detail — includes content and chunk count. Used for the detail panel."""
    clean_content: Optional[str] = None
    chunk_count: int = 0


class IngestUrlRequest(BaseModel):
    url: str
    personal_note: str = ""
    tags: List[str] = []
    domain: str = "work"


class IngestTextRequest(BaseModel):
    content: str
    title: str = ""
    personal_note: str = ""
    tags: List[str] = []
    domain: str = "work"


class UpdateItemRequest(BaseModel):
    source_title: Optional[str] = None
    personal_note: Optional[str] = None
    tags: Optional[List[str]] = None
    domain: Optional[str] = None
    clean_content: Optional[str] = None   # document content edit — triggers re-embed + re-chunk


class IngestDocumentRequest(BaseModel):
    content: str
    title: str = ""
    personal_note: str = ""
    tags: List[str] = []
    domain: str = "work"


class EnhanceRequest(BaseModel):
    selected_text: str
    action: str  # "improve"|"shorten"|"expand"|"rephrase"|"continue"|"custom"
    custom_prompt: Optional[str] = None
    document_context: Optional[str] = None


class SearchRequest(BaseModel):
    query: str
    limit: int = 5


class SearchResultOut(BaseModel):
    item_id: str
    item_title: Optional[str]
    item_type: str
    chunk_content: Optional[str]
    url: Optional[str]
    chunk_index: Optional[int] = None


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.get("/items", response_model=List[KnowledgeItemOut])
async def list_items(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await second_brain.list_items(db, user_id)


@router.get("/items/{item_id}", response_model=KnowledgeItemDetailOut)
async def get_item(
    item_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    item = await second_brain.get_item(db, item_id, user_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Count chunks
    count_result = await db.execute(
        select(func.count(DocumentChunk.id)).where(
            DocumentChunk.knowledge_item_id == item_id
        )
    )
    chunk_count = count_result.scalar() or 0

    return KnowledgeItemDetailOut(
        id=item.id,
        type=item.type,
        url=item.url,
        source_title=item.source_title,
        source_author=item.source_author,
        summary=item.summary,
        personal_note=item.personal_note,
        tags=item.tags or [],
        domain=item.domain,
        access_count=item.access_count,
        saved_at=item.saved_at,
        clean_content=item.clean_content,
        chunk_count=chunk_count,
    )


@router.patch("/items/{item_id}", response_model=KnowledgeItemDetailOut)
async def update_item(
    item_id: str,
    body: UpdateItemRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    item = await second_brain.get_item(db, item_id, user_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if body.source_title is not None:
        item.source_title = body.source_title
    if body.personal_note is not None:
        item.personal_note = body.personal_note
    if body.tags is not None:
        item.tags = body.tags
    if body.domain is not None:
        item.domain = body.domain
    if body.clean_content is not None:
        from sqlalchemy import delete as _delete
        from memory.embeddings import embed_one, embed
        from memory.chunker import chunk_text
        item.clean_content = body.clean_content
        item.raw_content = body.clean_content
        # Re-compute item-level embedding
        summary_text = " ".join(body.clean_content.split()[:800])
        item.embedding = embed_one(summary_text) if summary_text else None
        item.summary = summary_text[:500] if summary_text else None
        # Delete old chunks and re-chunk
        await db.execute(
            _delete(DocumentChunk).where(DocumentChunk.knowledge_item_id == item_id)
        )
        chunks = chunk_text(body.clean_content)
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

    count_result = await db.execute(
        select(func.count(DocumentChunk.id)).where(
            DocumentChunk.knowledge_item_id == item_id
        )
    )
    chunk_count = count_result.scalar() or 0

    return KnowledgeItemDetailOut(
        id=item.id,
        type=item.type,
        url=item.url,
        source_title=item.source_title,
        source_author=item.source_author,
        summary=item.summary,
        personal_note=item.personal_note,
        tags=item.tags or [],
        domain=item.domain,
        access_count=item.access_count,
        saved_at=item.saved_at,
        clean_content=item.clean_content,
        chunk_count=chunk_count,
    )


@router.post("/ingest/url", response_model=KnowledgeItemOut, status_code=201)
async def ingest_url(
    body: IngestUrlRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    try:
        item = await second_brain.ingest_url(
            db, user_id, body.url,
            personal_note=body.personal_note,
            tags=body.tags,
            domain=body.domain,
        )
        return item
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"Ingest failed: {e}")


@router.post("/ingest/text", response_model=KnowledgeItemOut, status_code=201)
async def ingest_text(
    body: IngestTextRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    item = await second_brain.ingest_text(
        db, user_id, body.content,
        title=body.title,
        personal_note=body.personal_note,
        tags=body.tags,
        domain=body.domain,
    )
    return item


@router.post("/ingest/document", response_model=KnowledgeItemOut, status_code=201)
async def ingest_document(
    body: IngestDocumentRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    item = await second_brain.ingest_document(
        db, user_id, body.content,
        title=body.title,
        personal_note=body.personal_note,
        tags=body.tags,
        domain=body.domain,
    )
    return item


@router.post("/ai/enhance")
async def ai_enhance(
    body: EnhanceRequest,
    user_id: str = Depends(require_auth),
):
    from fastapi.responses import StreamingResponse
    import anthropic as _anthropic
    from core.config import settings
    from core.streaming import sse_event, sse_done

    action_prompts = {
        "improve": "Improve the clarity, flow, and impact of this text. Keep approximately the same length and preserve the core meaning.",
        "shorten": "Shorten this text significantly while preserving the key points.",
        "expand": "Expand this text with more detail, context, or examples. Keep the same style.",
        "rephrase": "Rephrase this text in a different way while keeping the exact same meaning.",
        "continue": "Continue writing from where this text ends. Match the style, tone, and context.",
        "custom": body.custom_prompt or "Rewrite this text to be better.",
    }

    system_prompt = (
        "You are a precise writing assistant. "
        "Return ONLY the replacement text — no preamble, no explanation, no surrounding quotes. "
        "Preserve markdown formatting (bold, headers, lists, etc.) where present."
    )

    context_block = (
        f"\n\nDocument context (for reference only — do not reproduce it):\n{body.document_context[:1500]}"
        if body.document_context else ""
    )
    user_message = (
        f"{action_prompts[body.action]}\n\n"
        f"Text:\n{body.selected_text}"
        f"{context_block}"
    )

    async def generate():
        try:
            client = _anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
            async with client.messages.stream(
                model=settings.tier1_model,
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            ) as stream:
                async for text in stream.text_stream:
                    yield sse_event({"type": "chunk", "text": text})
        except Exception as exc:
            yield sse_event({"type": "error", "message": str(exc)})
        finally:
            yield sse_done()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/search", response_model=List[SearchResultOut])
async def search(
    body: SearchRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    results = await second_brain.search(db, user_id, body.query, limit=body.limit)
    return [
        SearchResultOut(
            item_id=r["item"].id,
            item_title=r["item"].source_title,
            item_type=r["item"].type,
            chunk_content=r["chunk"].content if r["chunk"] else r["item"].summary,
            chunk_index=r["chunk"].chunk_index if r["chunk"] else None,
            url=r["item"].url,
        )
        for r in results
    ]


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    removed = await second_brain.remove_item(db, item_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Item not found")
