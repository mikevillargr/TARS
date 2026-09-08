# TARS — Master Specification
> Personal AI Operating System for Mike Villar
> Last updated: September 2026 — v2.18.9 (post-sessions 1–9+, live on production;
> Today screen + Signals, signal generation live)
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

Signal {
  id, user_id
  kind          // "action" | "fyi"
  source        // "gmail" | "fireflies" | "calendar" | "project" | "feed" | "strava"
  source_label, source_ref, citation
  context_label // resolved client name, or (email only, no client match) a coarse
                // category ("Billing"/"Legal"/"Banking"/"Vendor"/"Recruiting"/
                // "Scheduling"/"Internal") — rendered as its own chip, never both
  title, urgency // "normal" | "time" | "overdue"
  reasoning     // shown under the `why` disclosure
  actions[]     // [{kind, label, payload}] — [0] is TARS's pick
  calendar_event // JSON when the signal implies a commitment (drives .ics)
  status        // "open" | "snoozed" | "done" | "dismissed"
  snoozed_until, acted_kind, acted_at
  result_ref    // what it became: reminder / task / event / conversation id
  dedupe_key    // unique per user — stops a dismissed signal returning next sweep
  created_at, updated_at
}
// A Signal is NOT a Task. A Task is work you committed to; a Signal is a claim
// you might need to. Acting on one usually produces a To-Do, then the Signal is done.

Reminder {
  id, user_id
  text          // the reminder text
  done          // boolean — checked off
  due_at        // optional, groups the reminder into Overdue/Today/Tomorrow/Upcoming
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
  source        // "chat" | "cron" | "meeting" | "upload" ("agent_job" is legacy — Agent Jobs retired 2026-09)
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

FeedSource {
  id, user_id
  name, url              // url = resolved feed URL
  original_url           // what the user pasted
  source_type            // "rss" | "youtube" | "reddit" | "google_news" | "website"
  category               // user-defined string
  favicon_url
  enabled
  fetch_interval_hours   // default 4
  last_fetched_at, error_count, last_error
  created_at
}

FeedItem {
  id, feed_source_id, user_id
  title, url, author
  summary                // excerpt ≤500 chars
  content                // full text
  image_url
  published_at, fetched_at
  media_type             // "article" | "video" | "podcast" | "link"
  media_url              // YouTube embed URL or podcast audio URL; null for articles/links
  is_read, is_starred
  knowledge_item_id      // FK to knowledge_items; set when saved to Second Brain
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
| Gmail (Personal) | read, write (send/reply) — separate account slot, same OAuth credentials, state=personal |
| Google Calendar | read, write |
| Google Calendar (Personal) | read, write (create/update/delete) — separate account slot |
| Google Workspace | search Drive + read & write Docs/Sheets/Slides by link (Drive export → existing parsers) |
| Google Workspace (Personal) | read, write — separate account slot |
| Fireflies | read, webhook (meeting.ended) |
| Growth Rocket tools | read, write (RedditPipe, AlwaysSunny, Poe grader) |

### Future Connectors (not planned, just noted)
Linear, GitHub — plug in when needed

---

## 8. Application Components (14)

### Navigation Order (14 components)
Today, Chat, Projects, To-Dos, Meetings, Contacts, Calendar, Feed, Second Brain, Artifacts, Cron Manager, Connectors, Mnemon, Settings

### Component Specs

**1. Today** (route: /today)
The landing surface. Signals TARS inferred across email, meetings, calendar, and projects,
each needing a decision. Replaces the old prompt-cron daily digest that dumped prose into a
chat conversation.

- Header is an instrument readout, not a greeting: `BRIEF · MON 07 SEP · 06:40` plus a verdict
  ("2 can't wait" / "Nothing urgent" / "All clear"), never a raw count
- Signal cards grouped by urgency (overdue / today / when you can). **Never truncated** — a
  heavy morning should look heavy
- Each card: source badge + age, imperative title, one specifically-named primary action
  (never "Approve"), alternates behind an overflow menu, collapsible `why` with reasoning +
  citation, snooze, dismiss
- Dismiss and snooze are recoverable — 5s undo bar with a draining hairline; cleared/snoozed
  are visitable states, not a void
- Swipe left to dismiss, right to snooze — works on touch and on trackpad (wheel deltaX)
- "Add to calendar" on signals carrying an event → `.ics` from a real endpoint (never a blob;
  blob downloads break in the installed PWA shell)
- Ambient field: a state-driven backdrop, `/today` only. Moss glow tracks a sun arc across the
  day, amber peaks at golden hour, intensity scales with open signal count, ALL CLEAR collapses
  it to the boot glow. Grain seeded per-date so no two days render identically
- Three distinct blank states: **earned** (you cleared it — shows a session receipt),
  **parked** (everything snoozed, nothing done), **quiet** (nothing came in). Conflating them
  makes the screen lie two-thirds of the time
- FYI rows (kind="fyi") render as plain text, no card weight
- **Generation** (`jobs/signal_generator.py`, `signal_sweep` every 4h, or
  `POST /api/signals/generate` on demand). Five detectors, split by whether the answer is a
  fact or a judgement:
  - *Deterministic, no model:* stalled/overdue tasks, Fireflies action items that never became
    work (**grouped by meeting**, not one card per item — one real week produced 225 items),
    overlapping calendar events, inbound Gmail threads still awaiting a reply (read off the
    SENT label on the thread's last message, not unread status alone — catches read-but-
    never-answered mail too)
  - *Model-assisted (Tier 2, strict JSON):* commitments you made in meeting transcripts,
    surfaced with the verbatim quote; and, for each awaiting-reply Gmail thread, whether it
    actually needs anything from you (newsletters/receipts/automated mail correctly resolve to
    "no" — an empty result is a valid, common answer, not a failure to try harder)
  - Meeting/calendar/email signals carry a best-effort **`context_label`**, rendered as its
    own chip (never folded into the title or source badge — titles stay clean imperatives).
    Resolved from the Contacts graph (attendee/sender email → synced Google Contacts'
    organization field) — not a hardcoded client list, so it stays correct as clients change.
    For email with no client match, the same chip slot falls back to a coarse category
    (Billing/Legal/Banking/Vendor/Recruiting/Scheduling/Internal) from the Tier 2 model —
    client resolution always takes priority; category is strictly a fallback, never both
  - Fireflies action items explicitly owned by another meeting attendee are filtered out
    (Fireflies extraction has no notion of "mine"); unassigned items stay in
  - `dedupe_key` is checked against signals in **any** status, so a dismissed signal never
    returns. Deliberate: re-nagging is how a triage surface loses trust — for email this also
    means dismissing an awaiting-reply thread means "no action was needed" and it won't
    resurface unless a genuinely new message arrives on it

**2. Chat**
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

**3. Projects** (route: /tasks)
- Kanban: Inbox / Todo / In Progress / Done / Snoozed
- Cards: source badge, priority color bar, due date, connector sync indicator
- Right panel detail: full description, source reference, activity log
- Bulk actions, inline quick-add, filter/sort bar

**3b. To-Dos** (route: /reminders)
- Quick personal checklist — no pipeline, no priority, no connectors
- Inline quick-add at top: type and press Enter
- Groups: Overdue / Today / Tomorrow / Upcoming / Someday / Done (collapsible)
- Inline double-click to edit text; circle checkbox to check off (optimistic)
- Optional due date shown as chip on each item; overdue items flagged in rose
- Agent tools: `create_reminder` (instant, no approval gate) and `list_reminders`
- Distinct from Projects: use To-Dos for personal "don't forget" items; Projects for work action items with tracking

**4. Meetings**
- List with status badge: Processing / Ready / Action Required
- Detail: Summary tab, Transcript tab (speaker labels + timestamps), Actions tab
- Action items: owner, due date suggestion, one-click Create Task
- Related Second Brain items surfaced automatically

**5. Calendar**
- Month / Week / Day toggle, Week view default
- Event types color-coded: meetings, tasks with due dates, cron jobs, agent jobs
- Click event: opens right panel detail with link to source view
- Mini month picker sidebar, Today button
- Mobile: Day view default, swipeable

**5b. Feed** (route: /feed)
- Three-panel layout: category sidebar (source list, unread counts, "+ Add Feed"), compact article list, reading pane
- Subscribe to any URL: RSS/Atom, website (auto-discovers `<link rel="alternate">`), YouTube channel (XML feed), Reddit (/r/subreddit.rss), Google News topics
- Four media types:
  - `article` — sanitized prose HTML in reading pane
  - `video` — YouTube iframe embed + description
  - `podcast` — HTML5 `<audio controls>` player + episode notes
  - `link` — summary excerpt + "Open link →" button
- Unread state: left 3px moss bar on unread rows; dimmed to 60% opacity once read; clicking auto-marks read
- Actions in reading pane: Star · Save to Brain (single-click → creates KnowledgeItem, green checkmark) · Chat with TARS · Open original
- "Chat with TARS" flow: `POST /api/feed/items/{id}/chat` → harness creates Conversation + pre-seeded user Message with article content → frontend navigates to `/chat/{conversation_id}`
- Add Feed modal: "Paste URL" tab (preview with 3 sample items) + "Discover" tab (Feedly search API, requires `FEEDLY_API_KEY`) + "Presets" tab (curated packs)
- Preset packs (zero-config onboarding): ai_tech, digital_marketing, cycling, business, philippines, design
- Rolling 90-day item cleanup; starred and saved-to-brain items kept indefinitely
- Background hourly sync job (`feed_sync` in scheduler); per-source configurable interval (default 4h)

**6. Second Brain**
- Collections sidebar panel (named groups of items)
- Masonry/card grid + list toggle
- Semantic search bar, domain/tag/collection filters; **Starred** sidebar filter (amber star) for pinned items
- Item cards: favicon/thumbnail, title, summary excerpt, personal note, tags; star toggle in card corner (shows on hover, persists `starred`) — starred items sort first
- Detail modal: star toggle in header (optimistic, persisted via PATCH)
- Retrieval boost: starred items get a `STAR_BOOST` (0.06) reduction in effective cosine distance in `second_brain.search`, so user-pinned knowledge is favored when injected into TARS's context (semantic + keyword-fallback paths)
- Right panel: full content, annotation textarea, related items, access history
- PWA share target (native share sheet on mobile)
- Quick Capture: URL, Note, Document upload, Voice memo

**7. Artifacts**
A generated output library. Every file TARS produces is automatically saved, versioned, and retrievable here.

> Note: the Agent Jobs feature (autonomous Claude Code subprocess self-modifying production) was
> retired in 2026-09. It used to be one of the sources listed below and in the `source` enum on
> the `Artifact` data model (§6) — historical artifacts tagged `agent_job` may still exist, but no
> new ones will be created that way.

Sources that populate Artifacts automatically:
- Chat responses containing generated files
- Cron job reports
- Meeting exported summaries and transcripts
- Manual uploads for files you want TARS to work on

Features:
- Grid and list view toggle
- Filter by type (Document / Code / Report / Spreadsheet / Transcript), source (Chat / Cron / Meeting / Upload), date, project/client tag
- Semantic search across filenames and file content
- File cards: type icon, filename, source badge, date generated, size
- Right panel detail: full preview for text/markdown/code, Download button, "Open in Chat" button (loads file as context in new chat session), version history timeline, tags, project reference
- Auto-save hook: any model output containing a file triggers save to Artifacts
- Version tracking: regenerating the same document creates a new version linked to the original
- Empty state: explains that files generated by TARS in chat, cron reports, and meetings appear here automatically

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
│   │   │   │   ├── today/          # Today screen — signals triage (landing)
│   │   │   │   ├── chat/
│   │   │   │   ├── today/
│   │   │   │   ├── tasks/
│   │   │   │   ├── meetings/
│   │   │   │   ├── calendar/
│   │   │   │   ├── feed/
│   │   │   │   ├── second-brain/
│   │   │   │   ├── agent-jobs/
│   │   │   │   ├── artifacts/
│   │   │   │   ├── cron/
│   │   │   │   ├── connectors/
│   │   │   │   ├── memory/
│   │   │   │   └── settings/
│   │   │   └── api/            # thin proxy to harness
│   │   ├── components/
│   │   │   ├── today/          # SignalCard, AmbientField
│   │   │   ├── shell/          # sidebar, topbar, right panel
│   │   │   ├── chat/
│   │   │   ├── tasks/
│   │   │   ├── meetings/
│   │   │   ├── calendar/
│   │   │   ├── feed/
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
- **Local first** — all development happens locally, on a branch
- **No direct commits to `main`** — every change starts on a branch (`fix/`, `feat/`, `chore/`,
  `refactor/`, `docs/`); `main` is production and is only ever updated by merging a branch into it
- **Commit often on the branch** — save progress to GitHub frequently with clear commit messages
- **Deploy follows the merge** — once a branch is merged to `main`, deploy promptly (see SSH
  commands below); don't wait for a separate go-ahead on routine changes
- **Formal releases are explicit** — semver tags + full release notes, only when Mike says
  "release" (see Release Process below)

See `AGENTS.md` at the repo root for the full branch → merge → deploy workflow and mandatory
verification steps every agent must follow.

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
main          production — always deployable, never committed to directly

fix/*         one branch per change or task; branch name describes the change
feat/*        merge into main via PR or local merge only when ready to deploy
chore/*
refactor/*
docs/*
```

No dev server exists. There is a long-abandoned `dev` branch in git (hundreds of commits behind
`main`) left over from an earlier workflow — it is not part of the active process; don't merge
into or out of it without checking with Mike first.

---

### Daily Development Workflow

```
1. Branch from main:
   git checkout main && git pull origin main
   git checkout -b fix/short-description

2. Work locally (Next.js dev server + FastAPI uvicorn + Docker Compose for Postgres/Redis)

3. Commit on the branch as you go:
   git add <specific files>
   git commit -m "feat: add chat streaming endpoint"

4. Commit message format:
   feat:     new feature
   fix:      bug fix
   chore:    config, deps, tooling
   refactor: code restructure, no behavior change
   docs:     documentation only

5. Verify (typecheck / import check — see AGENTS.md §5), then merge to main:
   git checkout main && git pull origin main
   git merge --no-ff fix/short-description
   git push origin main

6. Deploy via the manual SSH commands above, promptly after merging. Formal semver-tagged
   releases (which trigger the GitHub Actions deploy workflows) are reserved for when Mike
   explicitly says "release" — see Release Process below.
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
v2.9.5  Feat: mention round-trip — chips survive save/reload. Storage format [[id|type|label]]
        in clean_content. MentionExtension.addStorage().markdown.serialize writes the format;
        .parse.setup adds a markdown-it inline rule that converts it back to <span data-mention>
        which tiptap DOM-parses to a mention node. Harness strips markers before embedding.
        Harness + web, no schema change.
v2.11.3 Feature: multi-account Google — personal Gmail, Calendar, and Drive. Three new connector
        slots (gmail_personal, gcal_personal, google_workspace_personal). OAuth reuses existing
        credentials with state=personal — no Google Cloud Console changes needed. Context assembler,
        read_email tool, and Calendar UI all fan out across both accounts. No DB migration.
v2.18.9 Fix: fact-extraction quality tightened after a manual sample review ahead of the
        v2.18.8 backfill. Two issues found: (1) raw [[id|type|label]] mention markers were
        being fed straight into the extraction prompt (e.g. a client contact reference
        appeared as literal id/type soup) — new _strip_mention_markers replaces markers with
        just the label before both fact-extraction and title-generation see the text.
        (2) The prompt was extracting low-value pseudo-facts from mere questions or requests
        ("user is asking about their ride performance", "user wants email drafted for X") —
        tightened to explicitly exclude questions/requests/"a conversation happened" and
        require a concrete, durable fact (decision, preference, identifying detail, status
        change), with SKIP framed as the common, correct answer rather than a last resort.
        Verified via a 15-message dry-run spread across the affected window before and after:
        before, "how was my ride" and "draft an email to X" both produced junk facts; after,
        both correctly SKIP while genuine updates (e.g. a bike component change) still extract
        cleanly. Harness-only, no schema change.
v2.18.8 Fix + RCA: root-caused why memory extraction had been degraded for ~2 months
        despite no deploy being responsible. `_extract_and_save_facts`/`_generate_title`
        were hardcoded to Claude until commit 5ca261f (2026-06-04, "respect configured
        provider") made them dynamically pick provider/model from Settings — introducing
        the latent `resp.content[0].text.strip()` bug fixed in v2.18.6/v2.18.7, dormant
        until Tier 1's provider/model was ever pointed at a Z.ai "hybrid reasoning" GLM
        model. That pointing happens via `PATCH /api/settings/model-routing`, which writes
        straight to `.env` (`dotenv_set_key`) with no git commit and no CI/CD — a pure
        runtime settings change, invisible in deploy history, which is exactly why no
        deployment could explain the timing. Weekly conversation-memory counts corroborate
        the window: ~44-143/week through late June, cratering to 10 (Jul 6), then 0 for
        three weeks, then a 1-3/week trickle through August (occasional short thinking
        traces fitting under the old token caps by chance) until the v2.18.6/2.18.7 fixes.
        Given that mechanism, max_tokens across all four affected call sites is now bumped
        well past any realistic output length as defense-in-depth beyond the
        thinking-disabled fix alone (classifier 20->200, titles 30->200, fact-extraction
        300->800, compaction 600->1200) — so a future model/endpoint change quietly
        reintroducing a reasoning preamble degrades gracefully instead of silently
        breaking again. A one-time backfill re-ran extraction over the affected window's
        historical user messages to recover facts that were never saved; mnemon.write's
        existing cosine-similarity dedup (threshold 0.12) prevented duplicate memories
        for anything that had already gotten through. Harness-only, no schema change.
v2.18.7 Fix + Change: a third instance of the v2.18.6 thinking-block bug found in
        _extract_and_save_facts (memory extraction) — fixed the same way (_first_text_block +
        _zai_kwargs). Also: conversation titles now regenerate on the first assistant turn,
        then every 5 turns after, instead of every single turn. Firing every turn meant a
        fast back-and-forth conversation could have several title-gen calls in flight
        concurrently with no ordering guarantee — a stale call finishing after a fresher one
        could silently overwrite it, which is the likely explanation for a title observed
        stuck on stale text even after the v2.18.6 fix was confirmed live and working
        correctly in isolation. Throttling also cuts Z.ai request volume (title-gen was
        firing alongside the main reply and fact-extraction calls on every turn, contributing
        to the rate-limit errors seen during the v2.18.5/2.18.6 investigation). Harness-only,
        no schema change.
v2.18.6 Fix: the tier/category classifier, conversation title generation, and rolling
        compaction were all silently broken on any Z.ai (GLM 4.x) tier1 model — the root
        cause behind chat titles stuck on "New Conversation" and (very likely) the erratic
        multi-model bouncing seen in the v2.18.5 investigation. Z.ai's Anthropic-compatible
        endpoint puts a mandatory "thinking" block at content[0] with text=None before any
        real output on these "hybrid reasoning" models; all three call sites did the naive
        `resp.content[0].text.strip()` with a tight max_tokens (8 for the classifier, 15 for
        titles) that the thinking trace alone exceeded, so nearly every call threw
        AttributeError, was swallowed by a bare except, and fell back silently: the
        classifier fell back to the crude length/regex _heuristic (core/router.py) for
        every message that wasn't an obvious fast-path match, titles stayed unset, and
        compaction silently never ran. Confirmed live against production: reproducing the
        classifier call with the real config returned a thinking-only block and would have
        raised on every call; the same call with `extra_body={"thinking":{"type":
        "disabled"}}` (the typed `thinking=` kwarg isn't in the installed anthropic==0.43.0
        SDK) and a fixed content-block scan returned a correct classification immediately.
        Fix: new _first_text_block/_zai_kwargs helpers (chat.py) and an equivalent inline
        fix in router.py — scan all content blocks for the first non-None text instead of
        blindly indexing [0], disable thinking for zai calls via extra_body, and raise a
        real fallback-triggering error when no text block is found (max_tokens bumped
        8->20 for the classifier, 15->30 for titles). The heuristic classifier's
        length/regex rules explain the earlier bounce between models mid-conversation —
        short reactive replies ("What", "Huh") hit its short-message path to Tier 1 while
        real follow-up questions defaulted to Tier 2 with no actual judgement behind either
        choice. Harness-only, no schema change.
v2.18.5 Fix: read_email silently reported "no email found" for HTML-only messages — the
        common case for bank/bills-payment/notification emails. _extract_body (connectors/
        gmail.py) only ever recognized text/plain MIME parts; a multipart/mixed message whose
        only content part is text/html (no plain-text alternative) returned "" from every
        recursive branch, so extract_thread_text produced an empty string, read_email's
        search path treats empty bodies as no-match (`if text: all_results.append(...)`), and
        the model correctly reported zero results even though Gmail's own search found the
        thread. Root-caused by reproducing the exact failure against production: live search
        for "metrobank online" against the connected personal Gmail found 5 real threads, but
        extract_thread_text on the top match returned length-0 — confirmed the message's only
        body part was text/html. Fix: new _walk_body_parts recursively collects the first
        text/plain AND first text/html found anywhere in the MIME tree (order-independent,
        so a text/html-first multipart/alternative still prefers plain when present); new
        _html_to_text (lxml, already a dependency via trafilatura) strips script/style and
        converts to readable text as the fallback when no plain part exists. Symptom
        surfaced as multi-turn hallucination-looking behavior (TARS increasingly confidently
        claiming "no Metrobank emails anywhere, must be a third account") — this bug alone is
        sufficient to produce that exact symptom for any phrasing tried, since the search path
        only inspects the top-ranked match per account (threads[:1]); if that top match is
        HTML-only, the empty extraction reports as "no email found" regardless of how many
        real matches exist below it. Harness-only, no schema change.
v2.18.4 Feat: multi-account calendar parity + cross-calendar conflict detection + manual
        email account override. Three pieces: (1) detect_calendar_conflicts (signal_generator.py)
        now merges work AND personal calendar events into one timeline before checking overlap
        — previously only checked "Google Calendar", so a work meeting double-booked against a
        personal appointment was invisible to Today/Signals; new _fetch_calendar_events helper
        fetches each account, cross-account conflicts skip client-name resolution (no client to
        resolve against) and label the personal side inline ("(personal)"). (2) EmailDraftCard
        gained a manual WORK/PERSONAL toggle in its header (was a read-only tag reflecting only
        the model's guess) — lets Mike override the account before sending when the model
        guesses wrong on a fresh compose (unambiguous on replies, since the source thread pins
        it). (3) Calendar writes now support the personal account: create_calendar_event /
        update_calendar_event / delete_calendar_event tools and the manual Add Event modal all
        gained an account field (work|personal, default work), gcal_personal capability bumped
        read -> read+write, and the /api/calendar/events REST routes (POST/PATCH/DELETE) accept
        the same field for consistency with the chip-proposal path. Model is prompted to infer
        account from which CALENDAR context section (WORK/PERSONAL) an event_id came from, same
        pattern as v2.18.3's email account inference. Harness + web, no schema change.
v2.18.3 Feat: personal Gmail can now send/reply, not just read. gmail_personal capability
        list updated read -> read+write. send_email/confirm_send_email tools (and the manual
        Send button's POST /api/email/confirm-send) gained an account field ("work"|"personal",
        default "work") that resolves which Connector row (Gmail vs Gmail (Personal)) the
        GmailClient sends through — previously both send paths were hardcoded to the work
        Gmail connector regardless of which inbox the draft came from. Model is prompted to
        default to "personal" when the draft is a reply to a thread shown under
        [PERSONAL GMAIL] context, or when Mike explicitly asks to send from his personal
        email. EmailDraftCard shows a small PERSONAL label when applicable. Note: personal
        Gmail OAuth is still blocked pending Google Cloud Console changes (see connectors
        page) — this ships the send capability so it's ready the moment that's connected.
        Harness + web, no schema change.
v2.18.2 Fix: Today, not Chat, is now the actual landing surface — code now matches what
        §8 already specified since v2.16.0 ("The landing surface"). Root `/` redirect
        (app/page.tsx) and post-login redirect (login/page.tsx) changed /chat -> /today;
        PWA manifest start_url changed to /today so a fresh install/launch lands there
        too. Note: an ALREADY-installed PWA icon has its start_url baked in at install
        time on most platforms and won't pick this up until removed and reinstalled —
        this only affects new installs and browser-tab entry automatically. Chat is
        still reachable normally (nav item, shortcut "2"), unchanged otherwise. Web-only,
        no schema change.
v2.18.1 Redesign: signal cards get a dedicated context chip, replacing the v2.17.2/v2.18.0
        string-munging. New Signal.context_label column (migration s6t7u8v9w0x1) — client
        name or (email only, no client match) a coarse category, rendered as its own chip
        in the header row instead of being prefixed onto the title / appended to
        source_label. Titles are clean imperatives again. detect_unconverted_action_items,
        detect_meeting_commitments, detect_calendar_conflicts, detect_actionable_emails all
        pass context_label=... instead of mutating title/source_label. EMAIL_EXTRACT_SYSTEM
        gained a category field (billing/legal/banking/vendor/recruiting/scheduling/internal)
        used only when the sender isn't a resolved client — GmailClient.get_awaiting_reply
        senders without a Contacts match (AWS billing, a bank notice, a job applicant) still
        get a scannable chip instead of nothing. Client resolution always takes priority over
        category; never both on one card. SignalCard.tsx: new neutral chip style
        (--c-surface-2 fill, --c-ink-muted text, --c-border-faint hairline — deliberately not
        moss, which stays reserved for interactive/accent elsewhere) plus a 12px source icon
        per detector (Mail/Video/Calendar/FolderKanban/Rss/Activity, tinted with the existing
        urgency accent — no new color introduced). FYI rows get the same context inline
        (no boxed chip — "no card weight" stays true for fyi). Design referenced via Refero
        MCP (Raycast/Linear-style dark changelog tag-chip patterns); Mobbin was requested but
        is not connected as an MCP for this session. Harness + web + DB migration.
v2.18.0 Feature: fifth signal detector — actionable email. detect_actionable_emails surfaces
        inbound Gmail threads still awaiting a reply, whether unread or read-but-never-
        answered. New GmailClient.get_awaiting_reply (connectors/gmail.py) determines "still
        waiting" deterministically off the SENT label on a thread's last message rather than
        an unread flag or From-address comparison — works across aliases, and catches mail
        Mike opened but never replied to, not just unread mail. Excludes Promotions/Social/
        Forums categories before spending a model call. For threads that pass, Tier 2 judges
        actionability with the same conservative, empty-is-valid contract as
        detect_meeting_commitments: newsletters/receipts/automated notices correctly resolve
        to "no action needed." Reuses v2.17.2's _client_for_attendees for client tagging (sender
        email -> Contacts org). dedupe_key = thread_id + latest message id, so dismissing a
        thread means "no action was needed" and it stays dismissed unless a new message
        arrives. Actions surfaced (draft_reply / create_task / create_reminder) were all
        already-supported signal action kinds — no frontend changes needed. Scoped to the
        primary Gmail account only for v1: read_email's thread-id resolution always tries the
        work account first, so personal-account threads would fail the draft_reply hand-off.
        Also: _EXTRACTION_ERRORS renamed _MODEL_ERRORS and its clear() moved from inside
        detect_meeting_commitments to once per sweep in generate_for_user, since two
        model-assisted detectors sharing one clear-on-entry list would wipe each other's
        errors; the empty-candidates early return in generate_for_user now also surfaces
        model_errors instead of silently dropping them. Harness-only, no schema change.
v2.17.2 Fix + Enhance: signal generator surfaced other people's action items, and cards
        lacked client context. detect_unconverted_action_items grouped every Fireflies action
        item with no task_id into the brief regardless of owner — Fireflies extraction has no
        notion of "mine". New _owner_is_someone_else filters out items whose extracted owner
        explicitly names someone other than the user; unassigned items stay in (ambiguous,
        not "someone else's"). New _client_for_attendees resolves a best-effort client name
        per meeting/event from the Contacts graph (attendee emails, external domains only, →
        Contact.organization, most common wins) — not a hardcoded client list, so it stays
        correct as clients change. Applied to detect_unconverted_action_items,
        detect_meeting_commitments, detect_calendar_conflicts: title prefixed "{Client}: ...",
        source_label becomes "Fireflies · {Client}" / "Calendar · {Client}" when one resolves.
        detect_stalled_tasks untouched (no attendee data to derive a client from). Harness-only,
        no schema change.
v2.17.1 Fix: calendar conflict detection crashed in production — detect_calendar_conflicts
        passed time_min/time_max as ISO strings but GoogleCalendarClient.list_events takes
        datetimes and calls .isoformat() itself ('str' object has no attribute 'isoformat').
        Passed locally only because no calendar was connected, so the detector returned before
        reaching the call. Harness-only, no schema change.
v2.17.0 Feature: signal generation — /today fills itself. jobs/signal_generator.py with four
        detectors split by fact vs judgement: deterministic (stalled/overdue tasks, unconverted
        Fireflies action items grouped BY MEETING, calendar conflicts) and model-assisted
        (Tier 2 JSON extraction of commitments from transcripts, with verbatim quotes).
        Scheduled as signal_sweep every 4h; POST /api/signals/generate runs one inline on
        demand. Grouping mattered: one real week produced 225 unconverted action items, which
        as individual cards is a wall rather than a triage surface — 225 became 18. Sweep
        results report created/already_seen/deferred_by_cap separately and surface model_errors,
        because a misconfigured tier otherwise looks identical to "nothing to report".
        Fix: core/model_client._resolve_pair hardcoded "glm-4.7" as the tier2 fallback
        regardless of provider, so an anthropic tier2 with no model override sent a Z.ai model
        name to the Anthropic API and 404'd EVERY tier2 request — silently breaking all of
        Tier 2 on any install using the default tier2_provider. Now provider-appropriate.
        Fix: user resolution used User.name; canonical row matches User.id (v2.15.10 pattern).
        Harness-only, no schema change.
v2.16.0 Feature: Today screen + Signals. New /today landing route (does NOT replace /chat)
        listing AI-inferred items needing a decision, replacing the prompt-cron daily digest
        that dumped prose into a chat conversation. New Signal model + table (migration
        r5s6t7u8v9w0) with dedupe_key so dismissed signals don't return on the next sweep.
        GET/act/snooze/dismiss/restore at /api/signals plus a real .ics endpoint. Action
        dispatch splits: create_reminder (default — signal work lands in To-Dos, not
        Projects) / create_task / create_event execute server-side; draft_reply / move_event /
        open_meeting / save_brain open a pre-seeded conversation so email keeps its existing
        draft-card gate. Undo deliberately does not roll back side effects already produced.
        Frontend: uncapped urgency-grouped cards, named primary action + overflow alternates,
        swipe-to-dismiss on touch AND trackpad, 5s undo with draining timer, three distinct
        blank states (earned/parked/quiet), state-driven ambient field on /today only.
        Also fixed: next.config allowedDevOrigins — Next 16 blocked dev resources on
        127.0.0.1, leaving the whole app unhydrated and non-interactive. Signal generation
        from real sources is NOT built yet; /today is empty until it lands.
v2.15.12 Fix + Enhance: typeset pass — WCAG contrast, code block chrome, prose sizing, label
        consistency. `--c-ink-faint` in light mode #948a7b → #7a7062 (WCAG AA 4.5:1, was 3.0:1;
        all .tars-label text in light mode was too faint). Code/SVG block headers: hardcoded
        #1e1e1e/#888 → CSS tokens (surface-raised/border/ink-faint/moss) — adapts in light + dark.
        Chat prose promoted from 14px on desktop to 16px at all sizes (p/h3/ul/ol/blockquote).
        ThinkingBlock "REASONING" label + toggle → .tars-label (was 10px ad-hoc inline). Token
        count display → .tars-label.tars-label--muted. ModelBadge 10px → 11px (.tars-label std).
        ProseMirror h1/h2 fallback: serif → sans-serif (Lora removed v2.7.0). Web-only, no schema.
v2.15.10 Fix: contact enqueue crash + removed the phantom second user (v2.15.9 root cause).
        (1) pending_contacts.enqueue_pending used scalar_one_or_none() on the "already a known
        contact?" lookup by primary_email; multiple distinct Google contacts can share one email
        (40 test cards on rein@growth-rocket.com), so it raised MultipleResultsFound and aborted
        the enqueue. Switched both Contact + PendingContact existence checks to .scalars().first().
        Contacts were NOT row-duplicated (all 3070 have distinct google_resource_name; the 58
        shared-email groups are real distinct Google cards). (2) Deleted the phantom
        mike.villar@gmail.com User row: reassigned useful data to mike (1 pending contact, 5 meeting
        memories, 1 conversation), deleted redundant (21 pending, 1 dup memory, 6 default domains),
        then the user. DB now has one user. (3) Hardened scheduler._sync_fireflies to resolve the
        user via settings.tars_username, not select(User).limit(1). Harness-only, no schema change.
v2.15.9 Fix: Fireflies meetings synced without summaries/action items. Two compounding bugs.
        (1) A phantom second User row (mike.villar@gmail.com next to canonical mike) defeated
        dedup: the sync loop and webhook both resolve user via select(User).limit(1) and could
        pick different rows, and the duplicate check was scoped to connector_ref+user_id, so the
        same transcript got ingested once per user (~24 dup meetings from a Jun-27 re-ingest).
        (2) A transient Z.ai 429 (rate_limit_error 1302) in _ai_process threw → process_meeting's
        handler set status=error with NO summary, discarding the good Fireflies overview+action
        items already fetched; the UI (logged in as mike) showed his empty error copies while the
        good copies sat under the unseen second user. Fix (jobs/meeting_processor.py): _ai_process
        catches AI failures and falls back to Fireflies overview + parsed action items; post-commit
        RAG/contacts steps guarded so they can't flip a saved meeting back to error; dedup keys on
        connector_ref ALONE (.first()). One-time prod cleanup: 94→70 meetings (kept the copy with
        summary+actions, deleted 24 empty error/processing twins, reassigned 5 to mike, reprocessed
        the rest). Harness-only, no schema change.
v2.15.8 Fix: PWA install button still missing on desktop — beforeinstallprompt captured too late.
        v2.15.7 restored the SW (Chrome's precondition) but the button still didn't show. Cause:
        the beforeinstallprompt listener lived only in the Settings page useEffect, but Chrome
        fires that event ONCE, early, right after load, on whatever page the user landed on (usually
        /chat) — so it fired before Settings ever mounted and never fired again. Fix: a blocking
        <head> script in app/layout.tsx (runs before hydration) preventDefaults + stashes the event
        on window.__tarsInstallPrompt and dispatches a tars-installable event (+ tars-installed on
        appinstalled). Settings now adopts the stashed prompt on mount and listens for the custom
        events, so the Install button appears no matter which page the event fired on. Verified
        locally. Web-only, no schema change.
v2.15.7 Fix: PWA installable again on desktop. The v2.15.3 SW kill switch fixed the stale-bundle
        saga but also removed the registered service worker WITH A FETCH HANDLER that desktop
        Chrome/Edge require to fire beforeinstallprompt — so the Settings Install button never
        appeared (iOS unaffected; Add to Home Screen needs no SW). New public/sw.js is minimal:
        has a fetch handler (installable) but NEVER caches app code (JS/CSS/API pass through to
        network → deploys never masked, no stale-bundle regression); purges old caches on activate;
        only caches a tiny public/offline.html for offline navigations (network-first).
        ServiceWorkerRegister now registers /sw.js instead of unregistering everything (chunk-error
        self-heal unchanged). Settings fallback copy updated. Verified locally: SW activated +
        controlling, fetch handler present, offline.html 200, no errors. Web-only, no schema change.
v2.15.6 Fix: Google Doc export is rich text, not raw markdown. gdoc path called create_doc
        (Docs API insertText) so markdown rendered literally (## , **). Now builds the same
        DOCX as the download and uploads to Drive with conversion to a native Google Doc
        (mimeType application/vnd.google-apps.document) via new create_doc_from_docx
        (MediaIoBaseUpload; workspace connector has full auth/drive scope). DOCX builder shared
        across docx+gdoc; inline bold/italic/code now also parsed inside list items (add_inline
        helper). Verified: no literal ##/** in the resulting Doc. Harness-only, no schema change.
v2.15.5 Fix: Second Brain export REAL root cause — found by headless-browser reproduction.
        Two bugs in ItemDetailModal export dropdown: (1) DropdownMenuLabel = base-ui
        Menu.GroupLabel throws Base UI error #31 (MenuGroupContext missing) when not inside
        a Menu.Group → opening the dropdown crashed the React tree into Next's global-error
        ("This page couldn't load"), no request sent; fixed by wrapping in DropdownMenuGroup.
        (2) Items used onSelect, but base-ui Menu.Item activates via onClick (onSelect is the
        text-selection event, never fires on click) → handler never ran; switched to onClick.
        Verified end-to-end (request fires + .docx downloads). v2.15.0–4 were robustness
        improvements, not the cause. Web-only, no schema change.
v2.15.4 Fix: ChunkLoadError after deploy — real robustness fix, NOT the export root cause
        (see v2.15.5). Cached app shells referenced lazy chunk filenames that each rebuild
        deleted from .next/static; using the export modal dynamic-imported a now-404 chunk
        → ChunkLoadError → "This page couldn't load", with NO export request reaching the
        server (so every prior server-side fix was invisible). deploy.sh now archives the
        prior build's static assets and folds them back into each build (.next-static-archive,
        14-day retention) so stale shells stop 404ing; ServiceWorkerRegister self-heals via a
        one-shot guarded reload on ChunkLoadError. Shells cached before this deploy must clear
        site data once. Web/deploy-only, no schema change.
v2.15.3 Fix: service-worker kill switch — stale-code root cause. A prior caching SW
        (apps/web/public/sw.js) left browsers/PWAs serving old JS bundles, so deploys
        were invisible to the client and the v2.15.0–2 export fixes never reached the
        browser ("This page couldn't load", no request hitting the server). sw.js is now
        a kill switch (purge caches + registration.unregister() + force-reload all
        clients); ServiceWorkerRegister unregisters existing workers + clears caches
        instead of registering (no re-register loop). Web-only, no schema change.
v2.15.2 Fix: Next.js proxy ECONNREFUSED — the real Second Brain export bug. Proxy +
        login routes fetched harness at http://localhost:8000; Node 18+ resolves localhost
        to ::1 (IPv6) + 127.0.0.1, harness binds IPv4-only 0.0.0.0:8000 → IPv6 refused →
        AggregateError/ECONNREFUSED; standalone build can't render /500.html → blank "This
        page couldn't load". Both routes now force IPv4 via .replace("//localhost",
        "//127.0.0.1"). Export handler also rewritten to blob-download (no navigation) and
        surface real errors. Web-only, no schema change.
v2.15.1 Fix: Second Brain export download in Safari/PWA — window.location.href was
        navigating the PWA app shell causing "This page couldn't load"; changed to
        hidden <a download> click (synchronous, no navigation, same-origin cookie auth
        passes automatically). Web-only, no schema change.
v2.15.0 Fix: email sent-state persistence + Second Brain export. (1) mark-sent SQL cast fix:
        tool_results column is JSON not JSONB; jsonb_array_elements was silently failing
        (error swallowed by .catch), leaving every email card in unsent state on reload.
        Added ::jsonb casts throughout the UPDATE query. (2) Sent card now shows full email
        receipt (To/CC/Subject/expandable Body) instead of a dismissible pill so you can
        review what was sent. (3) Second Brain items can be exported as DOCX, PDF, or Google
        Doc from the item detail modal (Download button → dropdown); POST /api/second-brain/
        items/{id}/export?format=docx|pdf|gdoc; markdown faithfully converted to native
        heading/list/inline structure. Harness + web, no DB migration.
v2.14.1 Fix: email draft revision, inline editing, sent-state persistence. send_email tool
        now instructs model to re-call the tool for any revision (fixes missing card on revision
        and hallucination on second turn). Server generates draft_id UUID and echoes To/Subject
        in tool result. EmailDraftCard has pencil-toggle edit mode for all fields (To/CC/Subject/
        Body inline inputs). POST /api/email/mark-sent persists sent:true in DB tool_results;
        on reload card reads sent flag and shows sent state instead of reverting. Harness + web,
        no DB migration.
v2.14.0 Feat: Feed Reader — three-panel RSS/YouTube/Reddit/podcast reader at /feed. Subscribe to any URL (RSS, website auto-discovery, YouTube channel XML, Reddit .rss, Google News). Four media types: article (prose), video (YouTube embed), podcast (HTML5 audio), link. "Save to Brain" one-click → KnowledgeItem. "Chat with TARS" creates pre-seeded Conversation with article content. Feedly search API for feed discovery (GET /api/feed/discover; FEEDLY_API_KEY). Preset packs for zero-config onboarding. New DB tables: feed_sources + feed_items (rolling 90-day cleanup). Migration: p3q4r5s6t7u8. Hourly feed_sync scheduler job. feedparser==6.0.11 added. Harness + web.
v2.13.4 Feat: rolling context compaction. Conversations over 20 messages trigger a Tier 1
        model summary of the oldest messages (all but last 10). Summary stored in
        context_snapshot.rolling_summary, cutoff timestamp in summary_cutoff_at. On load:
        only post-cutoff messages fetched (limit 30), summary injected as synthetic
        exchange at top. Context window stays flat indefinitely. Zero streaming latency
        added. Migration o2p3q4r5s6t7. Harness-only.
v2.13.3 Perf: slash system prompt 60% + token analytics. Tier 2 prompt cut from 18k → ~5k
        tokens (SYSTEM_STATE.md restricted to Tier 3 only; capabilities block rewritten concisely).
        Real token tracking: input_tokens column on messages (migration n1o2p3q4r5s6); model_client
        emits input/output split in done events; chat.py + prompt_cron.py save real values.
        get_token_report agent tool for usage analysis. GET /api/analytics/tokens endpoint
        (hourly, by-model, cron costs, flags, recommendations). Settings → Token Usage section.
        Meeting summarization moved Tier 3 → Tier 2. Harness + web + DB migration.
v2.13.2 Rename: Tasks → Projects, Reminders → To-Dos. Nav labels, page headers, command
        palette, and agent tool descriptions updated. Bell icon → ClipboardList. Web +
        harness, no schema change.
v2.13.1 Fix: verbal approval for email — confirm_send_email tool. send_email still shows
        draft card; if Mike verbally approves ('go ahead', 'send it', 'yes'), model calls
        confirm_send_email with same fields to execute immediately. Enables Clawsses
        verbal email-send flow. Harness-only, no schema change.
v2.13.0 Feat: To-Dos (was Reminders) — quick personal checklist. New Reminder model (text, done, due_at),
        CRUD at /api/reminders, two agent tools (create_reminder / list_reminders with
        create_task/create_reminder distinction in context assembler), /reminders page
        with grouped sections (Overdue/Today/Tomorrow/Upcoming/Someday/Done), inline
        quick-add (Enter), double-click edit, optimistic check-off, ClipboardList nav icon.
        Harness + web. Migration: m0n1o2p3q4r5.
v2.12.2 Fix: verbal approval path — dual-tool model for write actions. create_task +
        create_calendar_event + update_calendar_event + delete_calendar_event restored as
        direct-execution tools with descriptions gating on explicit ask OR verbal approval
        ('go ahead', 'yes', 'do it'). propose_task / propose_calendar_event kept for
        proactive/unsolicited suggestions only (still chip-gated). Enables Clawsses (glasses
        HUD) verbal confirmation flow. Harness-only, no schema change.
v2.12.1 Fix: approval gates for all write actions — tasks, calendar, email. create_task +
        create_calendar_event removed from autonomous path; all write actions now flow
        through proposal chips requiring explicit confirmation. update/delete calendar
        events emit new chips (CalendarUpdateChip / CalendarDeleteChip) backed by new
        PATCH + DELETE /api/calendar/events/{id} endpoints. send_email unchanged (already
        gated). Tool descriptions updated across Anthropic + GLM streaming paths.
v2.12.0 Feat: 8 chat stream enrichment features — live tool progress indicator (animated
        spinner, ephemeral SSE-only), follow-up suggestion chips (3 Haiku-generated per
        response, persist in follow_ups[]), context source citations (Mnemon + Second Brain
        disclosure toggle, persist in context_sources[]), email thread card (from read_email),
        YouTube embed player + GitHub repo card (URL type dispatch in UrlPreviewCard), Strava
        activity card (from get_strava_* tools), meeting card (from read_meeting). All 5 card
        types persist in tool_results and replay via InlineMessageCards. done event now carries
        follow_ups[] and context_sources[]. Web + harness, no DB migration.
v2.11.2 Fix: contact @-mentions show email to disambiguate duplicates. search_mentions
        (links.py) leads contact subtitle with primary_email then org/title
        ("j.shorrock@aalaw.com · AA Law"). Shared dropdown → applies to all mention surfaces.
        Harness-only. Verified in-browser with two same-named test contacts.
v2.11.1 Feature: chat mentions render Slack-style bold. MessageContent.preprocessContent
        rewrites [[id|type|label]] → **@label** before ReactMarkdown. Harness reverted to storing
        the WIRE form of user messages (db_content = content) so reload can bold them; model still
        gets stripped text via full_text. Optimistic bubble uses wire content too. Web + harness.
v2.11.0 Feature: universal @-mentions across the app + Second Brain persistence fix.
        (1) SB bug root cause: @tiptap/extension-mention default parseHTML matches
        span[data-type="mention"] but our chips put the entity type in data-type and mark
        themselves data-mention → on reload the chip wasn't recognized, degraded to text, next
        save dropped the id. Fixed: parseHTML()→[{tag:'span[data-mention]'}] + explicit
        data-id/data-label parsers (MentionExtension.ts). SB trigger switched [[→@.
        (2) Reusable layer: lib/mentions.ts (stripToLabels/parseWireToDisplay/toWire/
        currentMentions/syncMentionLinks) + components/ui/MentionTextarea.tsx (drop-in textarea:
        friendly @Label display, lossless [[id|type|label]] storage, fixed-position dropdown,
        emits mentions for link sync). Wired into Tasks (description→task links), Mnemon (memory
        content, stores stripped text + memory links), Calendar (new Description field, clean text
        to Google). Meetings left read-only by request. (3) Harness: 'memory' added to
        links.VALID_TYPES + Memory title resolver. Verified in-browser. No DB migration.
v2.10.9 Fix: chat mentions display as friendly `@Label`, not raw [[id|type|label]]. A plain
        <textarea> can't render chips, so selectMention inserts `@Label` + a mentionMapRef
        (label→{id,type}); at send, handleSend expands @Label → [[id|type|label]] (longest-first
        split/join) for the harness while the bubble shows the plain label. Harness stores
        stripped_content (labels only) so reloads are clean. chat/page.tsx + message-input.tsx +
        chat.py. Verified in-browser against local harness.
v2.10.8 Change: mention trigger is now `@` instead of `[[`. Detection regex /(^|\s)@([^\s@]*)$/
        (start-of-input or after whitespace — avoids email false-triggers) in all three composers
        (chat/page.tsx, message-input.tsx, useMentionAutocomplete). Stored wire format unchanged —
        still inserts [[id|type|label]] which the harness parses as before. Web-only.
v2.10.7 Fix: [[ mention dropdown now appears in the MAIN chat composer. The trigger had been
        wired into components/chat/message-input.tsx, but that's only used by /chat/[id]; the
        primary /chat landing page uses its own inline composer inside the 111KB
        app/(app)/chat/page.tsx. Inlined detectMention() in the textarea onChange + fixed-position
        MentionDropdown (escapes the thread's overflow-x-hidden). Verified in-browser. Web-only.
v2.10.6 Feat: Drive search in Google Workspace connector. GoogleWorkspaceClient.search_files
        queries Drive by name + fullText (optional type filter), newest-first. New search_drive
        chat tool lets TARS find files by description instead of a pasted link; results feed
        read_google_doc. Harness-only, no schema change.
v2.10.5 Fix: [[ in chat now triggers mention dropdown. API min_length=1 caused 422
        on empty q; changed to default="" and returns recent contacts/knowledge/tasks
        when q is empty. Hook dropped the query.length<1 early-return. Harness + web.
v2.10.3 Fix: mention chips survive save in Second Brain. tiptap-markdown's addStorage
        discovery is unreliable through extend().configure() chains — with html:false it
        falls back to writing `[mention]` for unknown nodes. onUpdate now walks the doc
        for mention nodes in order, then replaces any `[mention]` fallback tokens with
        the correct [[id|type|label]] format. No-op if addStorage serialize is already
        working. Web-only, no schema change.
v2.10.1 Feat: universal [[mention]] autocomplete in chat composer. useMentionAutocomplete
        hook detects [[ trigger, fetches /api/proxy/links/search, handles keyboard nav,
        inserts [[id|type|label]] chip. MentionDropdown component (grouped by type).
        Harness _resolve_mentions strips markers and injects entity context (contact
        info, knowledge content, task details) into doc_snippets before the model sees
        the message. User messages display mention markers as `[[label]]` code-styled
        text. Web + harness, no schema change.
v2.10.0 Feature: Google Workspace connector — read & write Google Docs/Sheets/Slides by
        link. New `google_workspace` OAuth connector (drive/documents/spreadsheets/
        presentations scopes) reusing the generic Google OAuth flow. connectors/
        google_drive.py exports native Google files to Office formats (Doc→docx,
        Sheet→xlsx, Slides→pptx) so existing ingest parsers handle them with no new
        parser code; also live read + write (append doc, update/append sheet rows,
        create doc). second_brain.ingest_url routes Google links through the connector
        instead of trafilatura. New chat tools: read_google_doc, update_google_doc,
        update_google_sheet, create_google_doc. New env: GOOGLE_WORKSPACE_CLIENT_ID/
        SECRET. No DB migration.
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
| 6 | Agent Jobs + Artifacts | Claude Code subprocess executor, supervised approval flow, Agent Jobs UI, Artifacts view + auto-save hook | ✅ Done — Agent Jobs later **retired** (2026-09); Artifacts still live |
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
- **Ambient light (since v2.15.11)** — a whisper-quiet atmospheric wash gives the interface
  depth without decoration. Three token-driven primitives in `globals.css` (`@layer
  components`), all built from `--c-*` tokens via `color-mix` so light/dark inherit
  automatically: `.tars-ambient` (app-wide canvas wash — moss glow top-left ~34% + amber
  bottom-right ~27%, applied to the `(app)/layout.tsx` content wrapper); `.tars-ambient-chat`
  (chat surface — `--c-surface` dominant + moss radial at top ~20%); `.tars-boot-glow`
  (centred moss radial ~45% behind the chat STANDBY wordmark — a cinematic "powering on" halo).
  These are at full strength ("go to the max"): bold and atmospheric in dark, clearly present
  in light, text contrast still intact. Earlier passes (whisper 7/5%, mid 13/10%) were too
  faint. If tuning further, all four alphas live in `globals.css` `@layer components`.
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

---

## 17. Design Context

Design system files live in `apps/web/`. Read these before any UI work:

- **[`apps/web/PRODUCT.md`](apps/web/PRODUCT.md)** — register (product), platform (web), users, purpose, positioning, brand personality, anti-references, design principles, accessibility (WCAG 2.1 AA)
- **[`apps/web/DESIGN.md`](apps/web/DESIGN.md)** — full visual spec: color tokens (warm parchment/moss/amber palette), typography (Inter prose + JetBrains Mono instrument layer), components, layout, motion

**Key principles agents must know:**
- "Instrument" design language (v2.7.0+): JetBrains Mono is the machine voice; Inter is human prose. Never swap them.
- Moss (`--c-moss`) is the sole accent. Amber/rose are status-only. No decorative color.
- Depth by surface stack (canvas → surface → surface-2), never by shadow or glassmorphism.
- Anti-reference: must NOT look like generic AI chat (ChatGPT/Claude.ai) or mainstream SaaS.
- Ambient light: `.tars-ambient`, `.tars-ambient-chat`, `.tars-boot-glow` — atmospheric washes at full strength.
