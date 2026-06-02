# TARS Agent Operations Manual

**You are an agent working on the TARS codebase. Read every section before you touch any file.**

---

## 1. The Goal

Implement the user's request so it actually appears on the live site at https://tarsmv.duckdns.org.

A change is only "done" when:
1. The code is correct AND
2. TypeScript compiles AND
3. The PR is merged to `main` AND
4. A version tag is pushed AND
5. The live deployment is updated

**The harness handles steps 3, 4, and 5 automatically AFTER your work finishes.**
**Your responsibility is steps 1 and 2.** If you skip the verification, broken code reaches production.

---

## 2. Codebase Map — Where Things Actually Live

The repo is a Turborepo monorepo at `/opt/tars` on the server, `~/Documents/TARS` locally.

```
apps/web/                  Next.js 15 PWA (frontend)
  app/(app)/               Application routes — these are the LIVE PAGES
    chat/page.tsx          Main chat UI (inline conversation list + thread)
    tasks/page.tsx
    meetings/page.tsx
    calendar/page.tsx
    second-brain/page.tsx
    agent-jobs/page.tsx    Agent job dashboard
    artifacts/page.tsx
    connectors/page.tsx
    cron/page.tsx
    email-digest/page.tsx
    memory/page.tsx
    settings/page.tsx
  app/(auth)/login/        Login page
  app/api/                 Next.js API routes (auth, proxy to harness)
  components/              SHARED components — verify they're imported!
    chat/                  Chat sub-components (most are inline in page.tsx, NOT here)
    agent-jobs/
      AgentStatusChip.tsx  Ephemeral ticker shown in chat while an agent job runs.
                           Listens to tool_start + text_chunk events on the job's
                           WebSocket. Self-removes from the thread on completion.
                           DO NOT replace with AgentJobStream inline — that's the
                           verbose view for the Agent Jobs page only.
    second-brain/
    shell/                 Sidebar, command palette
    ui/                    shadcn components
  hooks/
    useNotifications.ts    Subscribes to /api/notifications/stream WebSocket.
                           Chat page uses this to receive new_message events and
                           show unread dots without polling. DO NOT add polling
                           loops — use this hook instead.
  lib/
    api-client.ts          apiGet / apiPost / apiDelete helpers
    websocket.ts           TarsWebSocket class with auto-reconnect + visibilitychange

apps/harness/              FastAPI backend
  main.py                  App entry + lifespan startup (also handles graceful
                           agent job drain on shutdown and re-queue on restart)
  api/routes/              ALL HTTP endpoints
    chat.py                Chat conversations + messages (mounted at /api/chat)
    notifications.py       WebSocket /api/notifications/stream — user-level
                           real-time events. Extend this for Phase 2 push notifs.
    tasks.py
    meetings.py
    agent_jobs.py
    artifacts.py
    ...
  agents/                  Agent system
    job_manager.py         Job lifecycle, Evolutionarist orchestrator.
                           _notify_chat() inserts a DB message AND publishes to
                           notifications broadcaster — always use this, never
                           insert Message rows directly in agent code.
    executor.py            Claude Code SDK wrapper for sub-agents. Merges PRs to
                           main and resets working tree — does NOT call deploy.sh
                           directly (deploy goes through GitHub Actions tag pipeline).
    notifications.py       In-memory pub/sub broadcaster keyed by user_id.
                           publish(user_id, event) → all connected WS clients.
                           Phase 2: add calendar/task/meeting events here.
    approval.py            Approval gates
  core/                    Routing, context assembler, model client
  memory/                  Mnemon + Second Brain
  connectors/              Gmail, Calendar, Fireflies
  db/models.py             SQLAlchemy models
  db/migrations/           Alembic migrations
```

---

## 3. THE #1 RULE — Find Where Code Is Actually Used Before Editing

**Most agent failures come from editing a file that looks right but is never imported.**

A common pattern:
- User asks "add Load More button to chat sidebar"
- Agent finds `apps/web/components/chat/conversation-list.tsx`
- Implements there
- Commits, deploys, nothing changes — the file is dead code

**The actual chat sidebar is inline in `apps/web/app/(app)/chat/page.tsx`.**

Before you write ONE line of code:

```bash
# Verify the component you're about to edit is imported somewhere
grep -rn "ConversationList\|conversation-list" /opt/tars/apps/web/app /opt/tars/apps/web/components --include="*.tsx" --include="*.ts" | grep -v ".next" | grep "import\|from"

# Find where the FEATURE actually renders
grep -rn "conversations.map\|conversation.title\|setActiveChatId" /opt/tars/apps/web/app --include="*.tsx"
```

If your search shows the file you were about to edit is NOT imported anywhere, **stop and look elsewhere**. The user's chat UI lives in `chat/page.tsx`. Their tasks UI lives in `tasks/page.tsx`. Most things are inline.

---

## 4. API Shape Changes — Update All Callers Or Don't Change

When you change a FastAPI endpoint's response shape:

```bash
# Find every place the frontend calls this endpoint
grep -rn "/chat/conversations\|/api/chat/conversations" /opt/tars/apps/web --include="*.ts" --include="*.tsx"

# Find every place it's typed
grep -rn "ConversationListOut\|Conversation\b" /opt/tars/apps/web --include="*.ts" --include="*.tsx"
```

Update every caller in the same commit. If you change `GET /chat/conversations` from returning `List[Conversation]` to `{conversations, total, has_more}`, every frontend call that does `.map()` on the response will break silently.

---

## 5. Mandatory Verification Before You Stop

```bash
cd /opt/tars/apps/web
npx tsc --noEmit 2>&1 | head -40
```

If there are TypeScript errors, fix them. **Do not stop with a broken build.**

The harness runs this check before commit. If it fails, your job is marked failed and nothing deploys.

For backend changes, verify imports parse:
```bash
cd /opt/tars/apps/harness && source .venv/bin/activate
python3 -c "from main import app; print('OK')"
```

---

## 6. Git Rules (Mandatory)

You do NOT do git operations. The harness handles all of these automatically:
- Branch creation (you start on `agent/<job_id>`)
- Staging changes
- Committing with conventional commit format
- Pushing to GitHub
- Opening PR to `main`
- Auto-merging when checks pass
- Pulling on the production server
- Building and reloading pm2 processes
- Tagging the next patch version
- Triggering the GitHub Actions deploy

**You: edit files. Run read-only git (status / log / diff / grep) if needed. Then stop.**

Forbidden: `git commit / push / checkout / merge / pull / fetch / add / restore` and `gh pr create / merge / ready / close`.

---

## 7. Versioning & Release Notes

- Semver: `MAJOR.MINOR.PATCH`
- Agent jobs always trigger PATCH bumps automatically (`v1.4.7` → `v1.4.8`)
- Release notes are auto-generated from PR titles via GitHub `--generate-notes`
- Your commit message becomes a line in the release notes — make it readable

**Commit message format (the harness generates this from your final summary):**
```
type(scope): short description in present tense
```

Types: `feat` `fix` `refactor` `docs` `test` `chore`

Bad final summaries that produce bad commits:
- "Done. Here's what I did:" → useless
- "Everything looks correct." → useless
- "I made the following changes:" → useless

Good final summaries:
- "Added Load More button to chat sidebar that paginates 20 conversations at a time"
- "Lowered Mnemon similarity threshold from 0.7 to 0.45 and added keyword fallback"
- "Fixed agent stream WebSocket reconnection on tab focus"

**Write your final summary as a one-line description of what changed.** The harness will turn it into the commit message and release note.

---

## 8. Deployment Flow (What Happens After You Stop)

```
You finish editing
  ↓
Harness runs npx tsc --noEmit
  ↓ (pass)
git add -A
git commit -m "fix(agent): your summary"
git push origin agent/<job_id>
  ↓
gh pr create --base main
gh pr merge --merge
  ↓
SSH to production server
git fetch origin && git reset --hard origin/main
npm install --legacy-peer-deps
NODE_ENV=production npm run build
pm2 reload tars-web (zero downtime)
  ↓
git tag v1.X.Y && git push origin v1.X.Y
  ↓
GitHub Actions Release workflow auto-creates the GitHub Release
  ↓
DONE — live on https://tarsmv.duckdns.org
```

**If any step fails the user sees nothing change.** This is why TypeScript verification before commit is non-negotiable.

---

## 9. Frontend Stack Specifics

- Next.js 15 with App Router (NOT pages router)
- `(app)` and `(auth)` are route groups (parentheses get stripped from URL)
- Server Components by default — add `"use client"` at top for client components
- Most pages are client components because they use state + WebSocket
- Styling: Tailwind + CSS variables (`var(--c-ink)`, `var(--c-moss)`, etc.)
- No emojis in UI text unless explicitly requested
- shadcn components in `apps/web/components/ui/`
- Icons from `lucide-react`

When in doubt about a Next.js API, read `node_modules/next/dist/docs/` — this version has breaking changes from older Next.js docs.

---

## 10. Backend Stack Specifics

- FastAPI with Python 3.11+
- SQLAlchemy 2.0 async with asyncpg
- pgvector for embeddings
- Alembic for migrations — generate with `alembic revision --autogenerate -m "msg"` then ALWAYS read the generated file and verify it
- Pydantic v2 for request/response models
- All routes use `Depends(require_auth)` for user_id
- Streaming responses use SSE via `StreamingResponse`
- Agent jobs run as asyncio tasks, broadcast events via WebSocket

---

## 11. Real-Time Notification Pattern

TARS has a user-level real-time notification channel. Use it whenever you need to push an update to the chat UI without the user doing anything.

**How it works:**
1. Backend calls `agents.notifications.publish(user_id, event_dict)`
2. Any connected browser tab receives the event on its WebSocket immediately
3. The chat page `useNotifications` hook handles it

**To send a notification from backend code:**
```python
from agents.notifications import publish as notify

await notify(user_id, {
    "type": "new_message",           # or any type you define
    "conversation_id": conv_id,
    "message_id": msg_id,
    "preview": "First 120 chars…",
    "created_at": msg.created_at.isoformat(),
})
```

**Always use `_notify_chat()` in job_manager.py when posting an agent reply** — it inserts the DB row AND calls `publish()` in one step. Never insert a `Message` row directly if you want the UI to update live.

**To add a new notification type (Phase 2 — calendar, tasks, etc.):**
1. Call `publish(user_id, {"type": "your_type", ...})` in the relevant backend handler
2. Add a handler in `hooks/useNotifications.ts`: `ws.on("your_type", handler)`
3. Wire it up in whatever page cares about it

**Do NOT add polling loops** to check for new data. The notification system is the right pattern.

---

## 11. If You're Unsure

You can ask the user a question by running:
```bash
tars-ask "Should I add this as a new feature or replace the existing one?"
```

The user will be paged in chat and your job pauses until they answer. Use this when:
- The instruction is ambiguous
- You found two viable implementation paths
- The change has security or data implications

Do NOT use `tars-ask` for trivial decisions you can make yourself.

---

## 12. Self-Check Before You Stop

- [ ] Did I find where the feature is actually rendered (not just a file with a related name)?
- [ ] Did I update all callers if I changed an API shape?
- [ ] Did I run `npx tsc --noEmit` and see zero errors?
- [ ] Is my final summary a single clear sentence that will make a good commit message?
- [ ] Did I avoid all forbidden git operations?

When all of these are yes, stop. The harness takes it from there.
