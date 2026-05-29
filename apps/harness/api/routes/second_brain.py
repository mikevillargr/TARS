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
