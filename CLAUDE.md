# TARS — Master Specification
> Personal AI Operating System for Mike Villar
> Last updated: May 2026 — v4 (added deployment process, semver versioning)
> Status: Pre-build — all decisions locked, ready for Session 1

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
| Tier 2 inference | RunPod Serverless | GPU on demand, model set via WORKHORSE_MODEL |
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
| App server | Hostinger KVM4 (NEW, dedicated) | 4 vCPU, 16GB RAM, 200GB NVMe | ~$10-15/mo |
| Existing server | Hostinger KVM4 (keep) | Current workloads untouched | Current price |
| GPU inference | RunPod Serverless | RTX 4090, network volume 50GB+ | ~$20-40/mo |
| Frontier API | Anthropic API | Pay per token | ~$10-20/mo |
| Domain | IP-based for now | Subdomain/domain decision deferred | - |

### RunPod Setup
- Use **Secure Cloud** not Community Cloud for production
- Attach **persistent network volume** (50GB+) to store model weights
- Models downloaded once to volume, no re-download on cold start
- Cold start ~10-30s on first request, harness falls back to Claude during warmup

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
    +-- Tier 2 (most tasks) -------> RunPod Serverless GPU
    |   Email summarization          ~2-4s (warm); cold falls back to Haiku/Sonnet
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
| Tier 2 workhorse | RunPod GPU | Model configured via `WORKHORSE_MODEL` env var |
| Tier 3 frontier | Claude Sonnet | Tool use, long context, client-facing work |
| Embeddings | nomic-embed-text | pgvector semantic search |

### Cold-start fallback
```
RunPod Tier 2 unavailable →
  message ≤ 500 chars → Haiku (instant)
  message > 500 chars → Sonnet (full quality)
```

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

EmailDigest {
  id, user_id, period_start, period_end
  summary, action_items[], raw_thread_ids[]
  created_at
}

CronJob {
  id, user_id, name, schedule
  connector_ids[], last_run_at
  last_run_status // "success" | "failed" | "running"
  next_run_at
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

## 8. Application Components (11)

### Navigation Order (12 components)
Chat, Tasks, Meetings, Calendar, Second Brain, Agent Jobs, Artifacts, Email Digest, Cron Manager, Connectors, Memory Browser, Settings

### Component Specs

**1. Chat**
- Conversation list, message thread, model badge per message
- Tool call chips inline (e.g. "Queried Gmail", "Created Task")
- Context bar showing active Mnemon injections
- Streaming/thinking indicator, focus mode
- Input: text, attach, voice, send

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
- Semantic search bar, domain/tag/collection filters
- Item cards: favicon/thumbnail, title, summary excerpt, personal note, tags
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

**8. Email Digest**
- Timeline of past digests by date
- Each digest: summary, extracted action items (Create Task button), source thread count
- Next digest countdown, manual trigger button
- Digest settings: schedule, labels/folders, summary depth

**9. Cron Manager**
- Job list: name, human-readable schedule, last run status, next run time
- Status: Active / Paused / Failed / Running
- Enable/disable toggle, manual trigger
- Run history with output per execution

**10. Connectors**
- Grid of connector cards: icon, name, status, last synced, capabilities
- Connect/disconnect flow
- Webhook log per connector showing recent inbound events
- Which components use each connector

**11. Memory Browser**
- Memory list: content, domain badge, source, importance score, date
- Filter by domain, source, date, importance
- Semantic search across all memories
- Edit and delete individual memories
- Manual memory addition

**12. Settings**
- Profile and preferences
- Model routing config: tier assignments
- Notification preferences per component
- PWA install prompt
- API key management
- Cron default schedule config

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
│   │   │   │   ├── email-digest/
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
│   │   ├── lib/
│   │   │   ├── api-client.ts
│   │   │   ├── websocket.ts
│   │   │   └── push-notifications.ts
│   │   └── public/manifest.json  # PWA + share target
│   │
│   └── harness/                # FastAPI
│       ├── api/routes/         # one file per component
│       ├── core/
│       │   ├── router.py       # tier classification
│       │   ├── context_assembler.py
│       │   ├── model_client.py # Ollama + Anthropic unified
│       │   └── streaming.py
│       ├── memory/
│       │   ├── mnemon.py
│       │   ├── second_brain.py
│       │   ├── embeddings.py
│       │   └── chunker.py
│       ├── connectors/
│       │   ├── base.py         # Connector interface
│       │   ├── gmail.py
│       │   ├── google_calendar.py
│       │   ├── fireflies.py
│       │   └── registry.py
│       ├── agents/
│       │   ├── executor.py     # Claude Code subprocess
│       │   ├── job_manager.py
│       │   └── approval.py
│       ├── jobs/               # BullMQ cron definitions
│       │   ├── scheduler.py
│       │   ├── morning_brief.py
│       │   ├── email_digest.py
│       │   └── meeting_processor.py
│       ├── ingest/
│       │   ├── pipeline.py
│       │   ├── parsers/        # pdf, pptx, docx, url
│       │   └── enricher.py
│       └── db/
│           ├── models.py       # SQLAlchemy
│           ├── migrations/     # Alembic
│           └── session.py
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

# RunPod
RUNPOD_API_KEY=rpa_your_runpod_api_key_here
RUNPOD_ENDPOINT_32B=https://api.runpod.ai/v2/your_32b_endpoint/runsync
RUNPOD_ENDPOINT_8B=https://api.runpod.ai/v2/your_8b_endpoint/runsync
ROUTER_MODEL=Qwen/Qwen3-8B
WORKHORSE_MODEL=Qwen/Qwen3-32B-AWQ

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

The production server (`72.60.234.180`) sits behind Hostinger's network firewall.
**Repeated failed SSH connection attempts will trigger an IP-level block that takes 15–30 min to expire and locks out ALL traffic (SSH + HTTPS), not just SSH.**

**Always use `hostinger-ollama` alias (never the raw IP directly):**
```bash
ssh hostinger-ollama "your command"
```

This routes through `hostinger-vps` (76.13.191.149) as a ProxyJump, which bypasses the rate-limit trigger.

**Rules:**
1. **Never run retry loops** that hammer SSH connections. One failed attempt = stop and investigate, do not auto-retry in a loop.
2. **Always use the alias** `hostinger-ollama` from `~/.ssh/config` — it has `ProxyJump hostinger-vps` set.
3. **If the server appears unreachable**, first verify via jump host: `ssh hostinger-vps "ping -c 1 72.60.234.180"` — if ping works from there, the issue is a local IP block, not a server outage.
4. **Never call `ssh root@72.60.234.180` directly** — always use the alias.
5. **Deployment commands:**
```bash
# Pull latest
ssh hostinger-ollama "cd /opt/tars && git pull origin main"

# Run migrations
ssh hostinger-ollama "cd /opt/tars/apps/harness && source .venv/bin/activate && python3 -m alembic upgrade head"

# Restart harness
ssh hostinger-ollama "pm2 restart tars-harness"

# Build and deploy web
ssh hostinger-ollama "cd /opt/tars/apps/web && npm run build && cp -r .next/static .next/standalone/apps/web/.next/ && mkdir -p .next/standalone/apps/web/public && cp -r public/* .next/standalone/apps/web/public/ && pm2 restart tars-web"
```

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

| Session | Focus | Deliverable |
|---|---|---|
| 1 | Foundation | Repo, Turborepo, Docker Compose, Postgres+pgvector, FastAPI skeleton, Next.js shell, GitHub Actions CI |
| 2 | Harness core | Model client, router classifier, context assembler stubs, chat endpoint with streaming, Chat UI end-to-end |
| 3 | Memory layer | Mnemon read/write, Second Brain ingest (URL+text), embeddings, context injection in chat |
| 4 | Connectors + cron | Gmail, Google Calendar connectors, morning brief cron, email digest job |
| 5 | Tasks + Meetings | Task CRUD, Fireflies webhook, meeting processor, action item extraction to tasks |
| 6 | Agent Jobs + Artifacts | Claude Code subprocess executor, supervised approval flow, Agent Jobs UI, Artifacts view + auto-save hook |
| 7 | Document ingest | PDF/PPTX/DOCX parsers, chunking pipeline, Second Brain full UI |
| 8 | Calendar | Google Calendar sync, Calendar view, event type color coding |
| 9 | Polish + Deploy | PWA manifest + share target, push notifications, Settings, deploy to new KVM4 |

---

## 15. Design

Magic Patterns prototype: https://www.magicpatterns.com/c/77rtra481stk1dtgfpjkp7

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

*This document is the single source of truth for the TARS project. Paste into Claude Code at the start of every build session.*
