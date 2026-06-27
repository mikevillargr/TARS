"""
Agent Jobs API — CRUD + WebSocket live stream.

WebSocket endpoint connects directly from the frontend to the harness on :8000.
Auth is via ?token=<jwt> query param (standard Bearer header not available on WS upgrade).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.websockets import WebSocketState
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth, verify_ws_token
from db.models import AgentJob
from db.session import get_db, AsyncSessionLocal
import agents.job_manager as job_manager
import agents.approval as approval
import agents.approval as question_gate  # same module, aliased for clarity

log = logging.getLogger(__name__)

router = APIRouter()

TARS_REPO = "/Users/mike/Documents/TARS"


# ── Pydantic schemas ───────────────────────────────────────────────────────────

class CreateJobRequest(BaseModel):
    instruction: str
    agent_type: str = "backend"
    conversation_id: Optional[str] = None
    model_config_json: Optional[dict] = None
    # branch is always "dev" for Phase 1 — any other value is rejected


class JobResponse(BaseModel):
    id: str
    agent_type: str
    instruction: str
    status: str
    branch: str
    pr_url: Optional[str]
    parent_job_id: Optional[str]
    conversation_id: Optional[str]
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]

    @classmethod
    def from_orm(cls, row: AgentJob) -> "JobResponse":
        return cls(
            id=row.id,
            agent_type=row.agent_type,
            instruction=row.instruction,
            status=row.status,
            branch=row.branch,
            pr_url=row.pr_url,
            parent_job_id=row.parent_job_id,
            conversation_id=row.conversation_id,
            created_at=row.created_at.isoformat(),
            started_at=row.started_at.isoformat() if row.started_at else None,
            completed_at=row.completed_at.isoformat() if row.completed_at else None,
        )


class ApproveRequest(BaseModel):
    approved: bool
    modified_command: Optional[str] = None


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("")
async def list_agent_jobs(
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    q = select(AgentJob).where(AgentJob.user_id == user_id).order_by(desc(AgentJob.created_at))
    if status_filter:
        q = q.where(AgentJob.status == status_filter)
    q = q.offset(offset).limit(limit)
    rows = (await db.execute(q)).scalars().all()
    return {"items": [JobResponse.from_orm(r) for r in rows]}


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_agent_job(
    body: CreateJobRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    valid_types = {"frontend", "backend", "sa", "release"}
    if body.agent_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"agent_type must be one of {sorted(valid_types)}")

    row = AgentJob(
        user_id=user_id,
        agent_type=body.agent_type,
        type="agent",
        instruction=body.instruction,
        repo_path=TARS_REPO,
        branch="main",
        status="pending",
        conversation_id=body.conversation_id,
        model_config_json=body.model_config_json or {},
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    # Start the job as a background task
    await job_manager.start_job(row.id, AsyncSessionLocal)

    return JobResponse.from_orm(row)


@router.get("/{job_id}")
async def get_agent_job(
    job_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_job(job_id, user_id, db)
    return JobResponse.from_orm(row)


@router.post("/{job_id}/cancel")
async def cancel_agent_job(
    job_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_job(job_id, user_id, db)
    if row.status not in ("pending", "running", "awaiting_approval"):
        raise HTTPException(status_code=400, detail="Job is not cancellable in its current state")

    job_manager.cancel_job(job_id)
    row.status = "cancelled"
    await db.commit()
    return {"ok": True}


@router.post("/{job_id}/approve")
async def approve_agent_job(
    job_id: str,
    body: ApproveRequest,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _get_job(job_id, user_id, db)
    approval.resolve(job_id, body.approved, body.modified_command)
    return {"ok": True}


@router.websocket("/{job_id}/stream")
async def stream_agent_job(
    job_id: str,
    websocket: WebSocket,
    token: str = Query(...),
):
    user_id = verify_ws_token(token)
    if not user_id:
        await websocket.close(code=4401)
        return

    # Verify job belongs to this user
    async with AsyncSessionLocal() as db:
        row = (await db.execute(select(AgentJob).where(AgentJob.id == job_id))).scalar_one_or_none()
        if not row or row.user_id != user_id:
            await websocket.close(code=4404)
            return

    await websocket.accept()

    async def send_fn(event: dict) -> None:
        if websocket.client_state == WebSocketState.CONNECTED:
            await websocket.send_json(event)

    job_manager.subscribe(job_id, send_fn)

    try:
        while websocket.client_state == WebSocketState.CONNECTED:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30)
            except TimeoutError:
                # Send ping to keep connection alive
                await websocket.send_json({"type": "ping"})
                continue

            msg_type = data.get("type")

            if msg_type == "approval_response":
                approval.resolve(
                    job_id,
                    approved=data.get("approved", False),
                    modified_command=data.get("modified_command"),
                )

            elif msg_type == "question_response":
                question_gate.resolve_question(job_id, data.get("answer", ""))

            elif msg_type == "stop":
                job_manager.cancel_job(job_id)

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        log.warning("WS error for job %s: %s", job_id, exc)
    finally:
        job_manager.unsubscribe(job_id, send_fn)


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_job(job_id: str, user_id: str, db: AsyncSession) -> AgentJob:
    row = (await db.execute(
        select(AgentJob).where(AgentJob.id == job_id, AgentJob.user_id == user_id)
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    return row


import asyncio  # noqa: E402 — placed at bottom to avoid circular on module load
