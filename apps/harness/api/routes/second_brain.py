from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from memory import second_brain

router = APIRouter()


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


class SearchRequest(BaseModel):
    query: str
    limit: int = 5


class SearchResultOut(BaseModel):
    item_id: str
    item_title: Optional[str]
    item_type: str
    chunk_content: Optional[str]
    url: Optional[str]


@router.get("/items", response_model=List[KnowledgeItemOut])
async def list_items(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await second_brain.list_items(db, user_id)


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
