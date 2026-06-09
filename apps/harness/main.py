import asyncio
import logging
from contextlib import asynccontextmanager

# Ensure job/scheduler logs are visible in pm2 output
logging.basicConfig(level=logging.INFO, format="%(levelname)s: [%(name)s] %(message)s")
logging.getLogger("jobs").setLevel(logging.INFO)

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auth, health, chat, tasks, meetings, calendar
from api.routes import second_brain, agent_jobs, artifacts
from api.routes import cron, connectors, memory, contacts
from api.routes import settings as settings_route
from api.routes import email as email_route
from api.routes import preview as preview_route
from api.routes import domains as domains_route
from api.routes import image_proxy as image_proxy_route
from api.routes import search as search_route
from api.routes import transcribe as transcribe_route
from api.routes import notifications as notifications_route
from core.config import settings

log = logging.getLogger(__name__)

# How often to ping Ollama when healthy — keeps llama3.2:3b warm in memory.
# OLLAMA_KEEP_ALIVE=-1 is set in the systemd unit so the model is never evicted,
# but we still ping to detect outages early and to warm the model after harness restart.
_KEEPALIVE_HEALTHY_INTERVAL = 240   # 4 min (before Ollama's default 5-min eviction)
_KEEPALIVE_RECOVERY_INTERVAL = 30   # retry every 30s when Ollama is down


async def _ollama_keepalive() -> None:
    """
    Keep llama3.2:3b warm and auto-clear the classifier backoff when Ollama recovers.
    Runs as a background task for the lifetime of the harness process.

    Three states:
    - Healthy: 10s timeout, 240s between pings (model warm, sub-second response)
    - Model cold: 60s timeout, 30s retry (5xx returned — model may have been ejected;
                  classifier stays active, but we give the model time to reload)
    - Truly down: 60s timeout, 30s retry (connection error — classifier enters backoff)
    """
    from core.router import _ollama_mark_failed, _ollama_mark_recovered, _ollama_available

    if not settings.ollama_url:
        return

    await asyncio.sleep(5)   # let Ollama finish initialising after harness starts

    # Tracks whether we've had a recent 5xx (model may be cold, need longer timeout).
    # Separate from the classifier backoff — Ollama is reachable but model is reloading.
    _model_may_be_cold = False

    while True:
        # Classifier is in backoff OR model may be cold → use 60s (handles ~40s cold-load).
        # Otherwise → 10s is plenty (warm model responds in <1s).
        classifier_down = not _ollama_available()
        timeout = 60.0 if (classifier_down or _model_may_be_cold) else 10.0

        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(
                    f"{settings.ollama_url}/api/chat",
                    json={
                        "model": settings.classifier_model,
                        "messages": [{"role": "user", "content": "ping"}],
                        "stream": False,
                        "options": {"num_predict": 1, "temperature": 0},
                    },
                )
                resp.raise_for_status()
            # Success — model is warm and Ollama is healthy.
            _model_may_be_cold = False
            _ollama_mark_recovered()
            await asyncio.sleep(_KEEPALIVE_HEALTHY_INTERVAL)

        except httpx.HTTPStatusError as exc:
            # Ollama is reachable but returned 5xx — transient error (race condition
            # during model unload/reload). Don't mark the classifier unavailable;
            # flag model as cold so the next ping uses the longer timeout.
            _model_may_be_cold = True
            log.warning("Ollama returned %s — model may be cold, retrying in %ds",
                        exc.response.status_code, _KEEPALIVE_RECOVERY_INTERVAL)
            await asyncio.sleep(_KEEPALIVE_RECOVERY_INTERVAL)

        except Exception as exc:
            # Connection error or timeout — Ollama is genuinely down.
            _model_may_be_cold = True   # also flag cold: first request after recovery needs time
            _ollama_mark_failed()
            log.warning("Ollama keepalive failed (%s) — retrying in %ds",
                        exc, _KEEPALIVE_RECOVERY_INTERVAL)
            await asyncio.sleep(_KEEPALIVE_RECOVERY_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-load the embedding model so first ingest/search isn't slow
    try:
        from memory.embeddings import _get_model
        _get_model()
        log.info("Embedding model loaded")
    except Exception as e:
        log.warning("Embedding model preload failed: %s", e)

    # On restart: re-queue interrupted root jobs, mark orphaned children as failed.
    try:
        from db.session import AsyncSessionLocal
        from db.models import AgentJob
        from agents import job_manager
        from sqlalchemy import select, update

        async with AsyncSessionLocal() as db:
            # Find all interrupted jobs
            stale = (await db.execute(
                select(AgentJob).where(AgentJob.status.in_(["running", "awaiting_approval"]))
            )).scalars().all()

            requeued = 0
            for job in stale:
                if job.parent_job_id is None:
                    # Root job — re-queue it so it runs again
                    job.status = "pending"
                    job.output = None
                    job.started_at = None
                    job.completed_at = None
                    requeued += 1
                else:
                    # Child job — mark failed, parent will be re-run
                    job.status = "failed"
                    job.output = "Harness restarted — parent job will re-run."

            await db.commit()
            log.info("Restart cleanup: %d root jobs re-queued, %d child jobs failed",
                     requeued, len(stale) - requeued)

        # Start all re-queued root jobs
        async with AsyncSessionLocal() as db:
            pending = (await db.execute(
                select(AgentJob).where(AgentJob.status == "pending")
            )).scalars().all()
            for job in pending:
                await job_manager.start_job(job.id, AsyncSessionLocal)
                log.info("Re-queued job %s (%s) started", job.id[:8], job.agent_type)

    except Exception as e:
        log.warning("Stale job cleanup/re-queue failed: %s", e)

    # Start Ollama keepalive — warms model on startup, recovers backoff after restarts
    keepalive_task = asyncio.create_task(_ollama_keepalive())

    # Start scheduled cron jobs (Fireflies sync, etc.)
    from jobs.scheduler import build_tasks
    cron_tasks = build_tasks()

    yield

    # ── Shutdown: mark in-flight agent jobs as pending so they resume on restart
    # Without this, asyncio kills running tasks on SIGTERM, the CancelledError
    # handler stamps them "cancelled", and the re-queue logic that only picks
    # up "running"/"awaiting_approval" misses them — leaving the user with a
    # job that never completes and no PR/deploy.
    try:
        from agents import job_manager as _jm
        active_ids = list(_jm._tasks.keys())
        if active_ids:
            log.info("Shutdown: %d active agent task(s) — marking pending for re-queue on next start", len(active_ids))
            from db.session import AsyncSessionLocal
            from db.models import AgentJob
            from sqlalchemy import update
            async with AsyncSessionLocal() as db:
                await db.execute(
                    update(AgentJob)
                    .where(AgentJob.id.in_(active_ids))
                    .values(
                        status="pending",
                        started_at=None,
                        output=None,
                        completed_at=None,
                    )
                )
                await db.commit()
            # Tell job_manager: subsequent CancelledError handlers in _run_job
            # should NOT override the "pending" status we just set.
            _jm._shutdown_requested = True
            # Give a short window for any in-flight DB writes to finish
            await asyncio.sleep(2)
    except Exception as exc:
        log.warning("Shutdown agent re-queue failed: %s", exc)

    keepalive_task.cancel()
    for t in cron_tasks:
        t.cancel()
    for t in [keepalive_task, *cron_tasks]:
        try:
            await t
        except asyncio.CancelledError:
            pass


app = FastAPI(
    lifespan=lifespan,
    title="TARS Harness",
    version="0.1.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router, prefix="/api/auth")
app.include_router(chat.router, prefix="/api/chat")
app.include_router(tasks.router, prefix="/api/tasks")
app.include_router(meetings.router, prefix="/api/meetings")
app.include_router(calendar.router, prefix="/api/calendar")
app.include_router(second_brain.router, prefix="/api/second-brain")
app.include_router(agent_jobs.router, prefix="/api/agent-jobs")
app.include_router(artifacts.router, prefix="/api/artifacts")
app.include_router(cron.router, prefix="/api/cron")
app.include_router(connectors.router, prefix="/api/connectors")
app.include_router(email_route.router, prefix="/api/email")
app.include_router(memory.router, prefix="/api/memory")
app.include_router(contacts.router, prefix="/api/contacts")
app.include_router(settings_route.router, prefix="/api/settings")
app.include_router(preview_route.router, prefix="/api")
app.include_router(search_route.router, prefix="/api/search")
app.include_router(transcribe_route.router, prefix="/api")
app.include_router(notifications_route.router, prefix="/api/notifications")
app.include_router(domains_route.router, prefix="/api/domains")
app.include_router(image_proxy_route.router, prefix="/api")
