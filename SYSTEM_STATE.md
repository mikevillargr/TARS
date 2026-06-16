# TARS System State
> Single source of truth for TARS's own architecture, infrastructure, and version history.
> Updated by Claude Code on every version tag and infrastructure change.
> Injected into TARS's context assembler so it can answer questions about itself.

---

## Current Version

| Field | Value |
|---|---|
| Version | v2.8.0 |
| Released | 2026-06-16 |
| Branch | main |
| Repo | https://github.com/mikevillargr/TARS |

---

## Live Infrastructure

| Component | Details |
|---|---|
| App server | Hostinger KVM4 — 4 vCPU, 16GB RAM, 200GB NVMe |
| IP | 72.60.234.180 |
| Domain | tarsmv.duckdns.org |
| SSH alias | `ssh tars` (configured in ~/.ssh/config on dev machine) |
| Tier 2 inference | Z.ai API — GLM models via OpenAI-compatible endpoint |
| CI/CD | GitHub Actions — triggers on version tags |

### Running Services (PM2)

| Service | Process | Port |
|---|---|---|
| Next.js frontend | tars-web | 3000 |
| FastAPI harness | tars-harness | 8000 |
| Postgres + pgvector | Docker | 5432 |
| Redis | Docker | 6379 |
| Nginx (reverse proxy + SSL) | system | 80/443 |

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 PWA, shadcn/ui |
| Backend | FastAPI (Python) |
| Database | Postgres + pgvector |
| Queue | Redis + BullMQ |
| Memory | Mnemon (episodic RAG) + pgvector |
| Knowledge | Second Brain (semantic RAG) + pgvector |
| Tier 1 + 3 inference | Anthropic API (Haiku + Sonnet) |
| Tier 2 inference | Z.ai API — GLM models (configurable via Settings UI) |
| Agentic executor | Claude Code via subprocess |
| Monorepo | Turborepo |
| Containerization | Docker Compose |

---

## Model Routing

| Tier | Model | Use Case | Latency |
|---|---|---|---|
| Tier 1 | Claude Haiku | Simple/fast queries, classifier | ~500ms |
| Tier 2 | Z.ai GLM-4.7 (default) | Most tasks — email, summaries, day-to-day | 1–3s |
| Tier 3 | Claude Sonnet | All tool calls, client work, long context, complex reasoning | 3–8s |

Provider and model are configurable per-tier via the Settings UI (Anthropic or Z.ai).

### Backup models (per-tier fallback)
Each tier can have an optional **backup model** (Settings → Model Routing). If the primary
errors or times out **before any content streams**, TARS falls back to the backup, emits a
`model_fallback` event, and marks that tier degraded. While degraded it routes to the backup
and re-probes the primary (cheap 1-token ping) at the start of each turn — reverting the moment
the primary responds. Fallback never fires mid-stream (after tools may have side-effected).
Circuit-breaker state is in-memory on the harness singleton.

### Task-category forced routing
Six task categories — `quick_lookup`, `writing`, `coding`, `data_viz`, `analysis`, `general` —
detected per request (regex fast-paths + the existing tier-1 classifier, which now emits a
category token alongside the tier). Any category can be pinned to a specific provider+model in
Settings → Task-Category Routing, **overriding the tier's model** while the classified tier still
governs tool access and context budget. Unset categories use normal tier routing. Stored as
`category_routing_json` in `.env` (live-reloaded via `ModelClient.reset()`). Image/vision
requests are excluded — vision routing owns model choice.

---

## Active Components (11)

| # | Component | Route | Status |
|---|---|---|---|
| 1 | Chat | /chat | Live |
| 2 | Tasks | /tasks | Live |
| 3 | Meetings | /meetings | Live |
| 4 | Calendar | /calendar | Live |
| 5 | Second Brain | /second-brain | Live — items can be **starred** (pinned); starred items sort first and get a relevance boost in retrieval |
| 6 | Agent Jobs | /agent-jobs | Live |
| 7 | Artifacts | /artifacts | Live |
| 8 | Cron Manager | /cron | Live |
| 9 | Connectors | /connectors | Live |
| 10 | Mnemon | /memory | Live |
| 11 | Settings | /settings | Live |

---

## Active Connectors

| Connector | Capabilities | Status |
|---|---|---|
| Gmail | read, webhook | Live |
| Google Calendar | read, write | Live |
| Fireflies | read, webhook (meeting.ended) | Live |
| Strava | read | Live |
| Tesla (Tessie) | read, write (full vehicle control) | Live |
| Google Contacts | read, write, weekly sync | Live |
| OpenStreetMap (Places) | read (no API key) | Live |

---

## Rokid Glasses Integration

Streams TARS responses token-by-token to Rokid AR Lite glasses (480×640 green micro-LED).

```
TARS Harness ── ws /api/rokid/ws?token=<jwt> ── Android Phone ── BT (CXR-M) ── Rokid AR Lite
```

| Component | Status |
|---|---|
| Harness WebSocket endpoint (`/api/rokid/ws`) | Live |
| Android phone-app (TarsClient, bridge service) | Live |
| Android glasses HUD (Jetpack Compose) | Live |
| Rokid developer account + app creation | Pending |
| Physical hardware testing | Pending |

Phone↔Glasses protocol: `connection_update`, `session_list`, `chat_message`, `chat_stream`, `chat_stream_end`, `wake_signal` (phone→glasses); `user_input`, `list_sessions`, `switch_session`, `create_session`, `start_voice` (glasses→phone).

---

## Key File Locations (on server)

| Path | Contents |
|---|---|
| `/opt/tars/` | Repo root |
| `/opt/tars/apps/web/` | Next.js app |
| `/opt/tars/apps/harness/` | FastAPI harness |
| `/opt/tars/apps/harness/.venv/` | Python virtualenv |
| `/opt/tars/infrastructure/` | Docker Compose, Nginx config |

---

## Version History

### v2.8.0 — 2026-06-16
**Feature: per-tier backup models + task-category forced routing**
- **Backup models.** Every tier (tier1/2/3/vision) gets an optional backup provider+model in
  Settings → Model Routing. On a pre-content primary failure (timeout/error), TARS streams a
  `model_fallback` event and re-runs the turn on the backup. A per-tier circuit breaker keeps
  the backup in use and probes the primary (1-token ping) each turn, reverting the moment it
  recovers. New `.env` fields `{tier}_backup_provider` / `{tier}_backup_model_override`.
- **Task-category forced routing.** Requests are classified into one of six categories
  (`quick_lookup`, `writing`, `coding`, `data_viz`, `analysis`, `general`) via regex + the
  tier-1 classifier (now two-token: tier + category). Settings → Task-Category Routing maps any
  category to a forced provider+model that overrides the tier's model (tier still governs tools).
  Stored as `category_routing_json` in `.env`.
- Harness: `router.classify_full`, `ModelClient._stream_with_fallback` / `_stream_pair` /
  `_probe` / circuit-breaker state, `stream(forced_provider, forced_model)`; new
  `GET/PATCH /api/settings/model-routing/categories` and backup fields on `/model-routing`.
- Web: backup-model row per tier + new Task-Category Routing section in Settings.
- No DB migration — all config lives in `.env`.

### v2.7.3 — 2026-06-15
**Fix: blank charts — strip the model's own savefig/close calls**

Follow-up to v2.7.2. Charts started rendering but came out BLANK. Root cause: both chart
render paths (the `generate_chart` tool wrapper and the matplotlib code-block fallback)
append their own `plt.savefig(output_path)` after the model's code. But the model's code
typically ends with `plt.savefig(...)` (often to a bogus path like `/mnt/data/...`) followed
by `plt.close('all')`. So the harness's appended savefig fired *after* the figure was already
closed → it wrote a blank canvas over the real chart (and the bogus path also errored the
fallback outright).

- New `_strip_chart_io()` helper removes any `plt.show()` / `*.savefig(...)` / `plt.close(...)`
  lines from the model's code before wrapping. The harness's single savefig now runs while the
  figure is still open. Applied to both the tool wrapper and the code-block fallback.
  (`apps/harness/api/routes/chat.py`)
- `generate_chart` tool description + CHARTS prompt updated to instruct BUILD-only code (no
  savefig/show/close — the server saves and renders). (`apps/harness/core/model_client.py`)

Harness-only, no schema change.

---

### v2.7.2 — 2026-06-15
**Fix: charts now actually render on GLM (Z.ai) tiers**

Follow-up to v2.7.1. After the docx bug was fixed, GLM stopped making a Word doc but still
produced no chart — it narrated "Here's a line chart…" and emitted nothing (or fabricated a
broken `/api/render-chart` image URL). Root cause: the `generate_chart` tool was withheld
from GLM on the false assumption that "GLM writes Python code blocks naturally." It doesn't —
GLM narrates instead of emitting a ```python block, but it *does* call tools reliably.

- `generate_chart` is now given to **all** tiers/providers (removed the Anthropic-only gate).
  The tool runs matplotlib server-side in an isolated subprocess and emits a `chart_image`
  card, so it works for any model that can make a tool call. (`apps/harness/api/routes/chat.py`)
- CHARTS prompt rewritten to instruct ALWAYS calling generate_chart with the code in the
  `code` field; explicitly bans narrating a chart, pasting a bare code block and claiming it
  rendered, or fabricating `![Chart](...)` / `/api/render-chart` links.
  (`apps/harness/core/context_assembler.py`)

The matplotlib code-block fallback remains as a secondary safety net. Harness-only, no schema change.

---

### v2.7.1 — 2026-06-15
**Fix: chart requests no longer produce a Word doc**

Asking TARS to "generate a graph/chart" on a GLM (Z.ai) tier produced a `.docx` with a
broken inline image instead of an actual rendered chart. Two root causes, both fixed:

- **Prompt collision** — the word "generate" triggered the assertive "ALWAYS call
  generate_document" rule, which overrode the chart-as-Python-code path on weaker models.
  The document rule now explicitly excludes charts/graphs/plots, and the CHARTS rule states
  it always wins over the document tools and bans fabricated `![Chart](...)` image links.
  (`apps/harness/core/context_assembler.py`)
- **Gating bug** — `generate_chart` (Anthropic tool format) was gated on `tier3_provider`
  rather than the provider actually serving the request. A Tier 2 GLM request could be
  handed a chart tool it can't use, while a Tier 3 Anthropic request could lose it. Gate is
  now keyed on the effective tier's provider (`_serving_is_anthropic`).
  (`apps/harness/api/routes/chat.py`)

Harness-only, no schema change.

---

### v2.7.0 — 2026-06-14
**Instrument design language (web app visual identity)**

A typography/presentation pass giving TARS a distinctive "mission-control instrument"
character while keeping the warm moss/amber/parchment palette. No backend or schema changes.

Features:
- **JetBrains Mono promoted to the system "chrome" voice** — every label, eyebrow, column header, status, count, timestamp, and metadata row now renders in monospace (was confined to code blocks). New `.tars-label` utility (mono, 11px, uppercase, 0.14em tracking) applied across all 11 views (53 label sites unified in one pass). Unifies the web app with the Rokid HUD's JetBrains Mono.
- **Heading discipline** — headings are now medium weight (600) with tight negative tracking (-0.02em) instead of default bold; `--font-heading` repointed to the sans stack.
- **Dropped Lora (serif)** — typeface lineup is now Inter (human prose) + JetBrains Mono (instrument layer) only.
- **Accent as signal** — moss is the single accent (active state, eyebrow prompt, focus, primary, live indicator); amber/rose demoted to status only. Badges restyled to bracketed/mono uppercase.
- **Signature readouts** — sidebar wordmark in mono with "PERSONAL AI OS" sublabel; topbar "Agent Active" instrument pill; chat empty state as "TARS — STANDBY" boot readout; bracketed-mono model chips (`[ SONNET ]`, corrected from stale Qwen labels to Haiku/GLM/Sonnet); login styled as the boot/authorization moment.
- **Depth by surface, not shadow** — `.card` soft shadow removed in favor of hairline borders.

Refero references: Warp (terminal-native, accent-as-eyebrow), Linear Changelog (medium-weight headlines, mono timestamps), Operate (ledger microtype labels).

---

### v2.6.1 — 2026-06-14
**Second Brain: star / favorite items**

Features:
- Star (favorite) any Second Brain item: hover-reveal amber star toggle on each card, plus a star toggle in the detail modal header (both optimistic, persisted via `PATCH /second-brain/items/{id}`)
- New **Starred** filter in the Second Brain sidebar (amber accent + live count)
- Starred items sort first in the item list (`ORDER BY starred DESC, saved_at DESC`)
- Retrieval boost: starred items get a `STAR_BOOST` (0.06) reduction in effective cosine distance during context assembly, so user-pinned knowledge clears the relevance threshold more easily and ranks ahead of comparable items (semantic + keyword-fallback paths)

Schema:
- `knowledge_items.starred` boolean (default false) — migration `j7k8l9m0n1o2`

---

### v2.6.0 — 2026-06-13
**Rokid Glasses HUD: full TTS, photo flow, brightness, session polish**

Features:
- Swipe brightness control on glasses touchpad
- Double-tap main view to stop TTS / sleep display
- Hands-free photo flow + display-off gesture
- Kokoro voice settings surfaced in glasses UI
- Session picker feedback + media sync hardening
- Auto-send voice input + TTS enabled by default
- TTS stop controls: tap to stop, voice trigger interrupts playback
- 7 HUD/assistant improvements: display, scroll, media, photos, cards
- Z.ai GLM models surfaced with free-tier defaults
- Resilient WiFi P2P install + auto-launch HUD + Kokoro TTS via TARS
- BLE scanning for glasses discovery (replaced bonded-device lookup)
- ApkInstaller: push glasses APK via Rokid SDK WiFi P2P

Fixes:
- Session continuity, TTS-stop-any-gesture, continuous conversation, photo overlay, tool routing
- Removed 500-char message truncation that corrupted large JSON payloads
- Real display-off, correct brightness direction, wake-on-interaction, gallery DCIM, build tag
- TTS streaming: chunk past Kokoro's 510-phoneme limit (both harness and glasses ends)
- Active stream keepalive prevents display dimming mid-response
- Keep HUD in foreground: auto-launch on connect + manual button
- Null-safe Gson frame parsing (Gson nulls were killing the WebSocket)
- Force phone built-in mic for voice (glasses BT SCO was capturing microphone)
- Auto-connect TARS on launch + retryable error state

---

### v2.5.0 — 2026-06 (approx)
**Kokoro TTS voice settings, chat composer redesign, TTS speaking indicator**

- Kokoro TTS voice selector (alloy, echo, fable, onyx, nova, shimmer) + speed slider in Settings
- Chat composer redesign: mic on right when empty (mic=send pattern), send when text present, stop square when streaming
- Amber "TARS is speaking" pill above composer with pulsing AudioLines icon
- TTS AbortController Set fix (stopped any active TTS on new message)
- Enlarged header mic button

---

### v2.4.6 — pre-June 2026
**Rokid glasses initial integration**

- FastAPI WebSocket bridge `/api/rokid/ws`
- Android phone-app: TarsClient (JWT WS), TarsAuthManager, TarsBridgeService
- Android glasses HUD: Jetpack Compose on 480×640 green micro-LED
- Gesture handler: temple touchpad support
- Phone↔glasses protocol (clawsses-compatible wire format)

---

### v1.0.0 — Session 9 completion
**Full production deploy: PWA, push notifications, Settings, Kokoro TTS**

- PWA manifest + share target
- Push notifications (VAPID)
- Settings view: profile, model routing, notification prefs, voice section
- Kokoro TTS embedded: sentence-by-sentence streaming via `/api/proxy/tts`
- Voice input: `useVoiceInput` hook, VAD silence detection, transcription

---

### v0.8.0 — Session 8
**Google Calendar sync + Calendar view**

- Google Calendar connector (read + write)
- Calendar view: month/week/day toggle, event color coding
- create_calendar_event, update_calendar_event, delete_calendar_event tools

---

### v0.7.0 — Session 7
**Document ingest + Second Brain full UI**

- PDF (pymupdf), PPTX (python-pptx), DOCX (python-docx), URL (trafilatura) parsers
- Chunking pipeline: 500-token chunks, 50-token overlap, pgvector embeddings
- Second Brain UI: collections sidebar, masonry grid, semantic search, annotations

---

### v0.6.0 — Session 6
**Agent Jobs + Artifacts**

- Claude Code subprocess executor
- Supervised approval flow (Approve / Modify / Reject)
- Agent Jobs UI: live output stream, approval flow
- Artifacts view: auto-save hook, version tracking, file grid/list

---

### v0.5.0 — Session 5
**Tasks + Meetings**

- Task CRUD: kanban (Inbox/Todo/In Progress/Done/Snoozed)
- Fireflies webhook: meeting.ended → transcript ingest
- Meeting processor: AI summary + action item extraction
- Action items → Tasks flow

---

### v0.4.0 — Session 4
**Connectors + Cron**

- Gmail connector (read, webhook)
- Google Calendar connector (read, write)
- Fireflies sync
- Prompt cron system: wall-clock scheduled Tier 3 jobs (Asia/Manila tz)
- Connector cron: interval-based sync loops

---

### v0.3.0 — Session 3
**Memory layer**

- Mnemon: episodic read/write with pgvector
- Second Brain: URL + text ingest, embeddings
- Context injection: both memory stores queried before every turn

---

### v0.2.0 — Session 2
**Harness core + Chat end-to-end**

- Model client: Anthropic API + RunPod unified
- Tier classifier (Haiku-based)
- Context assembler
- Chat endpoint with streaming
- Chat UI end-to-end

---

### v0.1.0 — Session 1
**Foundation**

- Turborepo monorepo
- Docker Compose: Postgres + pgvector + Redis
- FastAPI skeleton
- Next.js shell
- GitHub Actions CI
- Server bootstrap on Hostinger KVM4
