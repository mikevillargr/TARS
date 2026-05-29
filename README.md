# TARS

Personal AI operating system for Mike Villar. Direct, efficient, humor setting 75%.

Built on Next.js 15 + FastAPI with a three-tier model routing architecture. Every module is live and connected.

---

## What it does

### Chat
Streaming AI assistant with full tool use. Renders markdown, code with syntax highlighting, SVG diagrams, and Mermaid flowcharts inline. Inline text selection toolbar — highlight anything to Copy, Create Task, Save to Second Brain, Add to Calendar, Open URL, or Compose email. Tool calls surface as chips mid-message. Conversation list with auto-generated titles, focus mode, and file/image attachment support.

### Tasks
Kanban board across five columns: Inbox → Todo → In Progress → Done → Snoozed. Cards show source badge, priority colour bar, due date, and connector sync indicator. Right-panel detail with full description, activity log, and inline editing. Bulk actions, quick-add, filter/sort bar. Tasks are auto-extracted from meetings and emails, and creatable from chat, artifacts, and Second Brain items.

### Meetings
Fireflies.ai integration. Lists all meetings with status badges (Processing / Ready / Action Required). Detail view has Summary, Transcript (speaker labels + timestamps), and Actions tabs. Action items show suggested owners and due dates with one-click task creation. Auto-syncs every 4 hours via cron.

### Calendar
Google Calendar sync. Month/Week/Day views (week default). Events colour-coded by type — meetings, tasks with due dates, cron jobs, agent jobs. Mini month picker sidebar, Today button. Click any event to open the detail panel.

### Second Brain
Semantic knowledge store backed by pgvector. Two-stage RAG retrieval: item-level cosine similarity → chunk-level reranking within matched documents. Ingests:

- **URLs** — trafilatura extraction + AI summary
- **Notes** — plain text with tags and domain
- **Documents** — Tiptap WYSIWYG editor with rich text (headings, lists, code, links, images, inline AI)
- **Files** — PDF, DOCX, PPTX, XLSX, images (via upload)

Quick Capture supports URL and Document modes. Document items open in a full editable modal; URL/note/meeting items open read-only. AI BubbleMenu on selected text: Improve / Shorten / Expand / Rephrase / Continue, streamed via SSE. Items can be converted to tasks in one click.

### Agent Jobs
Claude Code subprocess executor. Accepts a natural language instruction and optional repo path. Streams live output. Supervised mode pauses for Approve / Modify / Reject before destructive steps. Job list shows status pills and creation time.

### Artifacts
Generated output library. Every file TARS produces — documents, code, reports, spreadsheets, transcripts — is automatically saved here when created via the `generate_document`, `generate_presentation`, or `generate_pdf` tools. Grid and list views. Full preview in modal (markdown rendered, code syntax-highlighted, DOCX/PPTX text extracted). Version history, download, re-open in chat. Save any artifact directly to Second Brain or create a task from it.

### Email Digest
Gmail integration. Summarised digests of your inbox on a configurable schedule. Each digest shows the summary, extracted action items with one-click task creation, and a source thread count. Manual trigger available.

### Cron Manager
UI for all scheduled background jobs — morning brief, email digest, meeting sync, and any custom jobs. Shows human-readable schedule, last run status, next run time, and per-execution output history. Enable/disable toggle and manual trigger.

### Connectors
Google Calendar, Gmail, and Fireflies with a standard base interface. Each connector shows live status, last synced time, capabilities, and a webhook event log. Adding new connectors is a single new file.

### Memory Browser
Episodic memory layer (Mnemon). Stores facts, decisions, and context from every conversation. Browse, filter by domain/source/importance, semantic search, edit, delete, or manually add memories. Injected into every chat turn alongside Second Brain context.

### Settings
Profile, model routing config, notification preferences, API key management, PWA install prompt.

---

## Tools available to TARS

| Tool | What it does |
|---|---|
| `create_task` | Create a task with title, priority, and due date |
| `propose_task` | Suggest a task for user approval before creating |
| `create_calendar_event` | Create a Google Calendar event |
| `propose_calendar_event` | Suggest an event for user approval |
| `save_memory` | Persist a fact to episodic memory |
| `read_email` | Fetch recent emails from Gmail |
| `send_email` | Send or reply to an email via Gmail |
| `read_meeting` | Fetch a meeting transcript and summary |
| `sync_meetings` | Trigger a Fireflies sync |
| `web_search` | Tavily search with snippet results |
| `save_to_second_brain` | Ingest content as a document |
| `generate_document` | Produce a DOCX artifact |
| `generate_presentation` | Produce a PPTX artifact |
| `generate_pdf` | Produce a PDF artifact |

Tools are available to Tier 2 and Tier 3 models. Tier 1 (Haiku) handles fast/simple queries without tools.

---

## Architecture

```
Every request
    │
    ├─ Classifier: Claude Haiku (~200ms)
    │
    ├─ Tier 1 (simple/fast)     → Claude Haiku          ~500ms
    ├─ Tier 2 (most tasks)      → RunPod GPU             ~2-4s warm / cold falls back
    └─ Tier 3 (tools/frontier)  → Claude Sonnet          ~3-8s
```

**Stack**

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 PWA + Tailwind + shadcn/ui |
| Backend | FastAPI (Python) + SQLAlchemy async |
| Database | PostgreSQL + pgvector |
| Queue | Redis |
| Episodic memory | Mnemon |
| Semantic memory | Second Brain — pgvector, two-stage RAG |
| Tier 1 + classifier | `claude-haiku-4-5-20251001` via Anthropic API |
| Tier 2 | RunPod Serverless GPU — model set via `WORKHORSE_MODEL` |
| Tier 3 | Claude Sonnet via Anthropic API |
| Document editor | Tiptap v2 (ProseMirror) |
| Process manager | PM2 |
| Reverse proxy | Nginx + DuckDNS SSL |
| CI/CD | GitHub Actions → SSH deploy |

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

Web: http://localhost:3000 · Harness API docs: http://localhost:8000/docs

---

## Environment variables

See `.env.example` at the repo root. Minimum required:

```env
TARS_ANTHROPIC_API_KEY=
DATABASE_URL=postgresql+asyncpg://tars:password@localhost:5432/tars
JWT_SECRET=
TARS_PASSWORD_HASH=        # bcrypt hash of your login password
```

Generate a password hash:
```bash
python3 -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())"
```

Optional (enables additional features):
```env
RUNPOD_API_KEY=            # Tier 2 GPU inference
RUNPOD_ENDPOINT_32B=
WORKHORSE_MODEL=           # e.g. Qwen/Qwen3-32B-AWQ
TAVILY_API_KEY=            # web search tool
GMAIL_CLIENT_ID=           # Gmail + Google Calendar OAuth
GMAIL_CLIENT_SECRET=
GCAL_CLIENT_ID=
GCAL_CLIENT_SECRET=
FIREFLIES_API_KEY=         # meeting transcripts
```

---

## Deployment

Production runs on Hostinger KVM4 (4 vCPU / 16GB RAM) at `tarsmv.duckdns.org`.

Pushing a `v*` tag to `main` triggers GitHub Actions — CI lint/typecheck, then parallel SSH deploys for web and harness, with a health check at the end.

```bash
# Never push directly to main. Always go through dev → PR → release tag.
git checkout dev
# ... make changes, commit ...
git push origin dev
# When ready to release:
gh pr create --base main --head dev
gh pr merge <n> --merge
git checkout main && git pull
git tag -a v1.x.x -m "Release v1.x.x — ..."
git push origin main --tags
gh release create v1.x.x --title "..." --notes "..."
```

---

## Versioning

[Semantic versioning](https://semver.org). All releases tagged and accompanied by release notes on GitHub.

- **MAJOR** — breaking changes or major new capability
- **MINOR** — new features, backward compatible  
- **PATCH** — bug fixes and infrastructure only

Current: **v1.2.2**
