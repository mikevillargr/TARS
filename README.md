# TARS

Personal AI operating system. Chat, tasks, meetings, calendar, knowledge, cron jobs, agent jobs — all connected, all talking to each other.

Built on Next.js 15 + FastAPI with a three-tier model routing architecture. Installable as a PWA. Streams to Rokid AR glasses. Every module is live and connected.

**Current version: v2.6.0**

---

## What it does

### Chat
Streaming AI assistant with full tool use. Renders markdown, code with syntax highlighting, SVG diagrams, Mermaid flowcharts, and matplotlib charts directly inline in the message body. Tool calls surface as chips mid-message. Inline text selection toolbar — highlight anything to Copy, Create Task, Save to Second Brain, Add to Calendar, Open URL, or Compose email. Contextual reply chips appear when TARS presents a numbered list. Conversation list with auto-generated titles and focus mode.

Voice: tap the mic to record; VAD silence detection auto-sends. TTS: every response is read aloud sentence-by-sentence via Kokoro. An amber "TARS is speaking" pill with a stop button floats above the composer while audio plays. Voice and TTS can be toggled per session.

### Tasks
Kanban: Inbox → Todo → In Progress → Done → Snoozed. Cards show source badge, priority colour bar, due date, and connector sync indicator. Right-panel detail with checklist support, full description, and activity log. Auto-extracted from meetings; createable from chat, artifacts, and Second Brain.

### Meetings
Fireflies.ai integration. Lists all meetings with status badges (Processing / Ready / Action Required). Detail view: Summary, Transcript (speaker labels + timestamps), Actions tabs. Action items show suggested owners and due dates with one-click task creation.

### Calendar
Google Calendar sync. Month/Week/Day views (week default). Events colour-coded by type. Mini month picker, Today button. Click any event to open the detail panel.

### Second Brain
Semantic knowledge store backed by pgvector. Two-stage RAG: item-level cosine similarity → chunk-level reranking. Ingests:

- **URLs** — trafilatura extraction + AI summary
- **Notes** — plain text with tags and domain
- **Documents** — Tiptap WYSIWYG editor (headings, lists, code, links, images, inline AI rewrite)
- **Files** — PDF, DOCX, PPTX, XLSX, images

Quick Capture from any page. AI BubbleMenu on selected text: Improve / Shorten / Expand / Rephrase / Continue. Tag filter sidebar with search and pagination.

### Agent Jobs
Claude Code subprocess executor. Accepts a natural language instruction and optional repo path. Streams live output to the UI. Supervised mode pauses for Approve / Modify / Reject before destructive steps.

### Artifacts
Generated output library. Every file TARS produces — documents, code, reports, spreadsheets, transcripts — is automatically saved and versioned. Grid and list views. Full preview modal. Version history, download, re-open in chat, save to Second Brain.

### Cron Manager
Two-type scheduled jobs:

- **Connector Jobs** — system sync tasks (Fireflies, Google Contacts) on configurable intervals.
- **Prompt Jobs** — user-defined prompts on a wall-clock schedule. Create any number with an arbitrary name, frequency (daily / weekdays / weekly / biweekly / monthly), and time (Asia/Manila). Runs through Claude Sonnet with full tool access; result saved as a new chat conversation with a push notification.

### Connectors

| Connector | Capabilities |
|---|---|
| Gmail | read, webhook |
| Google Calendar | read, write |
| Google Contacts | read, write, weekly sync |
| Fireflies | read, webhook (meeting.ended) |
| Strava | read (activities, stats, zones) |
| Tesla (Tessie) | read, write (full vehicle control) |
| OpenStreetMap | read, no API key required |

### Mnemon (Memory Browser)
Episodic memory layer. Stores facts, decisions, and context from every conversation. Browse, filter, semantic search, edit, delete, or manually add memories. Injected into every chat turn alongside Second Brain context.

### Rokid Glasses
Streams TARS responses token-by-token to Rokid AR Lite glasses (480×640 green micro-LED HUD). Full duplex: voice input from glasses, TTS output to glasses speaker. Temple touchpad gestures for brightness, TTS stop, and display sleep.

```
TARS Harness ── ws /api/rokid/ws ── Android Phone ── Bluetooth (CXR-M) ── Rokid AR Lite
```

### Settings
Profile, model routing config with live switching between Anthropic and Z.ai (GLM) per tier, notification preferences, Kokoro TTS voice selector and speed slider, API key management, PWA install prompt.

---

## Tools available in chat

| Tool | What it does |
|---|---|
| `create_task` / `propose_task` | Create or suggest a task |
| `create_calendar_event` / `propose_calendar_event` | Book or suggest an event |
| `update_calendar_event` / `delete_calendar_event` | Edit or remove an event |
| `save_memory` | Persist a fact to episodic memory |
| `save_to_second_brain` | Ingest a URL or text as a knowledge item |
| `read_email` | Fetch an email by thread ID or search query |
| `read_meeting` | Fetch a meeting transcript and summary |
| `sync_meetings` | Trigger a Fireflies sync |
| `web_search` | Search the web for current information |
| `generate_document` | Produce a DOCX artifact |
| `generate_presentation` | Produce a PPTX artifact |
| `generate_pdf` | Produce a PDF artifact |
| `lookup_contact` / `search_contacts` | Find a contact by name or browse all |
| `create_contact` / `update_contact` | Add or update a Google Contact |
| `search_places` / `save_place` / `get_saved_places` | Find and bookmark places (OSM) |
| `get_strava_activities` / `get_strava_activity` | List or detail Strava activities |
| `get_strava_stats` / `get_strava_zones` | Training totals and HR/power zones |
| `get_tesla_status` | Full real-time vehicle state |
| `tesla_command` | Execute any vehicle command (locks, climate, charging, etc.) |
| `get_tesla_sessions` | Drive and charging history |
| `create_agent_job` | Spawn a Claude Code agent job from chat |

---

## Architecture

```
Every request
    │
    ├─ Classifier: Claude Haiku (~200ms)
    │
    ├─ Tier 1 (simple/fast)     → Claude Haiku          ~500ms
    ├─ Tier 2 (most tasks)      → Z.ai GLM               ~1–3s
    └─ Tier 3 (tools/frontier)  → Claude Sonnet          ~3–8s
```

Provider and model are configurable per-tier in Settings (Anthropic or Z.ai).
Prompt cron jobs always route to Tier 3.

**Stack**

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 PWA + Tailwind + shadcn/ui |
| Backend | FastAPI (Python) + SQLAlchemy async |
| Database | PostgreSQL + pgvector |
| Cache | Redis |
| Episodic memory | Mnemon (episodic RAG) |
| Semantic memory | Second Brain (pgvector, two-stage RAG) |
| Tier 1 + classifier | Claude Haiku via Anthropic API |
| Tier 2 | Z.ai GLM (configurable via Settings UI) |
| Tier 3 | Claude Sonnet via Anthropic API |
| Agentic executor | Claude Code subprocess |
| TTS | Kokoro (sentence-by-sentence streaming) |
| Document editor | Tiptap v2 |
| Real-time | WebSocket notification stream |
| Glasses | Rokid AR Lite via CXR-M/CXR-S BT SDK |
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
ZAI_API_KEY=               # Tier 2 — Z.ai GLM models
TAVILY_API_KEY=            # web search
GMAIL_CLIENT_ID=           # Gmail + Google Calendar OAuth
GMAIL_CLIENT_SECRET=
GCAL_CLIENT_ID=
GCAL_CLIENT_SECRET=
FIREFLIES_API_KEY=         # meeting transcripts
STRAVA_CLIENT_ID=          # Strava OAuth
STRAVA_CLIENT_SECRET=
TESSIE_API_KEY=            # Tesla via Tessie
VAPID_PUBLIC_KEY=          # push notifications
VAPID_PRIVATE_KEY=
```

---

## Deployment

Runs on a Hostinger KVM4 (4 vCPU / 16GB RAM) managed by PM2 behind Nginx.

```bash
ssh tars "cd /opt/tars && git pull origin main"
ssh tars "cd /opt/tars/apps/harness && source .venv/bin/activate && python -m alembic upgrade head"
ssh tars "pm2 restart tars-harness"
ssh tars "cd /opt/tars/apps/web && npm run build && cp -r .next/static .next/standalone/apps/web/.next/ && mkdir -p .next/standalone/apps/web/public && cp -r public/* .next/standalone/apps/web/public/ && pm2 restart tars-web"
```

> The server has fail2ban. Do not run retry loops against SSH — repeated failed connection attempts will trigger an IP block.

---

## Versioning

[Semantic versioning](https://semver.org). All releases tagged on GitHub.

`SYSTEM_STATE.md` at the repo root tracks every version, infrastructure change, and the full architecture inventory — and is injected into TARS's context at runtime so it can answer questions about itself.

---

## Changelog

### v2.6.0
Rokid glasses HUD: full TTS, photo flow, brightness control, session polish.

- Swipe brightness control on temple touchpad; double-tap to stop TTS or sleep display
- Hands-free photo flow, display-off gesture, Kokoro voice settings in glasses UI
- TTS stop controls: tap to stop, voice trigger interrupts playback
- Auto-send voice input; TTS enabled by default in glasses mode
- Z.ai GLM models surfaced with free-tier defaults
- Resilient WiFi P2P APK install + auto-launch HUD
- Removed 500-char message truncation that corrupted large JSON
- TTS streaming: chunked past Kokoro's 510-phoneme limit (both ends)
- Active stream keepalive prevents display dimming mid-response
- Null-safe Gson frame parsing; forced phone mic over glasses BT SCO

### v2.5.0
Kokoro TTS voice settings, chat composer redesign, amber speaking indicator.

- Kokoro voice selector (alloy, echo, fable, onyx, nova, shimmer) + speed slider in Settings
- Chat composer: mic on right when empty, send when text present, stop square when streaming
- Amber floating "TARS is speaking" pill with AudioLines icon and stop button
- TTS AbortController Set fix (stopped any active audio on new message)

### v2.4.x
Rokid AR Lite integration — FastAPI WebSocket bridge (`/api/rokid/ws`), Android phone-app (TarsClient, TarsBridgeService), glasses HUD (Jetpack Compose, 480×640 green micro-LED).

### v2.3.0
- GLM-5.1 and GLM-4.7 support via Z.ai's OpenAI-compatible endpoint
- Vision model routing with independent tier config
- `update_calendar_event` and `delete_calendar_event` tools
- Calendar context window expanded to 30 days
- Email send thread ID fix (8-char truncated IDs expanded to full Gmail IDs)

### v2.2.0
- Strava connector (OAuth, activities, stats, zones, chat tools)
- Garmin Connect integration
- Inline matplotlib chart rendering (code block replaced by PNG on stream complete)
- Email send approval gate (draft card before sending)
- Contextual reply chips for numbered lists
- Second Brain tag filter pagination

### v2.1.x
Places (OSM), contacts (Google Contacts sync), inline map cards, email draft approval, Tiptap document editor in Second Brain.

### v2.0.0
Domains taxonomy, Mnemon memory browser, WebSocket notifications, PWA manifest, Settings, full production deploy on Hostinger KVM4.
