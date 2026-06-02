from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from core.auth import require_auth

router = APIRouter()

_VALID_INTERVALS = {300, 900, 1800, 3600, 14400, 43200, 86400, 604800}


class CronUpdate(BaseModel):
    interval_sec: int


@router.get("")
async def list_cron(_: str = Depends(require_auth)):
    from jobs.scheduler import get_jobs
    return {"items": get_jobs()}


@router.patch("/{job_name}")
async def update_cron(
    job_name: str,
    body: CronUpdate,
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


@router.post("/{job_name}/run")
async def trigger_job(
    job_name: str,
    background_tasks: BackgroundTasks,
    _: str = Depends(require_auth),
):
    """Manually trigger a scheduled job immediately."""
    from jobs import scheduler as _sched

    if job_name not in _sched._registry:
        raise HTTPException(status_code=404, detail=f"Job '{job_name}' not found")

    state = _sched._registry[job_name]

    # Map job name → coroutine function
    JOB_FNS = {
        "fireflies_sync": _sched._sync_fireflies,
    }
    fn = JOB_FNS.get(job_name)
    if not fn:
        raise HTTPException(status_code=422, detail="Job has no runnable function")

    background_tasks.add_task(_sched._run_job, state, fn)
    return {"queued": job_name}
