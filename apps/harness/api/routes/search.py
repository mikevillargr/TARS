"""
Global search — fans out across tasks, artifacts, meetings, conversations,
and second-brain knowledge items and returns grouped results.
"""

from __future__ import annotations

import logging
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, or_, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from db.session import get_db
from db.models import Task, Artifact, Meeting, Conversation, KnowledgeItem
from core.auth import require_auth
from memory import second_brain as sb

log = logging.getLogger(__name__)
router = APIRouter()


# ── Response models ──────────────────────────────────────────────────────────

class SearchResult(BaseModel):
    id: str
    type: str           # task | artifact | meeting | conversation | knowledge
    title: str
    subtitle: Optional[str] = None
    href: str           # in-app navigation target
    created_at: Optional[datetime] = None
    meta: Optional[str] = None   # status / type badge text


class SearchResponse(BaseModel):
    query: str
    tasks: List[SearchResult] = []
    artifacts: List[SearchResult] = []
    meetings: List[SearchResult] = []
    conversations: List[SearchResult] = []
    knowledge: List[SearchResult] = []


# ── Endpoint ─────────────────────────────────────────────────────────────────

@router.get("", response_model=SearchResponse)
async def global_search(
    q: str = Query(default="", max_length=200),
    limit: int = Query(default=5, le=10),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """
    When q is empty  → returns recent items from each section (suggestions mode).
    When q has text  → text match on structured data + semantic search for knowledge.
    """
    q_stripped = q.strip()
    ql = q_stripped.lower()

    # ── Tasks ────────────────────────────────────────────────────────────────
    task_q = select(Task).where(Task.user_id == user_id)
    if ql:
        task_q = task_q.where(
            or_(
                func.lower(Task.title).contains(ql),
                func.lower(Task.description).contains(ql),
            )
        )
    task_q = task_q.order_by(desc(Task.updated_at)).limit(limit)
    tasks = (await db.execute(task_q)).scalars().all()

    # ── Artifacts ────────────────────────────────────────────────────────────
    artifact_q = select(Artifact).where(Artifact.user_id == user_id)
    if ql:
        artifact_q = artifact_q.where(
            func.lower(Artifact.filename).contains(ql)
        )
    artifact_q = artifact_q.order_by(desc(Artifact.created_at)).limit(limit)
    artifacts = (await db.execute(artifact_q)).scalars().all()

    # ── Meetings ─────────────────────────────────────────────────────────────
    meeting_q = select(Meeting).where(Meeting.user_id == user_id)
    if ql:
        meeting_q = meeting_q.where(
            or_(
                func.lower(Meeting.title).contains(ql),
                func.lower(Meeting.summary).contains(ql),
            )
        )
    meeting_q = meeting_q.order_by(desc(Meeting.created_at)).limit(limit)
    meetings = (await db.execute(meeting_q)).scalars().all()

    # ── Conversations ────────────────────────────────────────────────────────
    conv_q = select(Conversation).where(Conversation.user_id == user_id)
    if ql:
        conv_q = conv_q.where(
            func.lower(Conversation.title).contains(ql)
        )
    conv_q = conv_q.order_by(desc(Conversation.created_at)).limit(limit)
    conversations = (await db.execute(conv_q)).scalars().all()

    # ── Knowledge (Second Brain) ──────────────────────────────────────────────
    knowledge_results: List[SearchResult] = []
    if ql:
        try:
            raw = await sb.search(db, user_id, ql, limit=limit)
            for r in raw:
                item = r["item"]
                chunk = r.get("chunk")
                snippet = (chunk.content[:100] if chunk else (item.summary or "")[:100]).strip()
                knowledge_results.append(SearchResult(
                    id=item.id,
                    type="knowledge",
                    title=item.source_title or item.url or "Untitled",
                    subtitle=snippet or None,
                    href="/second-brain",
                    created_at=item.saved_at,
                    meta=item.type,
                ))
        except Exception:
            log.exception("Knowledge search failed")
    else:
        ki_q = (
            select(KnowledgeItem)
            .where(KnowledgeItem.user_id == user_id)
            .order_by(desc(KnowledgeItem.saved_at))
            .limit(limit)
        )
        for item in (await db.execute(ki_q)).scalars().all():
            knowledge_results.append(SearchResult(
                id=item.id,
                type="knowledge",
                title=item.source_title or item.url or "Untitled",
                subtitle=(item.summary or "")[:100].strip() or None,
                href="/second-brain",
                created_at=item.saved_at,
                meta=item.type,
            ))

    # ── Build response ────────────────────────────────────────────────────────
    return SearchResponse(
        query=q_stripped,
        tasks=[
            SearchResult(
                id=t.id,
                type="task",
                title=t.title,
                subtitle=(t.description or "")[:80].strip() or None,
                href="/tasks",
                created_at=t.created_at,
                meta=t.status,
            )
            for t in tasks
        ],
        artifacts=[
            SearchResult(
                id=a.id,
                type="artifact",
                title=a.filename,
                subtitle=f"{a.type} · {a.source}",
                href=f"/artifacts?id={a.id}",
                created_at=a.created_at,
                meta=a.type,
            )
            for a in artifacts
        ],
        meetings=[
            SearchResult(
                id=m.id,
                type="meeting",
                title=m.title,
                subtitle=(m.summary or "")[:80].strip() or None,
                href="/meetings",
                created_at=m.created_at,
                meta=m.status,
            )
            for m in meetings
        ],
        conversations=[
            SearchResult(
                id=c.id,
                type="conversation",
                title=c.title or "Untitled conversation",
                subtitle=None,
                href=f"/chat/{c.id}",
                created_at=c.created_at,
            )
            for c in conversations
        ],
        knowledge=knowledge_results,
    )
