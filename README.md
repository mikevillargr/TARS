# TARS

An AI operating system that runs your life. Chat, tasks, meetings, knowledge, scheduled prompts, agent jobs — all in one place, all connected, all talking to each other.

Built on Next.js 16 + FastAPI with a three-tier model routing architecture. Installable as a PWA. Every module is live and connected.

**Current version: v2.2.0**

---

## What it does

### Chat
Streaming AI assistant with full tool use. Renders markdown, code with syntax highlighting, SVG diagrams, Mermaid flowcharts, and matplotlib charts directly inline in the message body — the code block is replaced by the rendered image when streaming finishes, with click-to-expand and a download button. Contextual reply chips appear when TARS presents a numbered list of options. Inline text selection toolbar — highlight anything in any message to Copy, Create Task, Save to Second Brain, Add to Calendar, Open URL, or Compose email. Tool calls surface as chips mid-message. Conversation list with auto-generated titles, focus mode, and file/image attachment support.

### Tasks
Kanban board across five columns: Inbox → Todo → In Progress → Done → Snoozed. Cards show source badge, priority colour bar, due date, description preview, and connector sync indicator. Right-panel detail includes checklist support, full description, activity log, and inline editing. Custom column management. Bulk actions, quick-add, filter/sort bar. Tasks are auto-extracted from meetings and can be created from chat, artifacts, and Second Brain items.

### Meetings
Fireflies.ai integration. Lists all meetings with status badges (Processing / Ready / Action Required). Detail view has Summary, Transcript (speaker labels + timestamps), and Actions tabs. Action items show suggested owners and due dates with one-click task creation. Auto-syncs every 4 hours via cron.

### Calendar
Google Calendar sync. Month/Week/Day views (week default). Events colour-coded by type — meetings, tasks with due dates, cron jobs, agent jobs. Mini month picker sidebar, Today button. Click any event to open the detail panel.

### Strava & Garmin
Fitness data connectors with full OAuth. Strava activities are searchable with date-range filtering, pagination, and multi-page server-side fetching. TARS can reference your recent rides, runs, and stats in chat via tool calls — pace, distance, elevation, heart rate zones, gear. Garmin Connect is integrated with token-based auth and a fallback flow for rate-limited IPs.

### Second Brain
Semantic knowledge store backed by pgvector. Two-stage RAG retrieval: item-level cosine similarity → chunk-level reranking within matched documents. Tag filter sidebar is searchable and paginated — handles large tag vocabularies cleanly. Ingests:

- **URLs** — trafilatura extraction + AI summary
- **Notes** — plain text with tags and domain
- **Documents** — Tiptap WYSIWYG editor (headings, lists, code, links, images, inline AI rewrite)
- **Files** — PDF, DOCX, PPTX, XLSX, images

Quick Capture from any page with inline domain creation. AI BubbleMenu on selected text: Improve / Shorten / Expand / Rephrase / Continue, streamed via SSE. Items convertible to tasks in one click. Filter by tag and domain directly from the capture flow.

### Agent Jobs
Claude Code subprocess executor. Accepts a natural language instruction and optional repo path. Streams live output to the UI. Supervised mode pauses for Approve / Modify / Reject before destructive steps. Job list shows status pills, live streaming output, and creation time.

### Artifacts
Generated output library. Every file TARS produces — documents, code, reports, spreadsheets, transcripts — is automatically saved and versioned when created via `generate_document`, `generate_presentation`, or `generate_pdf` tools. Grid and list views. Full preview in modal (markdown rendered, code syntax-highlighted). Version history, download, re-open in chat, save to Second Brain.

### Cron Manager
Two-type scheduled job system:

**Connector Jobs** — system sync tasks (Fireflies transcript pull, Google Contacts sync) with configurable intervals and a Test button for immediate execution.

**Prompt Jobs** — user-defined prompts that run on a wall-clock schedule. Create any number with an arbitrary name. Set frequency (daily / weekdays / weekly / biweekly / monthly), time, and day. When fired, the prompt runs through Claude Sonnet (Tier 3 with full tool access), and the response is saved as a new chat conversation with a notification. Last output is previewed on the card with a direct "Open in chat →" link. Time picker uses Asia/Manila timezone with a segmented HH:MM AM/PM control.

### Connectors
Google Calendar, Gmail, Fireflies, Strava, and Garmin Connect with a standard base interface. Each connector card shows live status, last synced time, capabilities, and a webhook event log. OAuth connectors have a full in-app flow with credential management from the Settings panel. All connectors support manual Sync Now and disconnect.

### Mnemon
Episodic memory layer. Stores facts, decisions, and context extracted from every conversation. Browse, filter by domain/source/importance, semantic search, edit, delete, or manually add memories. Injected into every chat turn alongside Second Brain context. Domains are shared with Second Brain — manage your domain taxonomy in one place across both systems.

### Domains
User-managed taxonomy applied to both Second Brain items and Mnemon memories. Create, rename, and delete domains from the capture flow or directly in settings. Domains replace free-text categories with a consistent, searchable vocabulary across the knowledge layer.

### Notifications
Real-time WebSocket notification system. A green dot appears on the Chat nav item and mobile tab bar whenever TARS sends a message while you're on another page. A toast notification pops up with a message preview and "View →" link. Both clear automatically when you open the conversation. Mute toggle and optional audio alert.

### Settings
Profile, model routing config with live switching between Anthropic and Z.ai (GLM) per tier, notification preferences, API key management, PWA install prompt.

---

## Tools available in chat

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
| `web_search` | Search the web with snippet results |
| `save_to_second_brain` | Ingest a URL or text as a knowledge item |
| `generate_document` | Produce a DOCX artifact |
| `generate_presentation` | Produce a PPTX artifact |
| `generate_pdf` | Produce a PDF artifact |
| `lookup_contact` / `search_contacts` | Search and fetch contacts |
| `search_places` / `save_place` | Find and save places |
| `create_agent_job` | Spin up a Claude Code agent job from chat |
| `generate_chart` | Render a matplotlib chart inline in the message body |
| `get_strava_activities` | List recent Strava activities with filtering |
| `get_strava_activity` | Fetch a single activity with full streams |
| `get_strava_stats` | Fetch cumulative training stats |
| `get_strava_zones` | Fetch heart rate and power zones |

Tools are available to Tier 2 and Tier 3 models. Tier 1 (Haiku) handles fast/simple queries without tools.

---

## Architecture

```
Every request
    │
    ├─ Classifier: Claude Haiku (~200ms)
    │
    ├─ Tier 1 (simple/fast)     → Claude Haiku          ~500ms
    ├─ Tier 2 (most tasks)      → RunPod Serverless GPU  ~2-4s warm
    └─ Tier 3 (tools/frontier)  → Claude Sonnet          ~3-8s
```

Prompt cron jobs always route to Tier 3. Cold-start fallback: messages ≤500 chars → Haiku, longer → Sonnet.

**Stack**

| Layer | Choice |
|---|---|
| Frontend | Next.js 16 PWA + Tailwind + shadcn/ui |
| Backend | FastAPI (Python) + SQLAlchemy async |
| Database | PostgreSQL + pgvector |
| Cache | Redis |
| Episodic memory | Mnemon (custom RAG layer) |
| Semantic memory | Second Brain — pgvector, two-stage RAG |
| Tier 1 + classifier | Claude Haiku via Anthropic API |
| Tier 2 | RunPod Serverless GPU — model via `WORKHORSE_MODEL` |
| Tier 3 | Claude Sonnet via Anthropic API |
| Document editor | Tiptap v2 (ProseMirror) |
| Real-time | WebSocket notification stream |
| Process manager | PM2 |
| Reverse proxy | Nginx + Let's Encrypt SSL |
| CI/CD | GitHub Actions → SSH deploy |

---

## Running locally

```bash
# Start Postgres + Redis
docker compose up -d postgres redis

# Run migrations
cd apps/harness
source .venv/bin/activate
python -m alembic upgrade head

# Harness
cp .env.example .env   # fill in your keys
uvicorn main:app --reload --port 8000

# Web
cd apps/web
npm install
npm run dev
```

Web: `http://localhost:3000` · Harness API docs: `http://localhost:8000/docs`

---

## Environment variables

See `.env.example` at the repo root. Minimum required:

```env
ANTHROPIC_API_KEY=
DATABASE_URL=postgresql+asyncpg://tars:password@localhost:5432/tars
JWT_SECRET=
TARS_USERNAME=
TARS_PASSWORD_HASH=        # bcrypt hash — see below
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

Runs on a Hostinger KVM4 (4 vCPU / 16GB RAM) managed by PM2 behind Nginx.

```bash
# Pull and deploy
ssh root@<your-server> "cd /opt/tars && git pull origin main"
ssh root@<your-server> "cd /opt/tars/apps/harness && source .venv/bin/activate && python -m alembic upgrade head"
ssh root@<your-server> "pm2 restart tars-harness"
ssh root@<your-server> "cd /opt/tars/apps/web && npm run build && cp -r .next/static .next/standalone/apps/web/.next/ && pm2 restart tars-web"
```

> ⚠️ The server has fail2ban. Do not run retry loops against SSH — repeated failed connection attempts will trigger an IP block.

---

## Versioning

[Semantic versioning](https://semver.org). All releases tagged on GitHub.

- **MAJOR** — breaking changes or major new capability
- **MINOR** — new features, backward compatible
- **PATCH** — bug fixes only

## Changelog

### v2.2.0
- **Strava connector** — full OAuth, activity list with date-range filtering, pagination, and multi-page fetching; four chat tools (activities, single activity, stats, zones)
- **Garmin Connect** — token-based auth with fallback for rate-limited IPs
- **Inline matplotlib charts** — code block is replaced by the rendered PNG when streaming completes; click to expand, download button; works for both Claude (tool) and Z.ai (code-block fallback) paths
- **Email send approval gate** — send_email tool always surfaces a draft card for explicit approval before sending
- **Contextual reply chips** — when TARS presents a numbered option list, clickable chips appear so you can reply without typing
- **Second Brain tag filter** — sidebar tag list is now searchable and paginated
- **Connector improvements** — Sync Now button on all connectors, Fireflies disconnect, better status display

### v2.1.0 – v2.1.1
Places, contacts, inline map cards, email draft cards, Google Contacts sync, pending contacts queue, Tiptap document editor in Second Brain.

### v2.0.0
Domains taxonomy, Mnemon memory browser, notification WebSocket, PWA manifest, Settings panel, full production deploy on Hostinger KVM4.
