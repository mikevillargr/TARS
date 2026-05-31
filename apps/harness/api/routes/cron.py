from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from core.auth import require_auth

router = APIRouter()


@router.get("")
async def list_cron(_: str = Depends(require_auth)):
    from jobs.scheduler import get_jobs
    return {"items": get_jobs()}


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
