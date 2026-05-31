from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.session import get_db
from memory import mnemon

router = APIRouter()


class MemoryOut(BaseModel):
    id: str
    content: str
    domain: str
    source: str
    importance: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MemoryListOut(BaseModel):
    items: List[MemoryOut]
    total: int
    limit: int
    offset: int


class CreateMemoryRequest(BaseModel):
    content: str
    domain: str = "work"
    source: str = "manual"
    importance: int = 3


class SearchRequest(BaseModel):
    query: str
    limit: int = 20
    domain: Optional[str] = None


@router.get("/memories", response_model=MemoryListOut)
async def list_memories(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    domain: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    items, total = await mnemon.list_memories(
        db, user_id, limit=limit, offset=offset, domain=domain or None, source=source or None
    )
    return MemoryListOut(items=items, total=total, limit=limit, offset=offset)


@router.post("/memories", response_model=MemoryOut, status_code=201)
async def create_memory(
    body: CreateMemoryRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await mnemon.write(
        db, user_id, body.content,
        domain=body.domain, source=body.source, importance=body.importance,
        # Manual additions bypass dedup — user knows what they're adding
        deduplicate=False,
    )


@router.delete("/memories/{memory_id}", status_code=204)
async def delete_memory(
    memory_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    removed = await mnemon.remove(db, memory_id, user_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Memory not found")


@router.post("/memories/search", response_model=List[MemoryOut])
async def search_memories(
    body: SearchRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await mnemon.search(db, user_id, body.query, limit=body.limit, domain=body.domain)
