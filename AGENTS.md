# TARS Agent Operations Manual

**Read this before you touch any file.** `CLAUDE.md` at the repo root is the full product/architecture
spec (stack, data model, connectors, component specs, design language) — read that too. This file is
about *how to work in this repo*: git discipline, where code actually lives, and verification steps.

This file has two parts:
1. **Live — Interactive Sessions** — the real, current workflow for anyone (Claude Code, another
   coding agent, or Mike) working in this repo today.
2. **Retired — Autonomous Agent Jobs** — historical documentation of an in-app feature that no
   longer exists. Kept for archival context because a few orphaned files still reference it.

---

# PART 1 — Live: Interactive Sessions

## 1. The #1 Rule — Local Branch First, Main Is Production

**No commits land directly on `main`. Ever.** This is the standing rule as of September 2026 —
it supersedes any older doc text or memory that says otherwise.

```
1. Start every change on a branch:
   git checkout main && git pull origin main
   git checkout -b fix/short-description        # or feat/, chore/, refactor/, docs/

2. Do the work locally. Commit on the branch as you go:
   git add <specific files>                     # never git add -A / git add .
   git commit -m "type: description"

3. Verify before merging (see §5 — Mandatory Verification)

4. Merge into main only when the change is ready to ship:
   git checkout main && git pull origin main
   git merge --no-ff fix/short-description
   git push origin main
   (or open a PR and merge via GitHub — either is fine; the gate is "not a direct commit to main")

5. Deploy (see §6). Merging to main does not auto-deploy by itself — deploy is a
   separate, explicit step that should follow the merge promptly.
```

**Never push a work-in-progress branch's commits straight onto `main`.** If you're mid-task and
the session ends, the branch stays as a branch — do not merge unfinished work to close it out.

**Ask before merging/deploying** if the change is large, risky, touches auth/payments/data
deletion, or you're not confident it's finished. Small, low-risk fixes (typos, copy, obvious bugs)
can go through the full branch→merge→deploy cycle without pausing for approval — the point of the
branch is a clean rollback path, not a permission gate for every commit.

## 2. Codebase Map — Where Things Actually Live

The repo is a Turborepo monorepo at `/opt/tars` on the server, `~/Documents/TARS` locally.

```
apps/web/                  Next.js 15 PWA (frontend)
  app/(app)/               Application routes — these are the LIVE PAGES
    chat/page.tsx          Main chat UI (inline conversation list + thread — most chat
                            sub-UI is inline here, NOT in components/chat/)
    tasks/page.tsx          Projects (kanban)
    reminders/page.tsx      To-Dos (quick checklist)
    meetings/page.tsx
    calendar/page.tsx
    feed/page.tsx
    second-brain/page.tsx
    artifacts/page.tsx
    connectors/page.tsx
    cron/page.tsx
    contacts/page.tsx
    memory/page.tsx         Mnemon browser
    settings/page.tsx
  app/(auth)/login/        Login page
  app/api/                 Next.js API routes (auth, proxy to harness)
  components/              SHARED components — verify they're imported before editing!
    second-brain/
    shell/                 Sidebar, command palette
    ui/                    shadcn components
  hooks/
    useNotifications.ts    Subscribes to /api/notifications/stream WebSocket.
                            Chat page uses this to receive new_message events and
                            show unread dots without polling. DO NOT add polling
                            loops — use this hook instead.
    useTtsPlayback.ts       Kokoro TTS synthesis queue + audio playback
    useVoiceInput.ts        Mic recording, VAD silence detection, transcription
  lib/
    api-client.ts          apiGet / apiPost / apiDelete helpers
    websocket.ts           TarsWebSocket class with auto-reconnect + visibilitychange

apps/harness/              FastAPI backend
  main.py                  App entry + lifespan startup
  api/routes/              ALL HTTP endpoints
    chat.py                Chat conversations + messages (mounted at /api/chat)
    notifications.py       WebSocket /api/notifications/stream — user-level real-time events
    agent_jobs.py           ORPHANED — see Part 2. Not mounted in main.py. Do not wire back up
                            without reading Part 2 first (imports a package that no longer exists).
    tasks.py / reminders.py / meetings.py / artifacts.py / feed.py / contacts.py ...
  core/                    Routing, context assembler, model client, notifications broadcaster
    notifications.py       In-memory pub/sub broadcaster keyed by user_id (moved here from a
                            since-removed agents/ package — import from core.notifications, not
                            agents.notifications)
    router.py              Tier classification
    model_client.py         Anthropic + Z.ai unified, per-tier backup/fallback
  memory/                  Mnemon + Second Brain
  connectors/              Gmail, Calendar, Fireflies, Google Workspace, Strava, etc.
  jobs/                    scheduler.py (cron loops), prompt_cron.py, meeting_processor.py
  ingest/                  Document parsers + chunking pipeline
  db/
    models.py              SQLAlchemy models
    migrations/            Alembic migrations
```

## 3. Find Where Code Is Actually Used Before Editing

**Most agent failures come from editing a file that looks right but is never imported.**

A common pattern: user asks "add Load More to chat sidebar" → agent finds
`components/chat/conversation-list.tsx` → implements there → commits → nothing changes, because
the actual chat sidebar is inline in `app/(app)/chat/page.tsx`.

Before writing a line of code:

```bash
# Verify the component you're about to edit is imported somewhere
grep -rn "ConversationList\|conversation-list" apps/web/app apps/web/components \
  --include="*.tsx" --include="*.ts" | grep -v ".next" | grep "import\|from"

# Find where the FEATURE actually renders
grep -rn "conversations.map\|conversation.title\|setActiveChatId" apps/web/app --include="*.tsx"
```

If the file you were about to edit isn't imported anywhere, stop and look elsewhere. Most things
are inline in the page files, not in the components subfolders their names suggest.

## 4. API Shape Changes — Update All Callers Or Don't Change

When you change a FastAPI endpoint's response shape, find every caller in the same commit:

```bash
grep -rn "/chat/conversations\|/api/chat/conversations" apps/web --include="*.ts" --include="*.tsx"
grep -rn "ConversationListOut\|Conversation\b" apps/web --include="*.ts" --include="*.tsx"
```

If `GET /chat/conversations` changes from `List[Conversation]` to
`{conversations, total, has_more}`, every frontend `.map()` on the raw response breaks silently.
Update all of them before merging.

## 5. Mandatory Verification Before Merging To Main

```bash
cd apps/web
npx tsc --noEmit 2>&1 | head -40
```

Fix any TypeScript errors — do not merge with a broken build.

For backend changes, verify imports parse:
```bash
cd apps/harness && source .venv/bin/activate
python3 -c "from main import app; print('OK')"
```

## 6. Deployment (After Merging To Main)

The production server has fail2ban — **never run SSH retry loops.** One failed attempt = stop,
report to Mike, wait for instruction.

```bash
# Pull latest
ssh tars "cd /opt/tars && git pull origin main"

# Run migrations (if the change touched db/models.py or added a migration)
ssh tars "cd /opt/tars/apps/harness && source .venv/bin/activate && python3 -m alembic upgrade head"

# Restart harness (backend changes)
ssh tars "pm2 restart tars-harness"

# Build and deploy web (frontend changes)
ssh tars "cd /opt/tars/apps/web && npm run build && cp -r .next/static .next/standalone/apps/web/.next/ && mkdir -p .next/standalone/apps/web/public && cp -r public/* .next/standalone/apps/web/public/ && pm2 restart tars-web"
```

`ssh tars` is an alias in `~/.ssh/config` — never use the raw IP directly.

Formal tagged releases (`git tag vX.Y.Z && git push origin vX.Y.Z`) trigger the GitHub Actions
deploy workflows (`deploy-web.yml` / `deploy-harness.yml`) and are reserved for when Mike
explicitly says "release" — see `CLAUDE.md` §12 for that process. Day-to-day changes deploy via
the manual SSH commands above, immediately after merging to `main`.

## 7. Versioning & Docs — Update On Every Production Change

Per `CLAUDE.md` §0: every change that reaches production updates **both** `CLAUDE.md` (relevant
section) and `SYSTEM_STATE.md` (version table + version history) in the same commit, even for
small fixes. Bump the patch version. If you skip this, TARS's own self-knowledge drifts from
reality and it will misreport its own capabilities to Mike.

If you remove a feature, **remove its spec from both docs** — don't leave a dead spec that a
future agent tries to rebuild.

## 8. Frontend Stack Specifics

- Next.js 15 App Router (not pages router). `(app)` and `(auth)` are route groups.
- Most pages are client components (`"use client"`) — they use state + WebSocket.
- Styling: Tailwind + CSS variables (`var(--c-ink)`, `var(--c-moss)`, etc.) — see
  `apps/web/DESIGN.md` before any UI work.
- No emojis in UI text unless explicitly requested.
- shadcn components in `apps/web/components/ui/`; icons from `lucide-react`.

## 9. Backend Stack Specifics

- FastAPI, Python 3.11+, SQLAlchemy 2.0 async with asyncpg, pgvector for embeddings.
- Alembic migrations — generate with `alembic revision --autogenerate -m "msg"`, then ALWAYS
  read the generated file and verify it before committing.
- Pydantic v2. All routes use `Depends(require_auth)` for user_id.
- Streaming responses use SSE via `StreamingResponse`.

## 10. Real-Time Notification Pattern

TARS has a user-level real-time notification channel. Use it whenever you need to push an update
to the UI without the user doing anything.

```python
from core.notifications import publish as notify

await notify(user_id, {
    "type": "new_message",           # or any type you define
    "conversation_id": conv_id,
    "message_id": msg_id,
    "preview": "First 120 chars…",
    "created_at": msg.created_at.isoformat(),
})
```

Any connected browser tab receives the event immediately via the `useNotifications` hook.
**Do NOT add polling loops** — this is the right pattern for pushing UI updates.

## 11. Self-Check Before You Stop

- [ ] Is this change on a branch, not committed directly to `main`?
- [ ] Did I find where the feature is actually rendered (not just a similarly-named file)?
- [ ] Did I update all callers if I changed an API shape?
- [ ] Did I run `npx tsc --noEmit` (and the backend import check, if relevant) with zero errors?
- [ ] Did I update `CLAUDE.md` + `SYSTEM_STATE.md` if this reaches production?
- [ ] If merged and deployed, did I verify the SSH deploy commands ran without retry loops?

---

# PART 2 — Retired: Autonomous Agent Jobs

**This feature was retired (per Mike, September 2026). The workflow below no longer runs.**
It's kept here only because a few orphaned files in the codebase still reference it — if you run
into them, know what they were for instead of trying to rebuild or "fix" them.

Historically, TARS had an in-app "Agent Jobs" feature: a chat tool (`create_agent_job`) spawned a
Claude Code subprocess against the production checkout, which worked fully autonomously —
the harness (not the agent) handled all git operations:

- Harness created a branch (`agent/<job_id>`), staged, committed, and pushed
- Harness opened a PR to `main` and **auto-merged it** once checks passed — no human gate
- Harness pulled on the production server, built, and reloaded PM2 processes
- Harness tagged the next patch version and pushed the tag, which triggered the GitHub Actions
  deploy workflows

The agent's job in that world was narrow: edit files, run read-only git/verification commands,
and stop — never touch `git commit/push/checkout/merge` or `gh pr` directly.

**Known orphaned remnants as of this writing:**
- `apps/harness/api/routes/agent_jobs.py` — not mounted in `main.py`, imports a package
  (`agents.job_manager`, `agents.approval`) that was deleted along with the feature. It will
  raise `ImportError` if anything tries to import it.
- `apps/harness/db/migrations/versions/b44136b7d629_agent_job_evolutionarist_fields.py` — harmless,
  migrations are immutable history.
- `CLAUDE.md` and `SYSTEM_STATE.md` still list "Agent Jobs" as a live, shipped component (nav
  order, component spec §8, session table §14, and the component/connector inventory in
  `SYSTEM_STATE.md`). **This is stale — flagged, not yet fixed.** Don't trust those sections
  until someone cleans them up; don't build new work assuming Agent Jobs is real.

If Agent Jobs UI, tools, or docs come up in a task, treat them as **removed**, not as a target to
restore, unless Mike explicitly asks to bring the feature back.
