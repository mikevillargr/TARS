from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
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


class CreateMemoryRequest(BaseModel):
    content: str
    domain: str = "work"
    source: str = "manual"
    importance: int = 3


class SearchRequest(BaseModel):
    query: str
    limit: int = 10
    domain: Optional[str] = None


@router.get("/memories", response_model=List[MemoryOut])
async def list_memories(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await mnemon.list_recent(db, user_id)


@router.post("/memories", response_model=MemoryOut, status_code=201)
async def create_memory(
    body: CreateMemoryRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await mnemon.write(
        db, user_id, body.content,
        domain=body.domain, source=body.source, importance=body.importance,
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


@router.post("/search", response_model=List[MemoryOut])
async def search_memories(
    body: SearchRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return await mnemon.search(db, user_id, body.query, limit=body.limit, domain=body.domain)
