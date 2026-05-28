import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auth, health, chat, tasks, meetings, calendar
from api.routes import second_brain, agent_jobs, artifacts, email_digest
from api.routes import cron, connectors, memory, settings
from core.config import settings

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Pre-load the embedding model so first ingest/search isn't slow
    try:
        from memory.embeddings import _get_model
        _get_model()
        log.info("Embedding model loaded")
    except Exception as e:
        log.warning("Embedding model preload failed: %s", e)
    yield


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
app.include_router(settings.router, prefix="/api/settings")
