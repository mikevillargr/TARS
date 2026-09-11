# TARS System State
> Single source of truth for TARS's own architecture, infrastructure, and version history.
> Updated by Claude Code on every version tag and infrastructure change.
> Injected into TARS's context assembler so it can answer questions about itself.

---

## Current Version

| Field | Value |
|---|---|
| Version | v2.19.4 |
| Released | 2026-09-11 |
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
| Speech-to-text | faster-whisper — open source (MIT, SYSTRAN/faster-whisper), self-hosted CPU int8 — `WHISPER_MODEL` env var, default "small" |
| Text-to-speech | Kokoro TTS — open source (Apache-2.0, hexgrad/Kokoro-82M via kokoro-onnx), embedded in harness process |
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

## Active Components (13)

| # | Component | Route | Status |
|---|---|---|---|
| 1 | Today | /today | Live — landing screen. AI-inferred signals needing a decision, grouped by urgency, with named actions, swipe-to-dismiss, snooze, undo, and a state-driven ambient backdrop. Replaces the old prompt-cron daily digest. Populated by the `signal_sweep` job every 4 hours (stalled tasks, unconverted meeting action items grouped by meeting, calendar conflicts, and Tier 2 extraction of commitments from transcripts), or on demand via `POST /api/signals/generate`. |
| 2 | Chat | /chat | Live |
| 3 | Projects | /tasks | Live — renamed from "Tasks" |
| 3b | To-Dos | /reminders | Live — quick personal checklist (renamed from "Reminders"); groups: Overdue/Today/Tomorrow/Upcoming/Someday/Done |
| 4 | Meetings | /meetings | Live |
| 5 | Calendar | /calendar | Live |
| 6 | Feed | /feed | Live — three-panel RSS/YouTube/Reddit/podcast reader; save items to Second Brain; "Chat with TARS" sends article to new conversation |
| 7 | Second Brain | /second-brain | Live — items can be **starred** (pinned); starred items sort first and get a relevance boost in retrieval; **export** to DOCX, PDF, or Google Doc via item detail modal |
| 8 | Artifacts | /artifacts | Live |
| 9 | Cron Manager | /cron | Live |
| 10 | Connectors | /connectors | Live |
| 11 | Mnemon | /memory | Live |
| 12 | Settings | /settings | Live |

**Agent Jobs (retired, 2026-09):** the in-app autonomous Claude Code subprocess feature was
removed — no route, no nav entry, backend `agents/` package deleted. See `AGENTS.md` Part 2 at
the repo root for the historical runbook and known orphaned remnants.

---

## Active Connectors

| Connector | Capabilities | Status |
|---|---|---|
| Gmail | read, webhook | Live |
| Gmail (Personal) | read, write (send/reply) | Built, not yet connected — OAuth consent screen blocks personal @gmail.com accounts (likely "Internal" user type); needs Google Cloud Console fix before connecting |
| Google Calendar | read, write | Live |
| Google Calendar (Personal) | read, write (create/update/delete) | Live — connect via Connectors page |
| Google Workspace (Personal) | read, write | Live — connect via Connectors page |
| Fireflies | read, webhook (meeting.ended) | Live |
| Strava | read | Live |
| Tesla (Tessie) | read, write (full vehicle control) | Live |
| Google Contacts | read, write, weekly sync | Live |
| Google Workspace | search Drive + read & write Docs/Sheets/Slides | Live |
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

### v2.19.4 — 2026-09-11
**Feature: the v2.19.3 inline-action-step extended to the chat-handoff kinds**
- `draft_reply` / `move_event` / `save_brain` / `discuss` — the four action kinds that hand a
  signal off to a pre-seeded chat conversation — now expand a `ComposeStrip`
  (`components/today/ComposeStrip.tsx`) first, matching the intermediate-step pattern
  `InlineActionForm` established for `create_reminder`/`create_task`/`create_event` in
  v2.19.3. There's nothing structured to edit for these kinds (no title, no due date — the
  work is composition, which stays chat's job), so the strip is a single freeform note field
  (optional, with a per-kind placeholder) rather than a full form.
- Confirm sends the note as `ActRequest.note` — the field itself was added in v2.19.3 as
  forward-looking plumbing but stayed unused, since nothing in the frontend called a
  chat-handoff action with a note yet. This is what it was for.
- `ComposeStrip` shares `InlineActionForm`'s `FormShell`/`fieldStyle` (now exported) so the
  two intermediate-step UIs read as one system rather than two separately-designed ones.
- Completes the action matrix started in v2.19.3: every kind except `open_meeting` (pure
  navigation, nothing to negotiate) now gets a real intermediate step before anything fires —
  `InlineActionForm` for the three that commit directly, `ComposeStrip` for the four that
  hand off to chat.
- Web-only, no schema change.

---

### v2.19.3 — 2026-09-11
**Feature: Today card actions get an intermediate step before they commit — inline forms,
not straight-to-chat**
- Every action on a `/today` signal card used to do one of two things immediately on click:
  fire a server-side create (Reminder/Task/Event) using whatever the detector had proposed,
  or dump the card's contents into a new chat conversation. Neither left room to redirect
  before something existed. New `InlineActionForm` component (`components/today/
  InlineActionForm.tsx`) expands inside the card for `create_reminder` / `create_task` /
  `create_event` — editable text/title/description, due-date chips, priority chips, and for
  `create_event` a date/time/duration/calendar picker — before Confirm sends the edits as
  `ActRequest.payload_override`, merged server-side over the action's own payload
  (`act_on_signal`, `api/routes/signals.py`).
- Grouped batch signals (e.g. "4 action items from X were never assigned" — one card per
  meeting, not per item, since v2.17.0) get a per-item checklist for `create_task` instead of
  either one bundled task covering unrelated commitments or a wall of individual cards:
  every item defaults checked, editable inline, unchecking is how you get "just this one".
  `detect_unconverted_action_items` (`jobs/signal_generator.py`) now carries the raw item
  texts in the action payload (`items`) for this, and no longer defaults the reminder/task
  payload text to the detector's own summary line ("4 action items from X were never
  assigned" is the card's headline, not something that belongs as a To-Do's actual text).
- Fix: `open_meeting` had been silently falling through to the chat-handoff branch since
  v2.16.0 — its label ("Open project" / "Review in the meeting") never matched what it
  actually did, which was seed a conversation. It's pure navigation (`source_ref` is already
  the task or meeting id), so it now gets its own dispatch branch returning a computed
  `ActResult.route`, and the frontend pushes to it directly — no conversation created. This
  needed `/tasks` and `/meetings` to actually support `?id=` deep-linking, which neither did
  before (confirmed: Today's own overdue-task row was pushing to `/tasks?id=` and landing on
  an unfiltered board). Both pages gained a `Suspense`-wrapped `useSearchParams` reader
  (mirroring the existing pattern in `second-brain/page.tsx`) that opens the matching
  task/meeting detail panel once.
- The four chat-handoff kinds (`draft_reply`, `move_event`, `save_brain`, `discuss`) gained
  an optional freeform `note` field (`ActRequest.note`), surfaced as "Mike's direction" ahead
  of the detector's own reasoning in the seeded prompt — steering input, not yet an in-card
  resolver; drafting/rescheduling still hands off to chat pending a later pass.
- Harness + web, no schema change — `payload_override`/`note` are request-only fields, not
  persisted on `Signal`.

---

### v2.19.2 — 2026-09-11
**Fix: Contacts page crushed on mobile — no responsive master-detail behavior**
- The Contacts page (`/contacts`) rendered a fixed two-column flex layout (320px list +
  flex:1 detail) unconditionally, with no mobile breakpoint handling at all. On a narrow
  viewport the detail panel was squeezed into whatever space was left after the
  260-360px-wide list sidebar, rendering it unreadably crushed.
- Fixed with the same `useIsMobile` hook (768px breakpoint) already used elsewhere in the
  app (Second Brain, Feed): below the breakpoint, only one panel renders at a time,
  full-width — the contact list when nothing is selected, the detail panel (with a new
  back button) once a contact is selected. Desktop layout unchanged.
- Web-only, no schema change.

---

### v2.19.1 — 2026-09-09
**Fix: owner filter tightened to a strict allowlist; confirmed the v2.19.0 retirement closed
the recurring-duplicate bug too**
- User reported (after v2.19.0) still seeing misattributed cards and recurring cards on
  topics already dismissed. Investigation against live production data found both were
  explained by the now-retired `detect_meeting_commitments`: ~24 signals from that detector,
  all already dismissed by the user by hand, spanning 6 sweeps across one day with
  near-duplicate titles for the same underlying meetings ("Resend captions and ad headlines
  for Star Clippers" / "Resend ad copy and headlines to Vanessa" / "Send captions and
  headlines") — its `dedupe_key` fingerprinted the model's own generated title text, which
  reworded slightly every sweep, defeating dedup entirely. Confirmed zero open
  `fireflies`-sourced signals on production post-retirement, and a live manual sweep run
  directly on the server showed exactly 4 detectors (no `meeting_commitments`), no errors —
  the v2.19.0 fix was working; the backlog was just old signals created before it landed,
  never bulk-cleaned.
- Separately, explicit correction to `detect_unconverted_action_items`'s owner filter:
  `_owner_is_someone_else` treated an unassigned owner as "ambiguous, stays in" — replaced
  with `_owner_is_mike`, a strict allowlist that only surfaces an item when it's explicitly
  attached to "Mike"/"Mike Villar" by name. No name means "not confirmed as his," not "maybe
  his." Trades a possible false negative (a genuinely-his item that came through unassigned)
  for zero false positives. Checked against current production data: 0 unassigned items in
  the active 7-day window, so no immediate visible change — this is a forward-looking
  tightening for future extractions.
- Harness-only, no schema change.

---

### v2.19.0 — 2026-09-08
**Retire: detect_meeting_commitments folded into meeting_processor.py's action-item extraction**
- Root-cause resolution to the v2.18.10/v2.18.11 misattribution bug, not another patch on
  top of it: `detect_meeting_commitments` existed as a second, independent extraction over
  raw meeting transcripts, re-deriving ownership from scratch with no cross-reference —
  structurally worse at this than `meeting_processor.py`'s existing action-item extraction,
  which already does it reliably (full transcript, Fireflies' own overview/action-items
  text, one focused job — evidenced by correct real names like "Isabelle Bryce", "Vanessa
  Ramos" in production `MeetingActionItem.owner` data). Rather than keep defending a worse
  extraction with heuristics, `meeting_processor.py`'s prompt was broadened to also capture
  informal verbal commitments ("let me send that over"), not just explicitly-stated to-dos,
  with the same owner-attribution rigor. `detect_meeting_commitments`, `EXTRACT_SYSTEM`, and
  the v2.18.10/v2.18.11 speaker-lookup/grounding helpers are all removed —
  `detect_unconverted_action_items` (already correctly owner-filtered since v2.17.2) now
  covers both cases through one reliable data source instead of two.
- Net simplification: signal_generator.py shrank by ~200 lines; one fewer Tier 2 call per
  meeting per sweep.
- Scope note: this only changes extraction for meetings processed going forward — it does
  not retroactively re-tag ownership on already-processed historical meetings.
- Harness-only, no schema change.

---

### v2.18.11 — 2026-09-08
**Enhance: meeting-commitment extraction now grounded in Fireflies' own owner data**
- Follow-up to v2.18.10. That fix caught misattribution via a transcript speaker-lookup,
  but a fair question surfaced it was solving the problem the hard way: the Meetings
  screen already trusts `MeetingActionItem.owner`, extracted reliably by the same
  meeting-processing pipeline (real names — "Isabelle Bryce", "Vanessa Ramos" — not
  nulls) — so why not just reuse that instead of re-deriving ownership from scratch?
- Checked: two of the three real misattributed signals from v2.18.10 DO correspond to
  action items Fireflies already correctly attributed to someone else. But naive string
  similarity between a freshly generated commitment title and the differently-phrased
  action-item summary came back at 20-38% — not distinguishable from noise, so it isn't
  a usable hard filter on its own. And the third misattributed signal wasn't in the
  structured action-items list at all — exactly the class of item this detector exists
  to catch, so owner cross-referencing alone can't fully replace it.
- Fix: `_other_owned_items_block` (new) feeds the meeting's already-extracted,
  owner-tagged action items into the commitment-extraction prompt as grounding context,
  so the model judges semantic overlap (which it's far better at than string-matching)
  instead of re-deriving ownership blind. EXTRACT_SYSTEM prompt gained an explicit rule
  to skip anything substantially overlapping an already-owned item. The v2.18.10
  transcript speaker-check stays as the deterministic backstop for commitments that
  never made it into the structured list.
- Harness-only, no schema change.

---

### v2.18.10 — 2026-09-08
**Fix: meeting-commitment signals attributed other attendees' spoken commitments to Mike**
- Root cause, confirmed against live production data: `detect_meeting_commitments`
  (jobs/signal_generator.py) re-extracts "things Mike committed to" from the raw
  transcript via a Tier 2 (GLM) model call, and the model does not reliably check
  *who* said a first-person line before attributing it to Mike. Two real, currently-open
  production signals on inspection: "Resend captions and ad headlines for Star Clippers"
  quoted "Let me message you with the updated captions" — actually said by Isabelle
  Bryce, not Mike; "Post on-page content for Switzerland campaign" quoted "You're just
  waiting on me to post the on page post" — same speaker, same misattribution pattern.
  Separately confirmed `detect_unconverted_action_items`'s owner filter (v2.17.2) is
  working correctly for everything currently open — the only bad signals found there
  were stale, already-dismissed rows generated during a past window where the harness
  process had been deployed via `git pull` but not `pm2 restart`, so it kept running
  pre-fix code for a stretch. That's now a known deploy-hygiene risk: `git pull` alone
  does not update the running process.
- Fix: `_commitment_misattributed` (new) is a deterministic backstop, not a prompt
  tweak alone — it locates the model's quote inside the actual transcript (exact match,
  falling back to fuzzy line matching via `difflib` since quotes are often light
  paraphrases, not verbatim) and checks the nearest preceding speaker header. A
  first-person quote ("I'll...", "let me...", "...on me") whose real speaker isn't Mike
  is dropped before the signal is ever created. Verified directly against the real
  production transcript for both examples above — both now correctly filtered; a
  genuinely ambiguous third quote ("if you wouldn't mind...", no first-person marker)
  correctly stays in, matching this codebase's existing "ambiguous stays in" convention.
  EXTRACT_SYSTEM prompt also tightened with explicit speaker-attribution rules as a
  first line of defense.
- One-time production cleanup: the two confirmed-misattributed open signals dismissed
  directly (same `status='dismissed'` the app's own dismiss action sets — reversible via
  the existing Restore action in Today's dismissed view).
- Harness-only, no schema change.

---

### v2.18.9 — 2026-09-08
**Fix: fact-extraction quality tightened before the v2.18.8 backfill ran**
- Manual dry-run review across 15 messages spread over the affected window surfaced two
  issues: raw `[[id|type|label]]` mention markers leaking into the extraction prompt, and
  low-value pseudo-facts being extracted from mere questions/requests ("user is asking
  about their ride performance").
- New `_strip_mention_markers` replaces markers with the plain label before fact-extraction
  and title-generation see the text.
- Extraction prompt now explicitly excludes questions/requests/"a conversation happened",
  requiring a concrete durable fact (decision, preference, identifying detail, status
  change); SKIP is framed as the common correct answer, not a fallback.
- Re-verified the same 15-message sample after the change: junk extractions correctly
  became SKIP, genuine updates (e.g. a bike component change) still extract cleanly.
- Harness-only, no schema change.

---

### v2.18.8 — 2026-09-08
**Fix + RCA: root cause of ~2 months of degraded memory extraction, found and closed**
- RCA: `_extract_and_save_facts`/`_generate_title` were hardcoded to Claude until commit
  `5ca261f` (2026-06-04) made them provider-configurable, introducing the latent
  `content[0].text` bug fixed in v2.18.6/v2.18.7. It stayed dormant until Tier 1's
  provider/model was pointed at a Z.ai reasoning model — a change made through
  `PATCH /api/settings/model-routing`, which writes directly to `.env` with no git
  commit and no deploy. That's the resolution to "no deployments happened, so why did
  this break": it wasn't a deploy, it was a Settings-page change, invisible in deploy
  history by construction.
- Weekly memory counts corroborate the timeline: ~44-143/week through late June, 10
  (Jul 6), 0 for three weeks, then a 1-3/week trickle through August until the fix.
- Hardened all four affected call sites with generous `max_tokens` as defense-in-depth
  on top of the thinking-disabled fix: classifier 20→200, titles 30→200, fact-extraction
  300→800, compaction 600→1200.
- One-time backfill re-ran extraction over the affected window's historical messages to
  recover facts that were silently dropped; existing cosine-similarity dedup in
  `mnemon.write` (threshold 0.12) prevented duplicates for anything already captured.
- Harness-only, no schema change.

---

### v2.18.7 — 2026-09-08
**Fix + change: third thinking-block instance found; title generation throttled**
- Found a third call site with the exact v2.18.6 bug: `_extract_and_save_facts` (memory
  extraction) — fixed with the same `_first_text_block`/`_zai_kwargs` helpers.
- Conversation titles now regenerate on the first assistant turn, then every 5 turns after,
  instead of unconditionally on every turn. Confirmed live that the v2.18.6 fix itself
  works correctly in isolation, but a title was still observed stuck on stale text — the
  likely cause is that firing on every turn let multiple title-gen calls run concurrently
  in a fast back-and-forth conversation with no ordering guarantee, so a slower/earlier
  call finishing last could silently overwrite a fresher title. Throttling also cuts Z.ai
  request volume, since title-gen was firing alongside the main reply and fact-extraction
  calls on every single turn.
- Harness-only, no schema change.

---

### v2.18.6 — 2026-09-08
**Fix: classifier, chat titles, and compaction all silently broken on Z.ai tier1**
- Root cause: Z.ai's Anthropic-compatible endpoint puts a mandatory "thinking" block at
  `content[0]` (`text=None`) before any real output on GLM 4.x "hybrid reasoning" models.
  Three call sites — the tier/category classifier (`max_tokens=8`), conversation title
  generation (`max_tokens=15`), and rolling compaction — all did `content[0].text.strip()`
  directly; the thinking trace alone blew past those token budgets, so the call threw on
  nearly every request and was swallowed by a bare `except`.
- Classifier impact: every ambiguous message fell back to the crude length/regex
  `_heuristic` in `core/router.py` instead of a real model judgement — this is the likely
  cause of the erratic model-bouncing seen mid-conversation (short replies routed to Tier 1,
  everything else defaulting to Tier 2, with no real reasoning behind either).
- Title impact: title generation kept throwing and returning `None`, so `if new_title:`
  never fired and conversations stayed on "New Conversation" indefinitely.
- Confirmed live against production before and after the fix — the broken call reliably
  returned a thinking-only block; the fixed call returned a correct classification/title
  immediately.
- Fix: scan all response content blocks for the first non-`None` text instead of blindly
  indexing `[0]`; pass `extra_body={"thinking": {"type": "disabled"}}` for zai calls (the
  installed `anthropic==0.43.0` SDK predates typed `thinking=` support); raised token
  budgets slightly (classifier 8→20, titles 15→30) as a second safety margin.
- Harness-only, no schema change.

---

### v2.18.5 — 2026-09-08
**Fix: read_email returned "no email found" for HTML-only messages**
- `_extract_body` (connectors/gmail.py) only recognized `text/plain` MIME parts. Bank/bills-
  payment/notification emails are commonly HTML-only with no plain-text alternative, so
  extraction returned `""`, and `read_email`'s search path silently treats an empty body as
  no-match — reporting zero results even though Gmail's own search found the thread.
- Root-caused by reproducing live against production: searching personal Gmail for
  "metrobank online" found 5 real threads, but body extraction on the top match returned
  length 0 — confirmed HTML-only.
- Fix: new `_walk_body_parts` collects the first `text/plain` and first `text/html` anywhere
  in the MIME tree (order-independent — still prefers plain when both exist); new
  `_html_to_text` (via `lxml`, already present through trafilatura) strips script/style and
  renders readable text as the fallback.
- Note: the multi-turn conversation where this surfaced read like model hallucination
  (increasingly confident "no Metrobank emails anywhere, must be a third account"). Live
  reproduction shows this bug alone is sufficient to produce that exact symptom for any of
  the search phrasings tried, since the search path only inspects the top-ranked match per
  account (`threads[:1]`) — if that top match is HTML-only, the empty extraction is reported
  as "no email found" regardless of how many real matches exist below it.
- Harness-only, no schema change.

---

### v2.18.4 — 2026-09-08
**Feat: multi-account calendar parity + cross-calendar conflicts + manual email account override**
- `detect_calendar_conflicts` (Signals) now merges work AND personal calendar events into
  one timeline before checking overlap — previously only checked the work calendar, so a
  work meeting double-booked against a personal appointment was invisible to `/today`.
  Cross-account conflicts skip client-name resolution and label the personal side inline.
- `EmailDraftCard` header now has a clickable `WORK`/`PERSONAL` toggle (was a read-only tag
  reflecting only the model's inferred account) — lets Mike correct the account before
  sending on a fresh compose, where there's no reply-thread to disambiguate from.
- Calendar writes now support the personal account: `create_calendar_event` /
  `update_calendar_event` / `delete_calendar_event` tools and the manual Add Event modal all
  gained an `account` field (`work`|`personal`, default `work`); `gcal_personal` capability
  bumped `read` -> `read, write`; the REST `/api/calendar/events` routes accept the same field.
- Harness + web, no schema change.

---

### v2.18.3 — 2026-09-08
**Feat: personal Gmail can send/reply, not just read**
- `gmail_personal` connector capability list changed `["read"]` -> `["read", "write"]`.
- `send_email` / `confirm_send_email` tools and the manual Send button's
  `POST /api/email/confirm-send` gained an `account` field (`"work"` | `"personal"`,
  default `"work"`) that selects which Connector row (`Gmail` vs `Gmail (Personal)`) the
  `GmailClient` sends through. Both send paths were previously hardcoded to the work Gmail
  connector regardless of which inbox the draft came from.
- Model defaults to `account: "personal"` when replying to a thread shown under
  `[PERSONAL GMAIL]` context, or when Mike explicitly asks to send from his personal email.
- `EmailDraftCard` shows a small `PERSONAL` label on the draft/sent card when applicable.
- Caveat: personal Gmail OAuth itself is still blocked — see Active Connectors above. This
  ships the send capability so it's ready the moment that's connected.
- Harness + web, no schema change.

---

### v2.18.2 — 2026-09-08
**Fix: Today is now the actual landing surface, matching the spec**
- §8 has called Today "the landing surface" since v2.16.0, but the code never matched: root
  `/` and post-login both redirected to `/chat`, and the PWA manifest's `start_url` was
  `/chat`. All three now point to `/today`.
- Files: `app/page.tsx` (root redirect), `app/(auth)/login/page.tsx` (post-login redirect),
  `public/manifest.json` (`start_url`).
- Caveat: an already-installed PWA icon has its `start_url` baked in at install time on most
  platforms and generally won't pick up this change until removed and reinstalled — new
  installs and normal browser-tab entry get it immediately.
- Chat is unaffected otherwise — still first-class in nav, shortcut "2".
- Web-only, no schema change.

---

### v2.18.1 — 2026-09-08
**Redesign: signal cards get a dedicated context chip**
- New `Signal.context_label` column (migration `s6t7u8v9w0x1`) replaces the v2.17.2/v2.18.0
  approach of prefixing a client name onto the title (`"NCH Inc.: ..."`) and appending it to
  `source_label` (`"Fireflies · NCH Inc."`). Titles are clean imperatives again; the client
  renders as its own chip in the card header.
- All four client-tagging detectors (`detect_unconverted_action_items`,
  `detect_meeting_commitments`, `detect_calendar_conflicts`, `detect_actionable_emails`) now
  pass `context_label=...` to the candidate instead of mutating title/source_label.
- `EMAIL_EXTRACT_SYSTEM` gained a `category` field (billing/legal/banking/vendor/recruiting/
  scheduling/internal) for email senders who aren't a resolved client — an AWS billing email
  or a bank notice still gets a scannable chip instead of nothing. Client resolution always
  takes priority; category is strictly a fallback, never both on one card.
- `SignalCard.tsx`: new neutral chip style (`--c-surface-2` fill, `--c-ink-muted` text,
  `--c-border-faint` hairline) — deliberately not moss, which stays reserved for
  interactive/accent elsewhere in the app. Added a 12px source icon per detector (mail /
  meeting / calendar / project / feed / activity), tinted with the existing urgency accent —
  no new color introduced. FYI rows carry the same context inline as text, not a boxed chip,
  keeping "no card weight" true for that row type.
- Design pass referenced Refero MCP for tag-chip patterns (Raycast/Linear-style dark
  changelog cards); Mobbin was requested but isn't connected as an MCP for this session.
- Harness + web + DB migration.

---

### v2.18.0 — 2026-09-08
**Feature: fifth signal detector — actionable email**
- `detect_actionable_emails` surfaces inbound Gmail threads still awaiting a reply, whether
  unread or read-but-never-answered — closing the gap where email signals didn't exist at all.
- New `GmailClient.get_awaiting_reply` (`connectors/gmail.py`) determines "still waiting"
  deterministically off the **SENT label** on a thread's most recent message rather than the
  unread flag or a From-address comparison — works across whatever alias received the mail,
  and catches messages Mike opened but never replied to, not just unread ones. Excludes
  Promotions/Social/Forums categories before a model call is ever spent.
- For threads that pass, Tier 2 judges actionability with the same conservative,
  empty-is-a-valid-answer contract as `detect_meeting_commitments`: newsletters, receipts, and
  automated notices correctly resolve to "no action needed" rather than being invented into
  cards.
- Reuses v2.17.2's `_client_for_attendees` for client tagging (sender email → Contacts
  organization field).
- `dedupe_key` = `thread_id` + latest message id, so dismissing a thread means "no action was
  needed" and it stays dismissed unless a genuinely new message arrives on it.
- Actions surfaced (`draft_reply` / `create_task` / `create_reminder`) were all
  already-supported signal action kinds — no frontend changes needed.
- **Scoped to the primary Gmail account only for v1** — `read_email`'s thread-id resolution
  always tries the work account first, so personal-account threads would fail the
  `draft_reply` hand-off. Follow-up if needed.
- Refactor: `_EXTRACTION_ERRORS` renamed `_MODEL_ERRORS` and its `.clear()` moved from inside
  `detect_meeting_commitments` to once per sweep in `generate_for_user` — two model-assisted
  detectors sharing one clear-on-entry list would wipe each other's errors. The
  empty-candidates early return in `generate_for_user` now also surfaces `model_errors`
  instead of silently dropping them.
- Harness-only, no schema change.

---

### v2.17.2 — 2026-09-08
**Fix + Enhance: signal generator surfaced other people's action items, and cards lacked client context**
- `detect_unconverted_action_items` grouped every Fireflies action item whose `task_id` was
  unset into the brief, regardless of who it was assigned to — Fireflies extraction has no
  notion of "mine", so a meeting with items for other attendees put their work on Mike's Today
  screen too. New `_owner_is_someone_else` filters out items whose extracted `owner` explicitly
  names someone other than the user (matched against `User.name`); unassigned items (`owner` is
  null/blank) stay in since there's no one else to attribute them to.
- Card titles from meeting/calendar detectors were generic ("4 action items from 'Weekly Sync'
  were never assigned") with no indication of which client the meeting was for. New
  `_client_for_attendees` resolves a best-effort client name per meeting/event from the
  Contacts graph — matches attendee emails (external domains only, Growth Rocket + common
  personal webmail excluded) against synced Google Contacts and returns the most common
  `organization`. Deliberately not a hardcoded client list, so it stays correct as clients
  change. Applied to `detect_unconverted_action_items`, `detect_meeting_commitments`, and
  `detect_calendar_conflicts`: title prefixed `"{Client}: ..."` and `source_label` becomes
  `"Fireflies · {Client}"` / `"Calendar · {Client}"` when a client resolves; unchanged when it
  doesn't (no client tag rather than a guess). `detect_stalled_tasks` untouched — Task has no
  attendee data to derive a client from.
- Harness-only, no schema change.

---

### v2.17.1 — 2026-09-07
**Fix: calendar conflict detection crashed in production**
- `detect_calendar_conflicts` passed `time_min`/`time_max` as ISO strings, but
  `GoogleCalendarClient.list_events` takes `datetime` objects and calls `.isoformat()` itself —
  so every sweep logged `'str' object has no attribute 'isoformat'` and produced zero calendar
  signals.
- It passed local testing only because no Google Calendar was connected there, so the detector
  returned early and never reached the call. The first production sweep exposed it immediately.
- Now covered by a stub-connector test asserting the client receives `datetime`, not `str`.

---

### v2.17.0 — 2026-09-07
**Feature: signal generation — `/today` fills itself**
- `jobs/signal_generator.py`, scheduled as `signal_sweep` every 4 hours, plus
  `POST /api/signals/generate` to run one inline on demand.
- Four detectors, split by whether the answer is a **fact** or a **judgement**:
  - *Deterministic (no model):* overdue/stalled tasks; Fireflies action items that never became
    work; overlapping calendar events in the next 7 days. Asking a model whether two datetimes
    overlap would be slower, cost money, and be less reliable than a comparison.
  - *Model-assisted (Tier 2, strict JSON):* commitments made in meeting transcripts, surfaced
    with the verbatim quote that supports them.
- Action items are grouped **by meeting**, not one card per item. One real week produced 225
  unconverted items; as individual cards that is a wall, not a triage surface. 225 → 18.
- `dedupe_key` is checked against signals in **any** status, so a dismissed signal never
  returns — a dismissed-but-still-true condition stays dismissed, because re-nagging is how a
  triage surface loses trust.
- Sweep results report `created` / `already_seen` / `deferred_by_cap` separately and surface
  `model_errors`; a misconfigured tier otherwise looks identical to "nothing to report".
- **Fix:** `core/model_client._resolve_pair` hardcoded `glm-4.7` as the tier2 fallback
  regardless of provider, so an `anthropic` tier2 with no model override sent a Z.ai model name
  to the Anthropic API and 404'd **every** Tier 2 request. This silently broke all of Tier 2 on
  any install using the default `tier2_provider` without an override. Now provider-appropriate.
- **Fix:** user resolution used `User.name`; the canonical row matches on `User.id`
  (the v2.15.10 pattern).
- Harness-only, no schema change.

---

### v2.16.0 — 2026-09-07
**Feature: Today screen + Signals**
- New `/today` route, first in nav, and the app's landing surface. Does **not** replace `/chat`.
- Lists **signals**: items TARS inferred across email, meeting transcripts, calendar, and
  projects that appear to need a decision. Replaces the prompt-cron daily digest, which dumped
  prose into a chat conversation you then had to act on manually.
- New `signals` table (migration `r5s6t7u8v9w0`) with a `dedupe_key` unique per user, so a
  dismissed signal doesn't reappear on the next generator sweep.
- `GET /api/signals`, `POST /{id}/act|snooze|dismiss|restore`, `GET /{id}/event.ics`.
  Snoozed items wake on read rather than via a worker.
- Action dispatch splits deliberately: `create_reminder` (**the default — signal work lands in
  To-Dos, not Projects**), `create_task`, and `create_event` execute server-side; `draft_reply`,
  `move_event`, `open_meeting`, `save_brain` open a pre-seeded conversation so email keeps the
  draft-card approval gate that already exists in chat.
- Undo restores the signal but deliberately does **not** delete a side effect already created.
- UI: uncapped urgency-grouped cards, a named primary action plus alternates in an overflow
  menu, `why` disclosure with reasoning + citation, swipe-to-dismiss on both touch and trackpad,
  5s undo with a draining timer, and three distinct blank states (earned / parked / quiet).
- A state-driven ambient backdrop on `/today` only: moss glow tracks a sun arc across the day,
  intensity scales with open signal count, ALL CLEAR collapses it to the boot glow.
- **Known gap:** signal *generation* from real sources is not built. `/today` will show
  "NOTHING IN" on production until that job lands. `scripts/seed_signals.py` seeds dev data.
- Fix: `next.config.ts` `allowedDevOrigins` — Next 16 blocked `/_next/*` dev resources on
  127.0.0.1, so React never hydrated and the whole app was non-interactive on that origin.

---

### v2.15.12 — 2026-07-16
**Fix + Enhance: typeset pass — WCAG contrast, code block chrome, prose sizing, label consistency**
- `--c-ink-faint` in light mode darkened #948a7b → #7a7062 (now passes WCAG AA 4.5:1 on surface; was 3.0:1 — affected all `.tars-label` text in light mode)
- Code/SVG block headers now use CSS tokens (`--c-surface-raised`, `--c-border`, `--c-ink-faint`, `--c-moss`) instead of hardcoded dark hex — adapts correctly in both light and dark themes
- Chat prose promoted from 14px on desktop to 16px at all viewport sizes (p, h3, ul, ol, blockquote were `text-base md:text-sm`; h3 also collapsed to same visual weight as body — now stays distinct)
- ThinkingBlock "REASONING" label and toggle button converted to `.tars-label` (mono, 11px, uppercase, tracked — was ad-hoc inline styles at 10px)
- ThinkingBlock reasoning text: 11.5px (off-scale) → `text-xs` (12px)
- Token count `{n} tok` display: ad-hoc `text-[10px] + shadcn text-muted-foreground + font-mono` → `.tars-label.tars-label--muted`
- ModelBadge: 10px (0.625rem) → 11px (0.6875rem) — now matches `.tars-label` standard
- ProseMirror (Second Brain editor) h1/h2 fallback: `serif` → `sans-serif` (Lora was removed in v2.7.0; serif fallback was a stray reference)
- Web-only, no schema change.

### v2.15.11 — 2026-07-01
**Feat: ambient gradient wash — aesthetic depth for the app canvas + chat "boot glow"**
- The app read as flat: every view sat on a solid `--c-canvas` / `--c-surface` fill and the chat empty state was a bare wordmark on plain surface. Added a whisper-quiet atmospheric wash so the interface has depth without fighting the minimal "Instrument" design language
- Direction grounded in Refero research: Perplexity ("Digital Parchment, Subtle Authority") set the restraint; Dimension ("deep-space command center") set the ambient full-bleed technique
- Three new token-driven CSS primitives in `apps/web/app/globals.css` (`@layer components`), all built from existing `--c-*` tokens via `color-mix`, so light/dark inherit automatically with no separate `.dark` rules:
  - `.tars-ambient` — app-wide canvas wash: moss radial (top-left, 34%) + amber warmth (bottom-right, 27%) over `--c-canvas`. Applied to the `(app)/layout.tsx` content wrapper, so every view gains depth in the gutters between cards
  - `.tars-ambient-chat` — chat surface: `--c-surface` dominant (message bubbles live here) + a moss radial at top (20%). Replaces the chat wrapper's solid `backgroundColor` in `chat/page.tsx`
  - `.tars-boot-glow` — a centred moss radial (45%) behind the chat empty "STANDBY" wordmark for a cinematic "powering on" halo
- Intensity evolved across three passes: initial whisper (7/5/5/12%) was imperceptible in light mode → tuned to 13/10/10/20% → dialled to full strength 34/27/20/45% ("go to the max"). Bold and atmospheric in dark, clearly present in light; text contrast still intact (verified in-browser both themes, no console errors). Decorative layers only — never affect interaction
- Web-only, no schema change

### v2.15.10 — 2026-07-01
**Fix: contact enqueue crash + removed the phantom second user (root cause of v2.15.9)**
- `pending_contacts.enqueue_pending` used `scalar_one_or_none()` on the "already a known contact?" lookup keyed by `primary_email`. Multiple distinct Google contacts can legitimately share one email (e.g. 40 test cards under `rein@growth-rocket.com`), so it raised `MultipleResultsFound` ("Multiple rows were found when one or none was required") and aborted the enqueue. Switched both the Contact and PendingContact existence checks to `.scalars().first()`
- Note: contacts were **not** row-duplicated — all 3070 have distinct `google_resource_name`; the 58 shared-email groups are real, distinct Google cards, not sync dupes
- Removed the phantom `mike.villar@gmail.com` User row (the root cause behind v2.15.9's meeting duplication). Reassigned its useful data to canonical `mike` (1 novel pending contact, 5 meeting-recall memories, 1 conversation), deleted its redundant data (21 already-known pending contacts, 1 duplicate meeting memory, 6 default user_domains), then deleted the User row. DB now has exactly one user; `select(User).limit(1)` can only resolve `mike`
- Hardened `scheduler._sync_fireflies` to resolve the user deterministically via `settings.tars_username` instead of `select(User).limit(1)`, so a stray future User row can't misroute meeting ingestion
- Harness-only, no schema change

### v2.15.9 — 2026-07-01
**Fix: Fireflies meetings synced without summaries or action items**
- Root cause 1 — a phantom second `User` row (`mike.villar@gmail.com` alongside canonical `mike`, both "Mike Villar") defeated meeting dedup. The Fireflies sync loop and the webhook both resolve the user via `select(User).limit(1)` and could land on different rows; the duplicate check was scoped to `connector_ref + user_id`, so the same transcript got ingested once per user. When the second user appeared (~Jun 27) the sync re-ingested every recent transcript under it → 24 duplicate meetings
- Root cause 2 — a transient Z.ai `429` (`rate_limit_error` code 1302) in `_ai_process` threw, and `process_meeting`'s outer handler set `status=error` with **no summary**, discarding the perfectly good Fireflies `overview` + `action_items` already fetched. The UI logs in as `mike` and showed his empty `error` copies while the good copies sat under the unseen second user
- Fix (`jobs/meeting_processor.py`): `_ai_process` now catches AI failures and **falls back to the Fireflies overview + parsed action items** instead of losing the meeting; post-commit RAG/contact side effects are guarded so they can't flip a saved meeting back to `error`; dedup now keys on `connector_ref` **alone** (with `.first()`) so the multi-user accident can no longer create duplicates
- Data cleanup (one-time, production): deduped 94 → 70 meetings — kept the copy with summary + action items per transcript, deleted 24 empty `error`/`processing` twins, reassigned 5 good copies to `mike`. Reprocessed the remaining summary-less meetings
- Harness-only, no schema change

### v2.15.8 — 2026-07-01
**Fix: PWA install button still missing on desktop — beforeinstallprompt captured too late**
- v2.15.7 restored the service worker (Chrome's install precondition) but the button still didn't appear. Root cause: the `beforeinstallprompt` listener lived only inside the Settings page's `useEffect`. Chrome fires that event **once, early, right after load, on whatever page the user landed on** (usually `/chat`, not `/settings`) — so by the time Settings mounted, the event had already fired and would never fire again. `installable` stayed false and the fallback text showed
- Fix: capture the event **globally and as early as possible**. A blocking `<head>` script in `app/layout.tsx` (runs before React hydrates) calls `preventDefault()`, stashes the event on `window.__tarsInstallPrompt`, and dispatches a `tars-installable` custom event (plus a `tars-installed` event on `appinstalled`)
- Settings `useEffect` now adopts `window.__tarsInstallPrompt` on mount (already-fired case) and also listens for `tars-installable` (fires-after-mount case) and `tars-installed`, so the Install button appears regardless of which page the event fired on
- Verified locally: the head script installs the global capture, a synthetic `beforeinstallprompt` is stashed and re-broadcast via `tars-installable`
- Web-only, no schema change

### v2.15.7 — 2026-06-30
**Fix: PWA installable again on desktop (Chrome/Edge)**
- Desktop Chrome/Edge only fire `beforeinstallprompt` (which is what reveals the **Install** button in Settings) when the site has a registered service worker **with a fetch handler**. The v2.15.3 kill switch (`public/sw.js`) unregistered the worker and `ServiceWorkerRegister` stopped registering one — fixing the stale-bundle saga but also killing desktop installability. iOS was unaffected because Safari "Add to Home Screen" needs no service worker, which is why only that path kept working
- New `public/sw.js`: a minimal worker that exists and has a fetch handler (so the app is installable) but **never caches app code** — JS/CSS/API pass straight through to the network, so deploys are never masked (no regression of the v2.15.x stale-bundle bug). It also purges any leftover caches from previous worker versions on activate. The only cached asset is a tiny `public/offline.html`, served solely when a navigation fails offline (network-first)
- `ServiceWorkerRegister.tsx` now registers `/sw.js` instead of unregistering everything; the ChunkLoadError self-heal reload is unchanged
- Settings install fallback copy updated: "Use Chrome or Edge and refresh once — the Install button appears when the browser is ready" (the prompt becomes available after the worker takes control, which can need one refresh on first load)
- Verified locally: `/sw.js` serves 200 with a fetch handler, the worker reaches `activated` and controls the page, `/offline.html` serves 200, no console errors
- Web-only, no schema change

### v2.15.6 — 2026-06-25
**Fix: Google Doc export is rich text, not raw markdown**
- The gdoc export called `create_doc` which inserts `clean_content` as plain text via the Docs API, so markdown showed literally (`## Heading`, `**bold**`)
- Now the gdoc path builds the same DOCX as the download and uploads it to Drive with conversion to a native Google Doc (`mimeType application/vnd.google-apps.document`), preserving headings, bold/italic, and lists. New `GoogleWorkspaceClient.create_doc_from_docx` (uses `MediaIoBaseUpload`; the workspace connector already holds the full `auth/drive` scope). DOCX builder is now shared between the docx and gdoc paths
- Also fixed: bold/italic/code inside bullet and numbered list items was left as literal markdown because the inline parser only ran on normal paragraphs — extracted an `add_inline()` helper applied to list items too (improves both DOCX and gdoc)
- Verified by exporting and reading the Doc back: no literal `##` or `**` remain

### v2.15.5 — 2026-06-25
**Fix: Second Brain export actually works (the real root cause, found by reproduction)**
- Reproduced the export "This page couldn't load" in a headless browser against production and captured the actual error: **two bugs in the export dropdown**, both in `components/second-brain/ItemDetailModal.tsx`:
  1. `DropdownMenuLabel` ("Export as") maps to base-ui's `Menu.GroupLabel`, which **throws Base UI error #31** ("MenuGroupContext missing") when not rendered inside a `Menu.Group`. The label sat bare inside the menu content, so opening the dropdown crashed the React tree into Next's `global-error` boundary → the "This page couldn't load" screen, and no export request was ever made. Fixed by wrapping the menu in `DropdownMenuGroup`
  2. The menu items used `onSelect`, but base-ui `Menu.Item` activates via `onClick` (it has no `onSelect`; React's `onSelect` is the text-selection event and never fires on click). So even after the crash fix the handler never ran. Switched all three items to `onClick`
- Verified end-to-end: dropdown opens, `GET /export?format=docx` fires, the `.docx` downloads, no global-error
- The earlier v2.15.0–v2.15.4 work (blob download, IPv4 proxy, SW kill switch, chunk preservation, self-heal) were real robustness improvements but were not the cause of this failure

### v2.15.4 — 2026-06-25
**Fix: ChunkLoadError after deploy (real robustness fix; NOT the export root cause — see v2.15.5)**
- Confirmed via Nginx logs: browsers held a cached app shell referencing lazy chunk filenames (`14b7j-rsytbbz.js` etc.) that each rebuild deleted from `.next/static`. Opening/using the Second Brain export modal triggered a dynamic import of a now-404 chunk → ChunkLoadError, rendered as "This page couldn't load". No export request ever reached the server because the code chunk itself never loaded — which is why every prior server-side fix was invisible to the client
- `infrastructure/scripts/deploy.sh` now archives the previous build's `.next/static` assets and folds them back into each fresh build (`.next-static-archive`, 14-day retention). Hashed filenames make the merge collision-safe, so old chunks keep resolving and stale shells no longer 404
- `ServiceWorkerRegister` self-heals: on a ChunkLoadError it forces a single sessionStorage-guarded `location.reload()` to pull a fresh shell instead of dead-ending
- Note: a shell cached *before* this deploy still points at already-deleted chunks; affected clients must clear site data once (DevTools → Application → Clear site data), after which they're permanently protected
- Nginx caching is correct: `/_next/static/` is `immutable` (hashed), HTML documents are `no-cache`

### v2.15.3 — 2026-06-25
**Fix: service-worker kill switch (stale-code root cause)**
- A previously-shipped caching service worker (`apps/web/public/sw.js`) left browsers/PWAs serving old JS bundles. Net effect: code deploys were invisible to the client — the Second Brain export fixes (v2.15.0–v2.15.2) never actually reached the browser, so the export click ran stale code and produced "This page couldn't load" with no request ever reaching the server. The earlier no-op worker purged caches but never unregistered, so the old registration kept controlling the page
- `sw.js` is now a kill switch: purges all caches, calls `registration.unregister()`, and force-reloads every open client via `clients.navigate(client.url)`
- `ServiceWorkerRegister` no longer registers a worker — it unregisters any existing registrations and clears caches on load, preventing a re-register loop
- Nginx serves `/sw.js` directly from `apps/web/public/` with `Cache-Control: no-cache`, so the kill switch propagates on the next navigation

### v2.15.2 — 2026-06-25
**Fix: Next.js proxy ECONNREFUSED (the real Second Brain export bug)**
- Root cause of the export "This page couldn't load" error: the Next.js proxy (`app/api/proxy/[...path]/route.ts`) and login route fetched the harness at `http://localhost:8000`. Node 18+ resolves `localhost` to both `::1` (IPv6) and `127.0.0.1` (IPv4); the harness binds `0.0.0.0:8000` (IPv4 only), so the IPv6 attempt is refused and undici surfaces an `AggregateError: ECONNREFUSED`. The standalone build then can't render its own `/500.html`, so the browser shows a blank "This page couldn't load"
- Both routes now force IPv4: `(process.env.HARNESS_URL ?? "http://127.0.0.1:8000").replace("//localhost", "//127.0.0.1")`
- Export handler rewritten to download DOCX/PDF as a blob (never navigates the page) and surface the real harness error in a red strip on failure instead of failing silently
- Verified: export ran 4/4 clean through the full public stack (Nginx → proxy → harness)

### v2.15.1 — 2026-06-25
**Fix: Second Brain export download in Safari/PWA**
- `window.location.href` was navigating the PWA app shell to the binary export URL, causing Safari/WKWebView to show "This page couldn't load" instead of triggering a download
- Changed to hidden `<a download>` click: synchronous (no await, gesture context preserved), `download` attribute prevents navigation, httpOnly auth cookie sent automatically (same origin)

### v2.15.0 — 2026-06-25
**Fix: email sent-state persistence + Second Brain export**
- `POST /api/email/mark-sent` SQL now casts `tool_results::jsonb` explicitly — `tool_results` column is `JSON` type so PostgreSQL was silently rejecting the `jsonb_array_elements` call; the `.catch(() => {})` on the frontend ate the error, leaving every card in the unsent state on reload
- Sent card replaced from a dismissible pill to a full receipt card — shows To, CC (if set), Subject, and an expandable body so you can review what was sent; matches the draft card layout with moss "Sent" header
- Second Brain items can now be exported from the item detail modal: **DOCX** (download), **PDF** (download), **Google Doc** (opens in new tab via Google Drive API); `POST /api/second-brain/items/{id}/export?format=docx|pdf|gdoc`; markdown is faithfully converted to native doc structure (headings, lists, inline bold/italic, personal note as italic block)

### v2.14.1 — 2026-06-23
**Fix: email draft revision, inline editing, sent-state persistence**
- `send_email` tool description now explicitly instructs the model to call the tool again for revisions instead of outputting prose — fixes both the missing card on revision and hallucination on the second turn
- `send_email` handler generates a server-side `draft_id` UUID and echoes To/Subject in the tool result so the model retains full draft context across turns
- `EmailDraftCard` now has a pencil-toggle edit mode — all fields (To, CC, Subject, Body) become inline inputs/textarea; Send uses the edited values
- `POST /api/email/mark-sent` endpoint persists `sent: true` onto the matching `tool_results` entry in the DB; called automatically after a successful send from the card
- On conversation reload, `InlineMessageCards` passes `messageId` and reads the `sent` flag from stored `tool_results` so the card renders in the sent state instead of reverting to the unsent draft

### v2.14.0 — 2026-06-23
**Feat: Feed Reader**
- Three-panel feed reader at `/feed` — category sidebar, compact article list, reading pane
- Supports RSS/Atom, YouTube channels (XML feed), Reddit (/r/subreddit.rss), Google News, any website (auto-discovers `<link rel="alternate">` feed)
- Four media types: `article` (prose), `video` (YouTube iframe embed), `podcast` (HTML5 audio player), `link` (summary + open link)
- "Save to Brain" saves feed item directly to Second Brain (sets `knowledge_item_id`); green checkmark once saved
- "Chat with TARS" creates a pre-seeded Conversation + Message with article content, navigates to `/chat/{id}`
- Feed discovery via Feedly search API (`GET /api/feed/discover?q=…`; requires `FEEDLY_API_KEY`)
- Preset category packs for zero-config onboarding (ai_tech, digital_marketing, cycling, business, philippines, design)
- New DB tables: `feed_sources` (subscribed feeds) + `feed_items` (rolling 90-day window, starred/saved kept indefinitely)
- Migration: `p3q4r5s6t7u8`; scheduler job `feed_sync` runs hourly
- New env var: `FEEDLY_API_KEY` (free from developer.feedly.com — Discover tab hidden if unset)
- `feedparser==6.0.11` added to requirements.txt

### v2.13.4 — 2026-06-22
**Feat: rolling context compaction**
- When a conversation hits 20 uncompacted messages, TARS summarises the oldest messages (all but the last 10) using the configured Tier 1 model and stores the result in `conversation.context_snapshot.rolling_summary`. `summary_cutoff_at` advances to the oldest kept message.
- On next load: only messages after the cutoff are fetched (hard limit 30), and the summary is injected as a synthetic exchange at the top of history. Context window stays flat regardless of conversation length.
- Compaction runs lazily in the background after each assistant reply — zero added latency.
- Migration: `o2p3q4r5s6t7` adds `summary_cutoff_at` to `conversations`. Harness-only.

### v2.13.3 — 2026-06-22
**Perf: slash system prompt 60% + token analytics + real token tracking**
- Tier 2 system prompt cut from 18k → ~5k tokens (SYSTEM_STATE.md restricted to Tier 3 only; capabilities block rewritten concisely). Tier 2 calls ~60% cheaper.
- Real token tracking: `input_tokens` column on `messages` table (migration n1o2p3q4r5s6); `model_client.py` emits `input_tokens`/`output_tokens` in done events; `chat.py` + `prompt_cron.py` now save real values instead of hardcoded 0.
- `get_token_report` agent tool: TARS can answer "why is my Z.ai usage high" with a full breakdown — totals, by-model, cron costs, flagged anomalies, recommendations.
- `GET /api/analytics/tokens?period=today|7d|30d` — aggregates hourly, by-model, top conversations, cron job costs, flags (hourly spikes, large conversations, expensive cron runs), recommended actions.
- Settings → Token Usage section: period selector, totals, model breakdown with proportional bar, cron costs, top conversations, flags with severity, recommendations.
- Meeting transcript summarization moved from Tier 3 → Tier 2 (no frontier model needed for summarization).
- Harness + web + DB migration.

### v2.13.2 — 2026-06-22
**Rename: Tasks → Projects, Reminders → To-Dos**
- Sidebar nav: "Tasks" label → "Projects", "Reminders" label → "To-Dos"
- Tasks page header: "Tasks" → "Projects"
- Reminders page header: "Reminders" → "To-Dos", Bell icon → ClipboardList, empty state updated
- Agent tools: `create_reminder` description updated to reference "To-Do list"; `create_task` guidance references "Projects board"
- Context assembler tool guidance updated to match new names
- Command palette: "Go to Tasks" → "Go to Projects", "Go to Reminders" → "Go to To-Dos"
- Web + harness, no schema change

### v2.13.1 — 2026-06-22
**Fix: verbal email approval for Clawsses**
- New `confirm_send_email` tool — executes Gmail send immediately, ONLY when Mike verbally approves a draft shown earlier in the conversation ('go ahead', 'send it', 'yes send')
- `send_email` unchanged — still surfaces draft card; description updated to instruct model to follow up with `confirm_send_email` on verbal approval
- Enables glasses HUD (Clawsses) verbal email-send flow without chip interaction
- Harness-only, no schema change

### v2.13.0 — 2026-06-22
**Feat: Reminders — quick personal checklist**
- New `Reminder` model (`reminders` table) — `text`, `done`, `due_at`; separate from Tasks (no pipeline, priority, or connector tracking)
- CRUD API: `GET/POST /api/reminders/`, `PATCH /api/reminders/{id}`, `DELETE /api/reminders/{id}`
- Two new agent tools: `create_reminder` (add instantly, use for "remind me to…" / "don't forget") and `list_reminders` (returns pending reminders)
- Tool guidance in context assembler: create_reminder vs create_task distinction
- `/reminders` page — inline quick-add (Enter to submit), grouped sections (Overdue / Today / Tomorrow / Upcoming / Someday), collapsible Done section, inline double-click editing, optimistic UI
- Sidebar nav: Reminders added between Tasks and Meetings with Bell icon
- Command palette: "Go to Reminders" shortcut
- Migration: `m0n1o2p3q4r5`
- Harness + web; migration required

### v2.12.2 — 2026-06-22
**Fix: verbal approval path for write actions (Clawsses support)**
- Dual-tool model: `propose_*` = proactive chip, `create_*/update_*/delete_*` = direct execution when explicitly asked
- `create_task`: restored; executes immediately when Mike asks or verbally approves. `propose_task` kept for proactive detection only.
- `create_calendar_event`: restored; same semantics. `propose_calendar_event` kept for proactive.
- `update_calendar_event` / `delete_calendar_event`: removed from `_SUGGESTION_TOOLS` → execute directly when Mike explicitly asks or says "go ahead"
- Tool descriptions tightened on all six tools with explicit trigger guidance for the model
- Enables Clawsses (Rokid AR glasses HUD) verbal-approval flow — no chip click required
- Harness-only, no schema change

### v2.12.1 — 2026-06-22
**Fix: approval gates for all write actions — tasks, calendar, email**
- `create_task` removed from autonomous tools; all task creation now flows through `propose_task` chip (user clicks "Add Task" to confirm)
- `create_calendar_event` removed; all event creation flows through `propose_calendar_event` chip ("Add to Calendar" to confirm)
- `update_calendar_event` now emits `calendar_update_suggest` chip — shows what will change, user clicks "Confirm" to apply via new `PATCH /api/calendar/events/{id}` endpoint
- `delete_calendar_event` now emits `calendar_delete_suggest` chip — user clicks "Delete" in red to confirm via new `DELETE /api/calendar/events/{id}` endpoint
- `send_email` was already gated (unchanged)
- Tool descriptions updated across both Anthropic and Z.ai/GLM streaming paths to reinforce approval-first semantics
- New `CalendarUpdateChip` and `CalendarDeleteChip` components in chat UI; replays correctly on conversation reload via `InlineMessageCards`

### v2.12.0 — 2026-06-19
**Feature: 8 chat stream enrichment features**
- **Live tool progress indicator** — animated spinner row appears above the streaming response while a tool is running; fades out 1.8s after completion. Ephemeral (not persisted). `ToolProgressLine.tsx` + `_emit_progress()` in harness.
- **Follow-up suggestion chips** — 3 contextual next-question chips per assistant response, generated by Haiku after streaming completes (~400ms). Persist in `Message.follow_ups[]` and replay on reload. `FollowUpChips.tsx`.
- **Context source citations** — disclosure toggle below assistant messages: "Context · N memories, M knowledge items". Expands to pill list linking back to `/memory` or `/second-brain`. Populates from the Mnemon + Second Brain injections per turn. Persist in `Message.context_sources[]`. `ContextSources.tsx`.
- **Email thread card** — structured Gmail card (avatar initials, sender, subject, date, snippet, Reply/Open actions). Emitted by `read_email` tool. `EmailThreadCard.tsx`.
- **YouTube embed card** — thumbnail + play overlay → inline iframe on click. Auto-detected from YouTube/youtu.be URLs in `UrlPreviewCard.tsx`.
- **GitHub repo card** — live-fetched stars/forks/language/description from `api.github.com`. Auto-detected from github.com URLs in `UrlPreviewCard.tsx`.
- **Strava activity card** — cycling/running metrics (distance, duration, elevation, HR, power, speed) with sport color coding, PR badge, Strava link. Emitted by `get_strava_activities` / `get_strava_activity` tools. `StravaActivityCard.tsx`.
- **Meeting card** — compact Fireflies meeting card (attendee avatar stack, summary excerpt, action item count, View transcript link). Emitted by `read_meeting` tool. `MeetingCard.tsx`.
- All 5 new card types persist in `Message.tool_results` and replay on load via `InlineMessageCards`. Harness `done` event now carries `follow_ups[]` and `context_sources[]`. Web + harness, no DB migration.

### v2.11.3 — 2026-06-19
**Feature: multi-account Google support — personal Gmail, Calendar, and Drive**
- Three new connector slots: `Gmail (Personal)`, `Google Calendar (Personal)`, `Google Workspace (Personal)`. Each appears as its own card in the Connectors page.
- OAuth reuses existing Google credentials — same client IDs, same redirect URIs. A `state=personal` param in the OAuth URL distinguishes personal from work at the callback; no Google Cloud Console changes needed.
- Context assembler fans out to both work and personal Gmail/Calendar accounts, labeling each section `[GMAIL — WORK INBOX]` / `[GMAIL — PERSONAL INBOX]` etc. in the system prompt.
- `read_email` chat tool searches both accounts and merges results for search queries; resolves thread IDs against work first, then personal.
- Calendar UI (`/calendar`) includes events from both Google Calendar accounts, with `gcal_personal` event type (same moss color, distinct "Personal Calendar" label).
- No DB migration required — new connector rows use existing `Connector` model with distinct names.

### v2.11.2 — 2026-06-18
**Fix: contact mentions show email to disambiguate duplicates**
- The `@`-mention dropdown now leads a contact's subtitle with its email (then org/title), e.g. `j.shorrock@aalaw.com · AA Law` — so duplicate-named contacts (a common Google Contacts situation) are distinguishable at selection time. `search_mentions` contact result in `api/routes/links.py`. Applies to every mention surface (chat, Second Brain, tasks, mnemon) since they share the dropdown. Harness-only, no schema change. Verified in-browser with two same-named test contacts.

### v2.11.1 — 2026-06-18
**Feature: chat mentions render Slack-style bold**
- Chat message bubbles now render `[[id|type|label]]` mentions as bold **@Label** (`preprocessContent` in `components/chat/MessageContent.tsx` rewrites the wire markers to `**@label**` before ReactMarkdown).
- To support this on reload, the harness now persists the WIRE form of user messages again (`db_content = content` in `api/routes/chat.py`) instead of the stripped form — the model still receives the mention-stripped text via `full_text`. The optimistic bubble also uses the wire content so the just-sent message bolds immediately.
- Verified in-browser: sent a message with a mention → bubble showed bold `@Label`, no raw markers; confirmed wire markers persisted in the stored message. Web + harness, no schema change.

### v2.11.0 — 2026-06-18
**Feature: universal @-mentions across the app + Second Brain persistence fix**
- **Second Brain bug fixed (root cause):** `@tiptap/extension-mention`'s default `parseHTML` matches `span[data-type="mention"]`, but our chips carry the entity type in `data-type` (contact/knowledge_item/task) and mark themselves with `data-mention`. On reload the chip was never recognized as a mention node, degraded to text, and the next save dropped the id — silently breaking the link. Added `parseHTML() → [{ tag: 'span[data-mention]' }]` plus explicit `data-id`/`data-label` attribute parsers (`components/second-brain/extensions/MentionExtension.ts`). Verified end-to-end: chip survives close/reopen with id intact.
- **Second Brain trigger switched `[[` → `@`** (empty query shows recent items, matching chat).
- **Reusable mention layer for plain textareas:** new `lib/mentions.ts` (`WIRE_RE`, `stripToLabels`, `parseWireToDisplay`, `toWire`, `currentMentions`, `syncMentionLinks`) + `components/ui/MentionTextarea.tsx` — a drop-in `<textarea>` that shows friendly `@Label` tokens, persists the lossless `[[id|type|label]]` wire format, renders a fixed-position dropdown, and emits the mention list for link sync.
- **Wired into Tasks** (description; creates `task → entity` links on save, card preview shows stripped labels), **Mnemon** (add-memory content; stores clean label text for embeddings + creates `memory → entity` links), and **Calendar** (new event Description field; clean text sent to Google). Chat already had `@` mentions (v2.10.8/9). Meetings left read-only by request.
- **Backend:** `memory` added to `links.VALID_TYPES` (bulk-create silently skips unknown source types) + a Memory title resolver in `_resolve_title`. Without this, memory links would have been dropped.
- Verified in-browser against a local harness. Web + harness, no DB migration (links table already exists).

### v2.10.9 — 2026-06-18
**Fix: chat mentions show a friendly `@Label` instead of the raw `[[id|type|label]]` marker**
- Selecting a mention now inserts a display token `@Label` into the textarea (a plain `<textarea>` can't render styled chips). A per-composer `mentionMapRef` (label → {id,type}) remembers the selection.
- At send time, `handleSend` expands `@Label` → `[[id|type|label]]` (longest label first, literal split/join — no regex escaping) for the harness so `_resolve_mentions` still injects entity context; the optimistic user bubble shows the plain label (no `@`, no markers).
- Harness now persists the **mention-stripped** text (`stripped_content`, labels only) instead of the raw markers, so reloaded conversations read cleanly (`api/routes/chat.py` `db_content`).
- Applied to both the main `chat/page.tsx` composer and the `message-input.tsx` sibling. Verified end-to-end in-browser against a local harness (textarea token / wire payload / clean bubble all confirmed). Web + harness, no schema change.

### v2.10.8 — 2026-06-18
**Change: mention trigger is now `@` instead of `[[`**
- Detection regex changed to `/(^|\s)@([^\s@]*)$/` (matches `@` only at start-of-input or after whitespace, so email addresses like `mike@growth-rocket.com` don't false-trigger). Updated in all three composers: the main `app/(app)/chat/page.tsx` inline composer, `components/chat/message-input.tsx` (the `/chat/[id]` sub-route), and the `useMentionAutocomplete` hook.
- The stored wire format is unchanged — selecting a mention still inserts `[[id|type|label]]`, which the harness `_resolve_mentions` parses as before. Only the input trigger char changed; no harness change.
- Verified in-browser before deploy. Web-only, no schema change.

### v2.10.7 — 2026-06-18
**Fix: [[ mention dropdown now actually appears in the main chat composer**
- Root cause: the `[[` autocomplete had been wired into `components/chat/message-input.tsx`, but that component is only used by the `/chat/[id]` sub-route. The primary chat experience (`/chat` landing page) uses its own inline composer inside the 111KB `app/(app)/chat/page.tsx` monolith, which had no mention handling — so typing `[[` did nothing.
- Inlined mention detection directly into the `/chat/page.tsx` composer: `detectMention()` runs synchronously in the textarea `onChange` (regex `/\[\[([^\]\n]*)$/` against text before cursor), debounced fetch to `/api/proxy/links/search`, `selectMention()` inserts `[[id|type|label]]`, arrow/enter/escape keyboard nav in `onKeyDown`.
- Dropdown renders via `MentionDropdown` with `position: fixed` (anchored to the textarea's `getBoundingClientRect`) to escape the chat thread's `overflow-x-hidden` clipping. Verified working in-browser before deploy.
- Web-only, no schema change.

### v2.10.6 — 2026-06-18
**Feat: Drive search in Google Workspace connector**
- `GoogleWorkspaceClient.search_files(query, limit, file_type)` queries Drive by name + `fullText` content (optional type filter: doc/sheet/slides/pdf/folder), newest-first, returning name/type/url/file_id/modified (`connectors/google_drive.py`).
- New `search_drive` chat tool so TARS can find files by description ("find the AA Law tracker") instead of needing a pasted link; results feed `read_google_doc` for follow-up. Registered + dispatched in `chat.py`. No schema change.

### v2.10.5 — 2026-06-18
**Fix: [[ mention trigger in chat now works — shows results on empty query**
- API had `min_length=1` on `q` → 422 for empty string; changed to `default=""`. Empty query now returns 5 recent contacts + 5 recent knowledge items + 5 recent open tasks ordered by updated_at/saved_at.
- Frontend hook dropped `query.length < 1` early-return so `[[` immediately fetches and shows the dropdown without needing extra characters typed.
- Harness + web, no schema change.

### v2.10.4 — 2026-06-18
**Fix: connector sync-status accuracy**
- Connected connectors no longer mislabeled "Not yet synced". Card + detail panel now read "Connected" when connected without a sync timestamp, and "Synced X ago" once a real sync stamps `last_synced_at` (`connectors/page.tsx`). Read-on-demand connectors (Gmail, Calendar, Workspace, Tesla, Places) legitimately never sync, so "Connected" is the accurate baseline.
- Backend: `last_synced_at` was never being written for most connectors — `_sync_fireflies` didn't stamp the connector row at all, `_sync_google_people` stamped Contact rows (not the connector), and `_sync_strava` only stamped on the happy path. Now stamped uniformly in the generic `_run_job` runner via `_JOB_CONNECTOR_NAMES` map after any successful sync (only for `connected` rows). `jobs/scheduler.py`. No schema change.

### v2.10.3 — 2026-06-18
**Fix: mention chips survive save in Second Brain**
- `tiptap-markdown`'s `addStorage` discovery is unreliable through `extend().configure()` chains — with `html: false` it falls back to writing `[mention]` for unrecognised nodes, stripping the `[[id|type|label]]` round-trip format on every edit.
- `TiptapEditor.onUpdate` now walks the prosemirror doc for mention nodes in order, then replaces any `[mention]` fallback tokens with the correct `[[id|type|label]]` format. No-op if `addStorage.markdown.serialize` is already firing correctly.
- Web-only, no schema change.

### v2.10.2 — 2026-06-18
**Polish: Google Workspace connector icon**
- Added `GoogleDriveLogo` (official tri-color Drive triangle SVG) in `connectors/page.tsx` and mapped `id === "google_workspace"` to it, replacing the generic initials fallback. Web-only, no schema change.

### v2.10.1 — 2026-06-18
**Feat: universal [[mention]] autocomplete in chat composer**
- Type `[[` anywhere in the chat textarea to trigger mention autocomplete (contacts, knowledge items, tasks). `useMentionAutocomplete` hook detects the trigger, debounce-fetches `/api/proxy/links/search`, handles ↑↓ Enter Escape keyboard nav, and inserts `[[id|type|label]]` at the cursor.
- `MentionDropdown` component renders grouped suggestions (CONTACTS / NOTE / TASK) with avatar circles, name, subtitle, and type badge — same visual design as the Tiptap MentionList.
- Harness: `_resolve_mentions` parses `[[id|type|label]]` markers from the user message, fetches entity context from DB (contact info, knowledge item content, task details), prepends snippets to `doc_snippets` (so the model gets full entity context), and strips markers from the text sent to the model.
- Message display: user messages show `[[id|type|label]]` markers as `` `[[label]]` `` (code-styled) so they read cleanly in the thread.
- No schema change.

### v2.10.0 — 2026-06-18
**Feat: Google Workspace connector — read & write Docs/Sheets/Slides by link**
- New OAuth connector `google_workspace` (scopes: drive, documents, spreadsheets, presentations). Reuses the existing generic Google OAuth authorize/callback flow — registered in `_CONNECTOR_NAMES`/`_GOOGLE_CONNECTORS` and `connectors/registry.py`.
- `connectors/google_drive.py`: `GoogleWorkspaceClient` — parses a file ID from any docs.google.com / drive.google.com URL; `fetch_as_file` exports native Google files to Office formats (Doc→docx, Sheet→xlsx, Slides→pptx) so the **existing** `ingest/parsers` handle them with zero new parser code; non-native files downloaded via `files.get_media`. Write surface: `append_to_doc`, `create_doc`, `update_sheet`, `append_sheet_rows`, `read_sheet`.
- Second Brain: `second_brain.ingest_url` now detects Google links and routes them through the connector (export → parse → chunk → embed) instead of trafilatura, which only ever saw a login wall.
- Chat tools: `read_google_doc` (live read, incl. Sheets A1 range), `update_google_doc` (append), `update_google_sheet` (update/append rows), `create_google_doc` (new doc). Dispatched in `chat.py::_tool_executor`.
- Env: `GOOGLE_WORKSPACE_CLIENT_ID` / `GOOGLE_WORKSPACE_CLIENT_SECRET`. Requires Drive + Docs + Sheets + Slides APIs enabled on the Google Cloud project. No DB migration.

### v2.9.5 — 2026-06-18
**Feat: mention round-trip — chips survive save and reload**
- Storage format: `[[id|type|label]]` in `clean_content` (e.g. `[[abc123|contact|John Doe]]`).
- `MentionExtension.addStorage().markdown.serialize` — writes `[[id|type|label]]` so tiptap-markdown outputs the round-trippable format.
- `MentionExtension.addStorage().markdown.parse.setup` — adds a markdown-it inline rule (before 'escape') that converts `[[id|type|label]]` back to `<span data-mention data-id data-type data-label>` which tiptap DOM-parses into a mention node (via `parseHTML`).
- `renderText` updated to emit `[[id|type|label]]` as plain-text fallback; `renderHTML` now writes `data-label` so the label attr round-trips.
- Harness PATCH: strips `[[id|type|label]]` → label text before embedding and chunking so mention markers don't pollute semantic search.

### v2.9.4 — 2026-06-18
**Fix: Second Brain auto-save — three save bugs fixed**
- **Stale closure**: `saveDocument` was a plain `async function` re-created each render. The 1.5s debounce could fire a version with stale `editTags`/`editDomain`/`editProps`. Fixed: `saveDocument` is now a stable `useCallback([])` that reads all current values from a `saveValuesRef` updated after every render.
- **Changes lost on navigation**: clicking a backlink or mention within 1.5s of typing cancelled the pending auto-save (the `docMarkdown` reset to `""` triggered the `useEffect` cleanup which cleared the timeout). Fixed: a flush `useEffect` fires `saveDocument()` immediately when `itemId` changes, guarded by `hasUnsavedChanges` ref. A `currentItemIdRef` guard prevents stale `setItem` calls if the PATCH response arrives after navigation.
- **Spurious normalization save on open**: `tiptap-markdown` serializes content slightly differently from the stored string, triggering an auto-save on every item open. Fixed: `setContent(..., false)` in TiptapEditor suppresses `onUpdate` during initial content load, so `docMarkdown` is set directly from the DB value and matches `lastSavedContent`.

### v2.9.3 — 2026-06-17
**Fix: bidirectional linking fully wired**
- Mention chip clicks now do something: contact → ContactPopup, knowledge_item → navigate to that item's modal, task → /tasks?id=.
- Backlinks panel shows the source item's title (who's referencing this item) and each row is clickable — knowledge_item rows navigate to that item, contact rows go to /contacts?id=.
- Links API `_enrich` now resolves both `source_title` and `target_title`.
- `ContactPopupContext.openContact` accepts `HTMLElement | DOMRect` (TiptapEditor passes DOMRect).

### v2.9.2 — 2026-06-17
**Fix: Contacts list truncation + missing phone numbers**
- Frontend now requests up to 5000 contacts (was hardcoded to 100); DB has 3055.
- Phone numbers displayed in contact header (below email) and in a new "Contact Info" section in the Overview tab showing all emails and phones from Google sync with type labels.

### v2.9.1 — 2026-06-17
**Fix: Second Brain mobile header layout**
- View mode toggle and title no longer crush each other on mobile (375px).
- On mobile: title on its own row (truncated), 6 view icons in a full-width evenly-spaced row below.
- On desktop (sm+): unchanged single-row layout (title + view toggle + Capture button).
- Page-level Capture button hidden on mobile — topbar `+` already handles it.

### v2.9.0 — 2026-06-17
**Feature: Second Brain Notion-like layer — universal linking, properties, views, Contacts**
- **Universal linking layer.** New `links` table (polymorphic source/target across task/meeting/knowledge_item/artifact/contact). `GET/POST/DELETE /api/links`, `POST /api/links/bulk`, `GET /api/links/search` (mention autocomplete). Bidirectional backlinks panel in ItemDetailModal.
- **Item properties.** `properties JSONB` column on `knowledge_items` (status/type/priority + custom key-value). `PATCH /second-brain/items/{id}` merges properties. `POST /second-brain/items/{id}/properties/auto` uses Haiku to auto-infer status/type/priority from content.
- **[[mention]] syntax.** Tiptap MentionExtension with `[[` trigger and tippy.js dropdown. Mention chips rendered as `.tars-mention-chip` inline chips. Debounced bulk link sync on save.
- **Tiptap extensions.** CalloutNode (note/warning/action/insight with left border + emoji) and ToggleNode (collapsible with summary attribute + NodeViewRenderer).
- **Database views.** 6 view modes in Second Brain: grid, list, kanban (native HTML5 drag-drop + status change), gallery (domain color header), table (sortable columns), timeline (grouped by month). View mode persisted to localStorage.
- **Contacts module.** New `/contacts` page (two-panel, search, detail). `ContactDetailPanel` with Overview/Meetings/Tasks/Knowledge tabs + auto-save notes. `ContactPopup` (floating, portal). `ContactPopupContext` (universal — open from anywhere). Contacts added to sidebar nav.
- **Contact context endpoint.** `GET /contacts/{id}/context` returns link count, recent meetings (attendee text-search), linked tasks, linked knowledge.
- Migrations: `k8l9m0n1o2p3` (links table), `l9m0n1o2p3q4` (knowledge_item.properties).
- Packages: `@tiptap/extension-mention@^2.27.2`, `@tiptap/suggestion@^2.27.2`.

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

> Agent Jobs (the executor + UI from this session) was retired 2026-09 — see the "Agent Jobs
> (retired)" note under Active Components above. Artifacts is unaffected and still live.

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
