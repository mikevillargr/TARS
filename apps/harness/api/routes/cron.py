"""
Cron Manager API

Connector jobs: interval-based, in-memory registry (fireflies_sync etc.)
Prompt jobs:    wall-clock scheduled, stored in DB, run by prompt_cron_loop
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.auth import require_auth
from db.models import CronJob
from db.session import get_db

router = APIRouter()

_VALID_INTERVALS = {300, 900, 1800, 3600, 14400, 43200, 86400, 604800}


# ─── Connector job endpoints (in-memory registry) ─────────────────────────────

class ConnectorCronUpdate(BaseModel):
    interval_sec: int


@router.get("/connector-jobs")
async def list_connector_jobs(_: str = Depends(require_auth)):
    from jobs.scheduler import get_jobs
    return {"items": get_jobs()}


@router.patch("/connector-jobs/{job_name}")
async def update_connector_job(
    job_name: str,
    body: ConnectorCronUpdate,
    _: str = Depends(require_auth),
):
    if body.interval_sec not in _VALID_INTERVALS:
        raise HTTPException(status_code=400, detail="Invalid interval")
    from jobs.scheduler import update_interval
    try:
        state = update_interval(job_name, body.interval_sec)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")
    return state.to_dict()


@router.post("/connector-jobs/{job_name}/run")
async def trigger_connector_job(
    job_name: str,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_auth),
):
    from jobs import scheduler as _sched
    if job_name not in _sched._registry:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")
    state = _sched._registry[job_name]
    JOB_FNS = {
        "fireflies_sync":     _sched._sync_fireflies,
        "google_people_sync": _sched._sync_google_people,
    }
    fn = JOB_FNS.get(job_name)
    if not fn:
        raise HTTPException(status_code=422, detail="Job has no runnable function")
    background_tasks.add_task(_sched._run_job, state, fn)
    return {"queued": job_name}


# ─── Prompt job endpoints (DB-backed) ─────────────────────────────────────────

class ScheduleConfig(BaseModel):
    frequency: str                   # daily | weekdays | weekly | biweekly | monthly
    time: str                        # "HH:MM"
    day_of_week: Optional[int] = 0   # 0=Monday … 6=Sunday


class PromptCronCreate(BaseModel):
    name: str
    prompt_text: str
    schedule_config: ScheduleConfig
    timezone: str = "Asia/Manila"
    enabled: bool = True


class PromptCronUpdate(BaseModel):
    name: Optional[str] = None
    prompt_text: Optional[str] = None
    schedule_config: Optional[ScheduleConfig] = None
    timezone: Optional[str] = None
    enabled: Optional[bool] = None


def _job_to_dict(job: CronJob) -> dict:
    from jobs.prompt_cron import human_schedule
    return {
        "id":                     job.id,
        "name":                   job.name,
        "type":                   job.type,
        "prompt_text":            job.prompt_text,
        "schedule_config":        job.schedule_config,
        "schedule_human":         human_schedule(job.schedule_config) if job.schedule_config else None,
        "timezone":               job.timezone,
        "enabled":                job.enabled,
        "last_run_at":            job.last_run_at.isoformat() if job.last_run_at else None,
        "last_run_status":        job.last_run_status,
        "next_run_at":            job.next_run_at.isoformat() if job.next_run_at else None,
        "last_output":            job.last_output,
        "output_conversation_id": job.output_conversation_id,
        "created_at":             job.created_at.isoformat() if job.created_at else None,
    }


@router.get("/prompt-jobs")
async def list_prompt_jobs(
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CronJob)
        .where(CronJob.user_id == user_id, CronJob.type == "prompt")
        .order_by(CronJob.created_at.desc())
    )
    jobs = result.scalars().all()
    return {"items": [_job_to_dict(j) for j in jobs]}


@router.post("/prompt-jobs")
async def create_prompt_job(
    body: PromptCronCreate,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    from jobs.prompt_cron import next_run_at
    sc = body.schedule_config.model_dump()
    nxt = next_run_at(sc, body.timezone, None)

    job = CronJob(
        user_id=user_id,
        name=body.name,
        type="prompt",
        prompt_text=body.prompt_text,
        schedule_config=sc,
        timezone=body.timezone,
        schedule="",
        enabled=body.enabled,
        next_run_at=nxt,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return _job_to_dict(job)


@router.patch("/prompt-jobs/{job_id}")
async def update_prompt_job(
    job_id: str,
    body: PromptCronUpdate,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CronJob).where(CronJob.id == job_id, CronJob.user_id == user_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404)

    if body.name is not None:
        job.name = body.name
    if body.prompt_text is not None:
        job.prompt_text = body.prompt_text
    if body.schedule_config is not None:
        job.schedule_config = body.schedule_config.model_dump()
    if body.timezone is not None:
        job.timezone = body.timezone
    if body.enabled is not None:
        job.enabled = body.enabled

    if job.schedule_config:
        from jobs.prompt_cron import next_run_at
        job.next_run_at = next_run_at(job.schedule_config, job.timezone or "Asia/Manila", job.last_run_at)

    await db.commit()
    await db.refresh(job)
    return _job_to_dict(job)


@router.delete("/prompt-jobs/{job_id}", status_code=204)
async def delete_prompt_job(
    job_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CronJob).where(CronJob.id == job_id, CronJob.user_id == user_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404)
    await db.delete(job)
    await db.commit()


@router.post("/prompt-jobs/{job_id}/run")
async def trigger_prompt_job(
    job_id: str,
    user_id: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CronJob).where(CronJob.id == job_id, CronJob.user_id == user_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404)
    from jobs.prompt_cron import execute
    conv_id = await execute(job_id)
    return {"conversation_id": conv_id}


# ─── Legacy fallback ──────────────────────────────────────────────────────────

@router.get("")
async def list_cron_legacy(_: str = Depends(require_auth)):
    from jobs.scheduler import get_jobs
    return {"items": get_jobs()}
