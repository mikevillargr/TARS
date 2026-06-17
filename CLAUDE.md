# TARS — Master Specification
> Personal AI Operating System for Mike Villar
> Last updated: June 2026 — v2.9.3 (post-sessions 1–9+, live on production)
> Status: **Live** — running at tarsmv.duckdns.org on Hostinger KVM4 (72.60.234.180)

---

## 0. Keeping This Document Current

**This document is the single source of truth for every Claude Code agent session.**
Every agent reads it on start. If it drifts from reality, agents make wrong decisions.

### After EVERY change that ships to production, BOTH docs must be updated in the same commit:
This is not tied to formal `git tag` releases. The working model is "always push to live" —
so any deploy that adds, removes, or changes a feature, component, schema, connector, or
process **must** update both docs before/with the deploy. Bump the patch version even for
small user-facing features so TARS's self-knowledge stays accurate.

1. Update the relevant sections in **CLAUDE.md** (see list below)
2. Update **SYSTEM_STATE.md** (see below)
3. Commit (may be part of the feature commit, or a `docs:` commit)
4. Push to main + deploy

### SYSTEM_STATE.md — mandatory on every production change
`SYSTEM_STATE.md` at the repo root is the live architecture file injected into TARS's own
context so it can answer questions about itself ("what version are you?", "what connectors
do you have?", "how does your model routing work?", "can I star a Second Brain item?").
**If TARS doesn't know about a feature, it's because this file wasn't updated — update it.**

Fields to update on every production change:
- **Current Version** table — version number (bump patch even for small features) + release date
- **Version History** — prepend a new entry (latest first) with features + fixes
- **Infrastructure / Running Services** — if any server config changed
- **Active Components / Connectors** — if any added, removed, or changed status/capability

### What to update in CLAUDE.md:
- **Section 6** — data model if schema changed
- **Section 8** — component specs if UI changed
- **Section 9** — monorepo structure if files added/removed
- **Section 12** — deployment process if procedures changed
- **Section 14** — session status table
- **Top of file** — last updated date and status line

### What must NOT drift:
- Removed features (don't leave dead specs — agents will try to build them)
- Changed API patterns (agents will call wrong endpoints)
- SSH/deployment rules (agents will break production)

---

## 1. Project Identity

| Field | Value |
|---|---|
| Project name | TARS |
| Inspired by | TARS from Interstellar |
| Repo name | tars (private GitHub) |
| PWA name | TARS |
| Assistant persona | Direct, efficient, no unnecessary padding. Humor setting: 75%. |
| Primary user | Mike Villar, CEO of Growth Rocket, Metro Manila |

### System Prompt Foundation
```
You are TARS, Mike Villar's personal AI operating system.

You are direct, precise, and efficient - like your namesake from
Interstellar. You don't over-explain. You get things done.

You have access to Mike's full context through memory retrieval.
You know his work, his clients, his projects, his priorities,
and his personal life. Use that context naturally without
announcing that you're doing so.

Mike is CEO of Growth Rocket, a digital marketing agency based
in Metro Manila. His active clients include NCH Inc., AA Law,
OpenRice Philippines, LickSleeve, and Entire Travel Group.
He is a randonneur and cyclist. He manages his health actively.

[MEMORY CONTEXT]
{mnemon_context}

[RELEVANT KNOWLEDGE]
{second_brain_context}

[ACTIVE CONTEXT]
{active_tasks_count} open tasks
{todays_meetings} today
Last interaction: {last_seen}

Respond as TARS. Honest, capable, no unnecessary padding.
Humor setting: 75%.
```

---

## 2. Full Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | Next.js 15 PWA + shadcn/ui | Installable, offline capable, push notifications |
| Backend harness | FastAPI (Python) | Better AI library ecosystem |
| Database | Postgres + pgvector | Structured data + semantic search |
| Queue | Redis + BullMQ | Cron jobs + async task queue |
| Memory | Mnemon + pgvector | Episodic memory layer |
| Tier 2 inference | Z.ai (GLM models) | OpenAI-compatible endpoint, model set via Settings UI |
| Tier 1 + Tier 3 | Anthropic API direct | Haiku (fast) + Sonnet (frontier/tools) |
| Agentic executor | Claude Code via subprocess | Non-interactive mode, stdout capture |
| Monorepo | Turborepo | Cached builds, parallel deploys |
| Containerization | Docker + Docker Compose | Dev and prod parity |
| Reverse proxy | Nginx | SSL termination, routing |
| CI/CD | GitHub Actions | Push to main triggers deploy |

---

## 3. Infrastructure

| Component | Provider | Spec | Est. Cost |
|---|---|---|---|
| App server | Hostinger KVM4 | 4 vCPU, 16GB RAM, 200GB NVMe | ~$10-15/mo |
| Tier 2 inference | Z.ai API | GLM models via OpenAI-compatible endpoint | Pay per token |
| Tier 1 + 3 API | Anthropic API | Haiku + Sonnet | Pay per token |
| Domain | tarsmv.duckdns.org | DuckDNS pointing to 72.60.234.180 | Free |

---

## 4. Model Architecture

### Three-Tier Routing

```
Every request
    |
Claude Haiku classifier (~200ms, Anthropic API)
    |
    +-- Tier 1 (simple/fast) -----> Claude Haiku via Anthropic API
    |   "What's on my calendar"     ~500ms
    |   "Mark that task done"
    |
    +-- Tier 2 (most tasks) -------> Z.ai GLM (e.g. GLM-4.7)
    |   Email summarization          ~1-3s
    |   Meeting extraction
    |   Coding questions
    |   Day-to-day assistant work
    |
    +-- Tier 3 (frontier + tools) -> Claude Sonnet via Anthropic API
        Client deliverables          ~3-8s
        All tool calls (tasks, calendar, memory, meetings, search)
        Long document analysis
        Complex reasoning
```

### Model Summary

| Role | Model | Notes |
|---|---|---|
| Classifier + Tier 1 | Claude Haiku | Fast, cheap, always available via Anthropic API |
| Tier 2 workhorse | Z.ai GLM-4.7 (default) | Configurable via Settings UI per-tier |
| Tier 3 frontier | Claude Sonnet | Tool use, long context, client-facing work |
| Embeddings | nomic-embed-text | pgvector semantic search |
| Speech-to-text | faster-whisper — **open source** (MIT, [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)), self-hosted CPU int8 | `POST /transcribe` (`api/routes/transcribe.py`); model size via `WHISPER_MODEL` env (default "small"); lazy-loaded singleton, ~500MB RAM |
| Text-to-speech | Kokoro TTS — **open source** ([hexgrad/Kokoro-82M](https://github.com/hexgrad/Kokoro-82M) model, Apache-2.0, run via [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx)), embedded in harness process | Sentence-by-sentence streaming via `/api/proxy/tts`; voice + speed configurable in Settings |

### Backup models (per-tier fallback) — since v2.8.0
Each tier (tier1/2/3/vision) can have an optional **backup** provider+model (Settings → Model
Routing). If the primary errors/times out **before any content has streamed**, the harness emits
a `model_fallback` event and re-runs the turn on the backup. A per-tier in-memory circuit breaker
(`ModelClient._degraded`) then keeps the backup in use and re-probes the primary with a cheap
1-token ping at the start of each turn, reverting the moment it recovers. Fallback never fires
mid-stream (after tools may have side-effected). `.env`: `{tier}_backup_provider` /
`{tier}_backup_model_override`. Logic lives in `ModelClient._stream_with_fallback` /
`_stream_pair` / `_probe` (`core/model_client.py`).

### Task-category forced routing — since v2.8.0
Routing stays complexity-based, but every request is **also** classified into one of six task
categories so a specific model can be forced per category, independent of tier:

| Category | Covers |
|---|---|
| `quick_lookup` | status checks, single-tool reads, short Q&A |
| `writing` | drafting docs/reports/proposals/emails/memos/summaries, decks |
| `coding` | code generation, debugging, technical Q&A |
| `data_viz` | charts, plots, graphs, visualizing data |
| `analysis` | strategy, deep analysis, research synthesis, client deliverables |
| `general` | conversational / anything else |

Detection is regex fast-path + the existing tier-1 classifier (now two-token: `tier category`)
in `router.classify_full`. Settings → Task-Category Routing maps a category to a forced
provider+model that **overrides the tier's model** while the classified tier still governs tool
access and context budget. Stored as `category_routing_json` in `.env`; image/vision requests are
excluded (vision routing owns model choice).

---

## 5. Memory Architecture

### Two Distinct Memory Systems

| System | Type | Purpose |
|---|---|---|
| Mnemon | Episodic RAG | What happened — conversations, meetings, decisions, personal facts |
| Second Brain | Semantic RAG | What you know — saved URLs, notes, docs, research |

Both use pgvector. Both are queried before every conversation turn and injected into the system prompt.

### RAG Pipeline (Second Brain)
- Chunk size: ~500 tokens
- Chunk overlap: 50-100 tokens
- Two-stage retrieval: document-level first, then chunk-level within matched docs
- Document-level summary stored separately for broad queries

### Document Types Supported
| Type | Parser |
|---|---|
| PDF | pymupdf |
| PPTX | python-pptx |
| DOCX | python-docx |
| URL | trafilatura |
| Plain text / Markdown | Native |
| Meeting transcripts | Direct text from Fireflies webhook |

---

## 6. Data Model

```typescript
User { id, name, timezone, preferences, created_at }

Memory {
  id, user_id, content, embedding (pgvector)
  domain // "work" | "personal" | "health" | "cycling" | "client"
  source // "conversation" | "meeting" | "email" | "manual"
  importance // 1-5
  expires_at, created_at, updated_at
}

Conversation { id, user_id, title, context_snapshot, created_at }

Message {
  id, conversation_id, role, content
  model_used, tokens_used, tool_calls[]
  created_at
}

Task {
  id, user_id, title, description
  status // "inbox" | "todo" | "in_progress" | "done" | "snoozed"
  priority // "urgent" | "high" | "normal" | "low"
  due_at, source, source_id, assigned_to
  connector_ref // Linear issue ID when synced
  created_at, updated_at
}

Meeting {
  id, user_id, title, transcript, summary
  attendees[], connector_ref
  started_at, ended_at
}

MeetingActionItem { id, meeting_id, task_id, owner, raw_text }

CronJob {
  id, user_id, name
  type          // "connector" | "prompt"
  // connector jobs
  schedule      // interval string
  connector_ids[]
  // prompt jobs
  prompt_text
  schedule_config // { frequency, time, day_of_week }
  timezone      // "Asia/Manila"
  last_output
  output_conversation_id
  // shared
  enabled, last_run_at, last_run_status, next_run_at
  created_at
}

AgentJob {
  id, user_id, type, instruction, repo_path
  status // "pending" | "running" | "needs_input" | "done" | "failed"
  requires_approval, approval_prompt, output
  created_at, updated_at
}

Connector {
  id, user_id
  status // "connected" | "disconnected" | "error"
  auth // encrypted
  capabilities[], last_synced_at, config
}

WebhookEvent {
  id, connector_id, event_type, payload
  processed, processed_at, created_at
}

KnowledgeItem {
  id, user_id, type // "url" | "note" | "document" | "voice"
  url, raw_content, clean_content
  personal_note, tags[], domain, project_ref, topics[]
  embedding (pgvector), summary
  source_title, source_author
  saved_at, last_accessed_at, access_count
}

DocumentChunk {
  id, knowledge_item_id, chunk_index
  content, embedding (pgvector)
  page_or_slide, token_count, created_at
}

KnowledgeCollection { id, user_id, name, description, item_ids[] }

Artifact {
  id, user_id
  filename
  type          // "document" | "code" | "report" | "spreadsheet" | "transcript"
  source        // "chat" | "agent_job" | "cron" | "meeting" | "upload"
  source_id     // FK to originating message/job/meeting
  content       // file content or storage path
  embedding     // pgvector for semantic search
  version       // integer, increments on regeneration
  parent_id     // FK to original artifact if this is a revision
  project_ref   // client/project tag
  tags[]
  size_bytes
  created_at
}
```

---

## 7. Connector System

### Architecture
Every connector implements a standard base interface. Adding new connectors (Linear, GitHub, Notion) is a new file in `connectors/` with no changes to core harness code.

```python
class Connector:
    id: str
    capabilities: List[str]
    auth: OAuthConfig | APIKeyConfig
    def read(query: ConnectorQuery) -> ConnectorResult
    def write(action: ConnectorAction) -> ConnectorResult
    webhook: Optional[WebhookConfig]
```

### Initial Connectors at Launch
| Connector | Capabilities |
|---|---|
| Gmail | read, webhook |
| Google Calendar | read, write |
| Fireflies | read, webhook (meeting.ended) |
| Growth Rocket tools | read, write (RedditPipe, AlwaysSunny, Poe grader) |

### Future Connectors (not planned, just noted)
Linear, GitHub — plug in when needed

---

## 8. Application Components (10)

### Navigation Order (10 components)
Chat, Tasks, Meetings, Calendar, Second Brain, Agent Jobs, Artifacts, Cron Manager, Connectors, Mnemon, Settings

### Component Specs

**1. Chat**
- Conversation list, message thread, model badge per message
- Tool call chips inline (e.g. "Queried Gmail", "Created Task")
- Context bar showing active Mnemon injections
- Streaming/thinking indicator, focus mode
- Composer layout (mobile-first, Option A):
  - Right side: mic when input is empty (replaces send — ChatGPT/WhatsApp pattern), send when text is present, stop-generating square when response is streaming
  - Left side: `+` button collapses to utility tray (attach file, camera, voice mode toggle); green dot on `+` when voice mode is active
  - TTS speaking state: floating amber "TARS is speaking" pill above composer with pulsing AudioLines icon and stop square — appears when `isPlaying || isSynthesizing`
- Kokoro TTS: responses are streamed sentence-by-sentence via `/api/proxy/tts`; `useTtsPlayback` hook manages synthesis queue and audio playback
- Voice input: `useVoiceInput` hook handles microphone recording, VAD silence detection, and transcription
- Voice mode toggle: enables TTS for all responses in the current conversation (persisted per-session)

**2. Tasks**
- Kanban: Inbox / Todo / In Progress / Done / Snoozed
- Cards: source badge, priority color bar, due date, connector sync indicator
- Right panel detail: full description, source reference, activity log
- Bulk actions, inline quick-add, filter/sort bar

**3. Meetings**
- List with status badge: Processing / Ready / Action Required
- Detail: Summary tab, Transcript tab (speaker labels + timestamps), Actions tab
- Action items: owner, due date suggestion, one-click Create Task
- Related Second Brain items surfaced automatically

**4. Calendar**
- Month / Week / Day toggle, Week view default
- Event types color-coded: meetings, tasks with due dates, cron jobs, agent jobs
- Click event: opens right panel detail with link to source view
- Mini month picker sidebar, Today button
- Mobile: Day view default, swipeable

**5. Second Brain**
- Collections sidebar panel (named groups of items)
- Masonry/card grid + list toggle
- Semantic search bar, domain/tag/collection filters; **Starred** sidebar filter (amber star) for pinned items
- Item cards: favicon/thumbnail, title, summary excerpt, personal note, tags; star toggle in card corner (shows on hover, persists `starred`) — starred items sort first
- Detail modal: star toggle in header (optimistic, persisted via PATCH)
- Retrieval boost: starred items get a `STAR_BOOST` (0.06) reduction in effective cosine distance in `second_brain.search`, so user-pinned knowledge is favored when injected into TARS's context (semantic + keyword-fallback paths)
- Right panel: full content, annotation textarea, related items, access history
- PWA share target (native share sheet on mobile)
- Quick Capture: URL, Note, Document upload, Voice memo

**6. Agent Jobs**
- Job list: instruction, context/repo, status pill, created time
- Status: Pending / Running / Needs Input / Done / Failed
- Detail (right panel): live output stream (monospace), approval flow (Approve / Modify / Reject)
- New Job: instruction input, repo selector, supervised vs autonomous toggle

**7. Artifacts**
A generated output library. Every file TARS produces is automatically saved, versioned, and retrievable here.

Sources that populate Artifacts automatically:
- Chat responses containing generated files
- Agent Job output files on completion
- Cron job reports
- Meeting exported summaries and transcripts
- Manual uploads for files you want TARS to work on

Features:
- Grid and list view toggle
- Filter by type (Document / Code / Report / Spreadsheet / Transcript), source (Chat / Agent Job / Cron / Meeting / Upload), date, project/client tag
- Semantic search across filenames and file content
- File cards: type icon, filename, source badge, date generated, size
- Right panel detail: full preview for text/markdown/code, Download button, "Open in Chat" button (loads file as context in new chat session), version history timeline, tags, project reference
- Auto-save hook: any model output containing a file triggers save to Artifacts
- Version tracking: regenerating the same document creates a new version linked to the original
- Empty state: explains that files generated by TARS in chat, agent jobs, cron reports, and meetings appear here automatically

**8. Cron Manager**
Two-type system. Connector Jobs (interval-based sync) and Prompt Jobs (wall-clock scheduled, Asia/Manila timezone).

Connector Jobs tab:
- System sync jobs (Fireflies, Google Contacts)
- Interval selector, manual Test button, last/next run times

Prompt Jobs tab:
- User creates named jobs with arbitrary name + prompt text
- Schedule: daily / weekdays / weekly / every 2 weeks / monthly
- Time picker: segmented HH:MM AM/PM control (Asia/Manila)
- On fire: runs prompt through Tier 3 (Claude Sonnet), saves result as new chat conversation, triggers new_message notification
- Cards show: schedule, last output preview, "Open in chat →" link, Test / Edit / Pause / Delete actions

**9. Connectors**
- Grid of connector cards: icon, name, status, last synced, capabilities
- Connect/disconnect flow
- Webhook log per connector showing recent inbound events
- Which components use each connector

**10. Mnemon (Memory Browser)**
- Memory list: content, domain badge, source, importance score, date
- Filter by domain, source, date, importance
- Semantic search across all memories
- Edit and delete individual memories
- Manual memory addition

**11. Settings**
- Profile and preferences
- Model routing config: tier assignments (provider + model per tier) **plus an optional backup
  model per tier** — used as automatic fallback when the primary errors/times out (see §4)
- Task-Category Routing: force a specific provider+model per task category
  (quick_lookup / writing / coding / data_viz / analysis / general); "Default" = normal tier
  routing. Backed by `GET/PATCH /api/settings/model-routing/categories`
- Notification preferences per component
- PWA install prompt
- API key management
- Cron default schedule config
- Voice section: voice selector (alloy, echo, fable, onyx, nova, shimmer), speed slider (0.5×–2.0×), preview button; preferences persisted server-side via `/api/proxy/settings` so they work across browser and PWA contexts

---

## 9. Monorepo Structure

```
tars/
├── apps/
│   ├── web/                    # Next.js 15 PWA
│   │   ├── app/
│   │   │   ├── (auth)/login/
│   │   │   ├── (app)/
│   │   │   │   ├── chat/
│   │   │   │   ├── tasks/
│   │   │   │   ├── meetings/
│   │   │   │   ├── calendar/
│   │   │   │   ├── second-brain/
│   │   │   │   ├── agent-jobs/
│   │   │   │   ├── artifacts/
│   │   │   │   ├── cron/
│   │   │   │   ├── connectors/
│   │   │   │   ├── memory/
│   │   │   │   └── settings/
│   │   │   └── api/            # thin proxy to harness
│   │   ├── components/
│   │   │   ├── shell/          # sidebar, topbar, right panel
│   │   │   ├── chat/
│   │   │   ├── tasks/
│   │   │   ├── meetings/
│   │   │   ├── calendar/
│   │   │   ├── second-brain/
│   │   │   ├── agent-jobs/
│   │   │   └── ui/             # shadcn components
│   │   ├── context/
│   │   │   └── NotificationContext.tsx  # global WS notification state
│   │   ├── hooks/
│   │   │   ├── useNotifications.ts      # WebSocket notification hook
│   │   │   ├── useTtsPlayback.ts        # Kokoro TTS synthesis queue + audio playback
│   │   │   └── useVoiceInput.ts         # Microphone recording, VAD, transcription
│   │   ├── lib/
│   │   │   ├── api-client.ts
│   │   │   ├── websocket.ts             # TarsWebSocket (localhost:3000→8000 in dev)
│   │   │   └── push-notifications.ts
│   │   └── public/manifest.json  # PWA + share target
│   │
│   ├── harness/                # FastAPI
│   │   ├── api/routes/         # one file per component
│   │   │   └── rokid.py        # WebSocket bridge: /api/rokid/ws — SSE→glasses protocol
│   │   ├── core/
│   │   │   ├── router.py       # tier classification
│   │   │   ├── context_assembler.py
│   │   │   ├── model_client.py # Ollama + Anthropic unified
│   │   │   └── streaming.py
│   │   ├── memory/
│   │   │   ├── mnemon.py
│   │   │   ├── second_brain.py
│   │   │   ├── embeddings.py
│   │   │   └── chunker.py
│   │   ├── connectors/
│   │   │   ├── base.py         # Connector interface
│   │   │   ├── gmail.py
│   │   │   ├── google_calendar.py
│   │   │   ├── fireflies.py
│   │   │   └── registry.py
│   │   ├── agents/
│   │   │   ├── executor.py     # Claude Code subprocess
│   │   │   ├── job_manager.py
│   │   │   └── approval.py
│   │   ├── jobs/
│   │   │   ├── scheduler.py        # connector cron loops + 60s prompt cron checker
│   │   │   ├── prompt_cron.py      # prompt cron executor (always Tier 3)
│   │   │   ├── meeting_processor.py
│   │   │   └── people_sync.py
│   │   ├── ingest/
│   │   │   ├── pipeline.py
│   │   │   ├── parsers/        # pdf, pptx, docx, url
│   │   │   └── enricher.py
│   │   └── db/
│   │       ├── models.py       # SQLAlchemy
│   │       ├── migrations/     # Alembic
│   │       └── session.py
│   │
│   └── rokid/                  # Android — Rokid glasses HUD (Kotlin, separate Gradle project)
│       ├── shared/             # Protocol.kt — phone↔glasses JSON wire format
│       ├── phone-app/          # Android companion app
│       │   ├── tars/           # TarsClient (JWT WS), TarsAuthManager, TarsBridgeService
│       │   └── glasses/        # RokidSdkManager (CXR-M), GlassesConnectionManager, WakeSignalManager
│       ├── glasses-app/        # HUD app running on Rokid AR Lite
│       │   ├── ui/HudScreen.kt # Jetpack Compose — 480×640 green micro-LED
│       │   ├── service/        # PhoneConnectionService (CXR-S bridge)
│       │   └── input/          # GestureHandler (temple touchpad)
│       ├── settings.gradle.kts # Includes Rokid Maven repo with credentials from local.properties
│       └── local.properties    # NOT committed — rokid.clientSecret, rokid.accessKey,
│                               # rokid.maven.username, rokid.maven.password
│
├── packages/
│   ├── types/                  # shared TypeScript types
│   └── config/                 # shared eslint, tsconfig
│
├── infrastructure/
│   ├── docker/
│   │   ├── docker-compose.yml
│   │   ├── docker-compose.prod.yml
│   │   ├── Dockerfile.web
│   │   └── Dockerfile.harness
│   ├── nginx/nginx.conf
│   └── scripts/
│       ├── setup.sh            # fresh server bootstrap
│       └── deploy.sh
│
├── .github/workflows/
│   ├── deploy-web.yml
│   ├── deploy-harness.yml
│   └── ci.yml
│
├── .env.example
├── turbo.json
├── package.json
└── README.md
```

---

## 10. Environment Variables

```bash
# Server
SERVER_IP=72.60.234.180
SERVER_SSH=root@72.60.234.180

# GitHub
GITHUB_REPO=https://github.com/mikevillargr/TARS

# Z.ai (Tier 2 — GLM models)
ZAI_API_KEY=your_zai_api_key_here

# Anthropic
ANTHROPIC_API_KEY=sk-ant-your_anthropic_api_key_here

# Database (set during server bootstrap)
DATABASE_URL=postgresql://tars:password@postgres:5432/tars
REDIS_URL=redis://redis:6379

# Auth (generate password hash during bootstrap)
TARS_USERNAME=mike
TARS_PASSWORD_HASH=bcrypt_hash_here
JWT_SECRET=generate_random_32_chars
SESSION_SECRET=generate_random_32_chars

# Connectors (fill in during Session 4)
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=
GCAL_CLIENT_ID=
GCAL_CLIENT_SECRET=
FIREFLIES_API_KEY=

# Push notifications (generate during Session 9)
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=

# Agent jobs
CLAUDE_CODE_PATH=/usr/local/bin/claude
REPOS_BASE_PATH=/home/tars/repos
```

---

## 11. Auth

Single user. Username + password. No registration flow.

- Bcrypt hashed password stored in env var `TARS_PASSWORD_HASH`
- Login returns JWT stored in httpOnly cookie
- JWT verified on every harness API request
- Next.js middleware protects all routes
- Generate hash once at setup: `python -c "import bcrypt; print(bcrypt.hashpw(b'yourpassword', bcrypt.gensalt()).decode())"`

---

## 12. Deployment Process

### Philosophy
- **Local first** — all development happens locally
- **Commit often** — save progress to GitHub frequently with clear commit messages
- **Never push to main without explicit instruction** — main is production
- **Releases are explicit** — tagged with semver, full release notes required

---

### SSH Access Rules — CRITICAL

The production server has fail2ban. **Hammering repeated SSH connection attempts will trigger a server-side IP block.**

**Rules:**
1. **Never run retry loops** against SSH. One failed attempt = stop, report to Mike, wait for instruction. Do NOT auto-retry in a loop.
2. **If the server appears unreachable**, try once, then stop. Do not keep retrying.
3. **Deployment commands** (run once, no loops):
```bash
# Pull latest
ssh tars "cd /opt/tars && git pull origin main"

# Run migrations
ssh tars "cd /opt/tars/apps/harness && source .venv/bin/activate && python3 -m alembic upgrade head"

# Restart harness
ssh tars "pm2 restart tars-harness"

# Build and deploy web
ssh tars "cd /opt/tars/apps/web && npm run build && cp -r .next/static .next/standalone/apps/web/.next/ && mkdir -p .next/standalone/apps/web/public && cp -r public/* .next/standalone/apps/web/public/ && pm2 restart tars-web"
```
Note: `ssh tars` is an alias in `~/.ssh/config` on the dev machine. Never use the raw IP directly.

---

### Branch Strategy

```
main          active development + production
              all work happens here
              deploy by pushing a version tag

feature/*     optional, for large isolated features
              merge into main when complete
```

No dev environment exists yet. If a dev server is provisioned later,
a dev branch and deploy pipeline can be added at that time.

---

### Daily Development Workflow

```
1. All work done locally (Next.js dev server + FastAPI uvicorn + Docker Compose for Postgres/Redis)

2. Commit frequently to main — after every meaningful chunk:
   git add .
   git commit -m "feat: add chat streaming endpoint"
   git push origin main

3. Commit message format:
   feat:     new feature
   fix:      bug fix
   chore:    config, deps, tooling
   refactor: code restructure, no behavior change
   docs:     documentation only

4. Deploy by pushing a version tag (triggers GitHub Actions deploy pipeline)
```

---

### Local Development Stack

```
# Start local dependencies
docker-compose up -d postgres redis

# Start harness
cd apps/harness
uvicorn main:app --reload --port 8000

# Start web
cd apps/web
npm run dev

# Access
Web:     http://localhost:3000
Harness: http://localhost:8000
API docs: http://localhost:8000/docs
```

---

### Release Process (explicit instruction required)

When Mike says "release" or "deploy to production":

```
1. Agree on version number (semver: MAJOR.MINOR.PATCH)
   MAJOR: breaking changes or major new capability
   MINOR: new features, backward compatible
   PATCH: bug fixes only

2. Claude Code generates full release notes covering:
   - What changed
   - New features
   - Bug fixes
   - Breaking changes if any
   - Migration steps if needed

3. Mike reviews and approves release notes

4. Claude Code executes:
   git checkout main
   git merge dev
   git tag -a v1.0.0 -m "Release v1.0.0"
   git push origin main --tags

5. GitHub Actions triggers automatically:
   CI: lint + typecheck
   Build: Next.js + FastAPI
   Deploy: SSH to 72.60.234.180
   Health check: GET /api/health
   Rollback: if health check fails, redeploy previous tag

6. Dev branch continues from main after release:
   git checkout dev
   git merge main
```

---

### GitHub Actions Pipeline

```
Trigger: push to main (tags only for production deploy)
    |
CI: lint, typecheck (Turborepo detects changed apps)
    |
Changed: apps/web      -> build Next.js -> SSH to 72.60.234.180 -> docker-compose up
Changed: apps/harness  -> build FastAPI -> SSH to 72.60.234.180 -> docker-compose up
Changed: both          -> parallel deploy
    |
Health check: GET /api/health
    |
Success: notify
Failure: rollback to previous tag + notify
```

---

### Versioning Starting Point

```
v0.1.0  Session 1 complete - foundation, repo, server bootstrap
v0.2.0  Session 2 complete - harness core, chat working
v0.3.0  Session 3 complete - memory layer live
v0.4.0  Session 4 complete - connectors + cron
v0.5.0  Session 5 complete - tasks + meetings
v0.6.0  Session 6 complete - agent jobs + artifacts
v0.7.0  Session 7 complete - document ingest
v0.8.0  Session 8 complete - calendar
v1.0.0  Session 9 complete - polish, PWA, full production deploy
...
v2.4.6  (latest before this session) — Rokid glasses HUD + TTS improvements
v2.5.0  Session 9 continued — Kokoro TTS voice settings, chat composer redesign (mic-on-right),
        TTS stop bug fix (AbortController Set), amber speaking pill, header mic enlarged
v2.6.0  Rokid glasses HUD — full TTS, photo flow, brightness, session polish
v2.6.1  Second Brain star/favorite — card + modal star toggles, Starred sidebar filter,
        starred-first sort, STAR_BOOST relevance boost in retrieval (migration j7k8l9m0n1o2)
v2.7.0  Instrument design language — JetBrains Mono promoted to the system label voice
        (.tars-label across all 11 views), heading discipline (medium weight + tight
        tracking), dropped Lora, accent-as-signal (moss), bracketed-mono model chips,
        mono wordmark + boot-style login/empty states. Web-only, no schema change.
v2.7.1  Fix: chart requests no longer produce a Word doc — document-generation prompt
        rule now excludes charts/graphs/plots (chart-as-Python-code path always wins,
        no fabricated image links); generate_chart tool gating keyed on the effective
        tier's provider instead of tier3_provider. Harness-only, no schema change.
v2.7.2  Fix: charts now actually render on GLM tiers — generate_chart given to ALL
        providers (GLM narrates instead of emitting code blocks but calls tools
        reliably; tool runs matplotlib server-side → chart_image card). CHARTS prompt
        rewritten to always call the tool. Harness-only, no schema change.
v2.7.3  Fix: blank charts — both render paths appended their own savefig() AFTER the
        model's code, which ended with savefig(bogus path)+close('all'); the appended
        savefig fired post-close and wrote a blank canvas. New _strip_chart_io() removes
        the model's show/savefig/close so the harness saves while the figure is open.
        Tool desc + CHARTS prompt now say build-only. Harness-only, no schema change.
v2.9.4  Fix: Second Brain auto-save — three bugs. (1) Stale closure: saveDocument is now a
        stable useCallback([]) reading all fields from a saveValuesRef updated after every render.
        (2) Changes lost on navigate: flush useEffect fires saveDocument() when itemId changes,
        guarded by hasUnsavedChanges + currentItemIdRef to prevent stale setItem race. (3) Spurious
        normalization save on open: TiptapEditor setContent(_, false) suppresses onUpdate on initial
        load so docMarkdown and lastSavedContent start equal. Web-only, no schema change.
v2.9.3  Fix: mention chip clicks fully wired — contact chip → ContactPopup, knowledge item chip
        → navigate to that item's modal, task chip → /tasks?id=. Backlinks panel now shows
        source_title (the item doing the referencing, not the target) and each row is clickable.
        ContactPopupContext.openContact now accepts HTMLElement | DOMRect. Links API now enriches
        source_title alongside target_title. Harness + web.
v2.9.2  Fix: Contacts — all contacts now load (limit 100 → 5000 in frontend call); phone numbers
        shown in detail panel header + Contact Info section in Overview tab (all emails + phones
        from Google sync). Web-only, no schema change.
v2.9.1  Fix: Second Brain mobile header layout — title + 6-icon view toggle no longer crush on
        375px. Mobile: title row + full-width view toggle row below. Desktop: unchanged single row.
        Page-level Capture button hidden on mobile (topbar + already handles it). Web-only, no
        schema change.
v2.9.0  Feature: Second Brain Notion-like layer — universal linking, properties, views, Contacts.
        Universal links table (polymorphic, bidirectional). Per-item properties (status/type/
        priority + custom) with Haiku auto-fill. [[mention]] syntax with Tiptap MentionExtension
        + tippy.js dropdown + bulk link sync. CalloutNode and ToggleNode Tiptap extensions. 6 view
        modes (grid/list/kanban/gallery/table/timeline) with localStorage persistence. Contacts
        page (two-panel, ContactDetailPanel tabs, ContactPopup floating, ContactPopupContext).
        /contacts/{id}/context endpoint. Migrations: k8l9m0n1o2p3 (links), l9m0n1o2p3q4 (properties).
v2.8.0  Feature: per-tier backup models + task-category forced routing. (1) Each tier gets
        an optional backup provider+model; on a pre-content primary failure the harness emits
        model_fallback and re-runs on the backup, with an in-memory per-tier circuit breaker
        that probes the primary each turn and reverts on recovery. (2) Requests are classified
        into 6 task categories (quick_lookup/writing/coding/data_viz/analysis/general) via
        router.classify_full (two-token classifier); Settings can force a model per category,
        overriding the tier's model. New backup .env fields + category_routing_json; new
        GET/PATCH /api/settings/model-routing/categories. No DB migration (config in .env).
```

---

## 13. Pre-Build Checklist

### Infrastructure
- [ ] Hostinger KVM4 — new dedicated server provisioned
- [ ] RunPod account created, credits added
- [ ] RunPod network volume created (50GB+)

### APIs
- [ ] Anthropic API key (console.anthropic.com)
- [ ] Fireflies API key (fireflies.ai)
- [ ] Google Cloud Console project — Gmail API + Calendar API enabled, OAuth 2.0 credentials created

### Development
- [ ] GitHub repo created (private, named tars)
- [ ] Docker Desktop running locally
- [ ] Node.js 20+ local
- [ ] Python 3.11+ local

### Optional
- [ ] Sentry account (error tracking)
- [ ] UptimeRobot (uptime monitoring)

---

## 14. Build Session Order

| Session | Focus | Deliverable | Status |
|---|---|---|---|
| 1 | Foundation | Repo, Turborepo, Docker Compose, Postgres+pgvector, FastAPI skeleton, Next.js shell, GitHub Actions CI | ✅ Done |
| 2 | Harness core | Model client, router classifier, context assembler stubs, chat endpoint with streaming, Chat UI end-to-end | ✅ Done |
| 3 | Memory layer | Mnemon read/write, Second Brain ingest (URL+text), embeddings, context injection in chat | ✅ Done |
| 4 | Connectors + cron | Gmail, Google Calendar connectors, Fireflies sync, prompt cron system | ✅ Done |
| 5 | Tasks + Meetings | Task CRUD, Fireflies webhook, meeting processor, action item extraction to tasks | ✅ Done |
| 6 | Agent Jobs + Artifacts | Claude Code subprocess executor, supervised approval flow, Agent Jobs UI, Artifacts view + auto-save hook | ✅ Done |
| 7 | Document ingest | PDF/PPTX/DOCX parsers, chunking pipeline, Second Brain full UI | ✅ Done |
| 8 | Calendar | Google Calendar sync, Calendar view, event type color coding | ✅ Done |
| 9 | Polish + Deploy | PWA manifest + share target, push notifications, Settings (incl. Voice section), Kokoro TTS embedded, chat composer redesign (mic-on-right), deploy to KVM4 | 🔄 In Progress |
| 10 | Rokid Glasses | `/api/rokid/ws` WebSocket bridge, Android phone-app (TarsClient), glasses HUD (Jetpack Compose on 480×640 green micro-LED) | 🔄 In Progress |

---

## 15. Design

Magic Patterns prototype: https://www.magicpatterns.com/c/77rtra481stk1dtgfpjkp7

### Design language — v2 "Instrument" (since v2.7.0)
TARS reads like a precise machine's readout. Warm moss/amber/parchment palette retained;
the *character* lives in typography and presentation. Refero references: Warp, Linear
Changelog, Operate.

Rules (enforced in `apps/web/app/globals.css`):
- **Two faces, clear jobs.** Inter = human-readable prose (chat, titles, descriptions).
  JetBrains Mono = the *instrument layer* — every label, eyebrow, column header, status,
  count, timestamp, badge, model tag, kbd hint. **Lora removed.** `--font-heading` now
  resolves to the sans stack.
- **Instrument label primitive:** `.tars-label` (mono, 11px, uppercase, 0.14em tracking,
  `--c-ink-faint`); `--moss`/`--muted` colour variants. Use it for all microtype labels.
  Title helpers: `.tars-title` / `.tars-display`.
- **Heading discipline:** h1–h6 are weight 600 (not bold) with `letter-spacing -0.02em`.
- **Accent = signal.** Moss is the only accent (active nav, eyebrow prompt, focus ring,
  primary action, live indicator). Amber/rose are status-only. Badges are mono + uppercase.
- **Depth by surface, not shadow** — hairline borders + the canvas→surface→surface-2 stack.
- Signature touches: mono "TARS" wordmark + sublabel, topbar Agent-Active pill, chat
  "STANDBY" boot empty state, bracketed-mono model chips, login as the authorization moment.

Design decisions (let Magic Patterns + Refero research decide):
- Color palette, typography, spacing driven by Refero research
- Light/dark mode: system-aware, follows OS setting
- Mobile: PWA installed on home screen, bottom tab bar (Chat, Tasks, Calendar, Second Brain, More)

Pending corrections to apply in MP:
- Mobile bottom tab bar: Chat, Tasks, Calendar, Second Brain, More (opens full menu)
- Quick Capture: add Document upload + Voice memo types
- Second Brain: add Collections sidebar panel
- Calendar: new view added (see component spec above)
- Artifacts: new view added (see component spec above)
- Review remaining views: EmailDigest, CronManager, Connectors, MemoryBrowser, Settings

---

## 16. Rokid Glasses Integration

Stream TARS responses token-by-token onto Rokid AR Lite glasses.

### Architecture

```
TARS Harness ──── ws /api/rokid/ws?token=<jwt> ──── Android Phone ──── Bluetooth (CXR-M SDK) ──── Rokid Glasses
    │                                                      │                                            │
rokid.py                                         TarsBridgeService                              HudScreen.kt
Proxies chat SSE                                 TarsClient (JWT WS)                        480×640 green HUD
→ glasses wire format                            GlassesConnectionManager                   Jetpack Compose
                                                 WakeSignalManager
```

### Key files

| File | Purpose |
|---|---|
| `apps/harness/api/routes/rokid.py` | FastAPI WebSocket — proxies TARS SSE to glasses protocol |
| `apps/rokid/phone-app/tars/TarsClient.kt` | JWT WebSocket client connecting to TARS harness |
| `apps/rokid/phone-app/tars/TarsAuthManager.kt` | Login → JWT, persists to SharedPreferences |
| `apps/rokid/phone-app/tars/TarsBridgeService.kt` | Foreground service bridging TARS ↔ glasses |
| `apps/rokid/phone-app/glasses/RokidSdkManager.kt` | Rokid CXR-M SDK (Bluetooth to glasses) |
| `apps/rokid/phone-app/glasses/WakeSignalManager.kt` | Wakes display before streaming content |
| `apps/rokid/glasses-app/ui/HudScreen.kt` | Composable HUD — green monochrome, JetBrains Mono |
| `apps/rokid/glasses-app/service/PhoneConnectionService.kt` | CXR-S SDK (receives from phone) |
| `apps/rokid/glasses-app/input/GestureHandler.kt` | Temple touchpad gesture recognition |
| `apps/rokid/shared/Protocol.kt` | JSON wire format shared between phone↔glasses |

### Phone↔glasses protocol (wire-compatible with clawsses)

Phone → Glasses: `connection_update`, `session_list`, `chat_message`, `agent_thinking`, `chat_stream`, `chat_stream_end`, `wake_signal`
Glasses → Phone: `user_input`, `list_sessions`, `switch_session`, `create_session`, `wake_ack`, `start_voice`

### SDK dependencies

Both pulled from `https://maven.rokid.com/repository/maven-public/` (requires Rokid developer account).

| SDK | Module | Side |
|---|---|---|
| CXR-M | `com.rokid.cxr:client-m:1.0.8` | Phone app |
| CXR-S | `com.rokid.cxr:cxr-service-bridge:1.0` | Glasses app |

### local.properties (apps/rokid/ — never committed)

```properties
rokid.clientSecret=your-client-secret      # from developer.rokid.com app
rokid.accessKey=your-access-key            # from developer.rokid.com app
rokid.maven.username=your@email.com        # Rokid account login
rokid.maven.password=yourpassword          # Rokid account login
```

### Debug / emulator mode

No hardware or SDK credentials needed. Set `debugMode = true` in HudActivity (auto-detected via `Build.FINGERPRINT.contains("generic")`). Phone emulator starts WebSocket server on port 8081; glasses emulator connects to `10.0.2.2:8081`. Full streaming flow works end-to-end.

### Status

- Harness WebSocket endpoint: done
- Android phone-app (TarsClient, bridge service, settings UI): done
- Android glasses-app (HUD, gestures, CXR-S bridge): done
- Rokid developer account + app creation: pending (required for BT pairing + Maven)
- Physical hardware testing: pending

---

*This document is the single source of truth for the TARS project. Paste into Claude Code at the start of every build session.*
