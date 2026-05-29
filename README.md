# TARS

Personal AI operating system for Mike Villar. Direct, efficient, humor setting 75%.

Built on Next.js 15 + FastAPI with a three-tier model routing architecture — local Ollama for fast tasks, Claude for anything that matters.

---

## What it does

**Chat** — Streaming AI assistant with full markdown rendering, SVG/code display, inline text selection actions (highlight anything → Copy, Task, Second Brain, Calendar, Open URL, Compose email).

**Tasks** — Kanban board (Inbox → Todo → In Progress → Done → Snoozed). Auto-extracted from meetings and emails. Bulk creation from chat responses.

**Meetings** — Fireflies.ai integration. Transcripts, AI-generated summaries, action item extraction with one-click task creation. Auto-syncs every 4 hours.

**Calendar** — Google Calendar sync. Month/Week/Day views. Event types colour-coded by source (meeting, task, cron job, agent job).

**Second Brain** — Semantic knowledge store. Ingest URLs, notes, and documents. Two-stage RAG retrieval (item-level → chunk-level) with pgvector cosine similarity search.

**Agent Jobs** — Claude Code subprocess executor with supervised approval flow for agentic tasks.

**Artifacts** — Auto-saved library of every file TARS generates — documents, code, reports, transcripts. Versioned, searchable, re-loadable into chat.

**Email Digest** — Gmail integration. Summarised digests with extracted action items on a configurable schedule.

**Cron Manager** — UI for all scheduled background jobs. Live status, run history, manual trigger.

**Connectors** — Google Calendar, Gmail, Fireflies. Standard base interface — adding new connectors is a single file.

**Memory Browser** — Episodic memory layer (Mnemon). Browse, search, edit, and manually add memories. Injected into every chat turn.

---

## Architecture

```
Request
  │
  ├─ Llama 3.2 3B classifier (local, ~100ms)
  │
  ├─ Tier 1 (simple)  → Claude Haiku  (~500ms)
  ├─ Tier 2 (most)    → Qwen3 32B via Ollama/RunPod  (~2-4s)
  └─ Tier 3 (frontier)→ Claude Sonnet/Opus via Anthropic API  (~3-8s)
```

**Stack**

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 PWA + Tailwind |
| Backend | FastAPI (Python) |
| Database | PostgreSQL + pgvector |
| Memory | Mnemon (episodic) + Second Brain (semantic) |
| Local inference | Ollama on server |
| Frontier | Anthropic API |
| Process manager | pm2 |
| Reverse proxy | Nginx |

---

## Running locally

```bash
# Start Postgres + Redis
docker compose up -d postgres redis

# Harness
cd apps/harness
cp .env.example .env   # fill in your keys
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Web
cd apps/web
npm install
npm run dev
```

Web: http://localhost:3000 · Harness: http://localhost:8000/docs

---

## Environment variables

See `.env.example` at the repo root. Required at minimum:

```
ANTHROPIC_API_KEY=
DATABASE_URL=postgresql://...
JWT_SECRET=
TARS_PASSWORD_HASH=   # bcrypt hash of your password
```

Generate a password hash:
```bash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())"
```

---

## Versioning

This project uses [Semantic Versioning](https://semver.org). All releases are tagged and accompanied by release notes on GitHub.

- **MAJOR** — breaking changes or major new capability
- **MINOR** — new features, backward compatible
- **PATCH** — bug fixes only

Current: **v1.0.0**

---

## Deployment

Production runs on a single Hostinger KVM4 (4 vCPU / 16GB RAM) at `72.60.234.180`.

Deployments are triggered manually via the release process — push to `main` with a version tag kicks off GitHub Actions which SSH deploys and runs a health check.

Never push directly to `main`. All development happens on `dev`.
