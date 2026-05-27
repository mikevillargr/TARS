from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import auth, health, chat, tasks, meetings, calendar
from api.routes import second_brain, agent_jobs, artifacts, email_digest
from api.routes import cron, connectors, memory
from core.config import settings

app = FastAPI(
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
