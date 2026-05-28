import asyncio
import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auth, health, chat, tasks, meetings, calendar
from api.routes import second_brain, agent_jobs, artifacts, email_digest
from api.routes import cron, connectors, memory
from api.routes import settings as settings_route
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
    """
    from core.router import _ollama_mark_failed, _ollama_mark_recovered

    if not settings.ollama_url:
        return

    await asyncio.sleep(5)   # let Ollama finish initialising after harness starts

    while True:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
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
            _ollama_mark_recovered()
            await asyncio.sleep(_KEEPALIVE_HEALTHY_INTERVAL)
        except Exception as exc:
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

    # Start Ollama keepalive — warms model on startup, recovers backoff after restarts
    keepalive_task = asyncio.create_task(_ollama_keepalive())

    yield

    keepalive_task.cancel()
    try:
        await keepalive_task
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
app.include_router(email_digest.router, prefix="/api/email-digest")
app.include_router(cron.router, prefix="/api/cron")
app.include_router(connectors.router, prefix="/api/connectors")
app.include_router(memory.router, prefix="/api/memory")
app.include_router(settings_route.router, prefix="/api/settings")
