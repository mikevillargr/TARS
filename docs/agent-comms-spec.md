# Agent Communication System — Technical Specification

> Version 1.0 — May 2026
> Status: Ready for implementation handoff

---

## Executive Summary

This specification defines a **real-time, bidirectional communication system** between the TARS backend and frontend, enabling:

1. **Server-initiated messages** — TARS can push into an active chat session without waiting for user input
2. **Agent job updates** — Running agents report milestones, gate questions, and spawned sub-agents in real time
3. **Proactive notifications** — Calendar proximity, email webhooks, and task completions surface as TARS-initiated chat messages

The design extends the existing WebSocket infrastructure (`TarsWebSocket` class) and job broadcast system (`job_manager.py`) with a **unified push channel** and **event bus** architecture.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [WebSocket Push Channel](#2-websocket-push-channel)
3. [Agent Ping Endpoint](#3-agent-ping-endpoint)
4. [Gate Question System](#4-gate-question-system)
5. [Agent Job Lineage Tracking](#5-agent-job-lineage-tracking)
6. [Proactive TARS Message Triggers](#6-proactive-tars-message-triggers)
7. [Message Types & Frontend Contract](#7-message-types--frontend-contract)
8. [API Contracts](#8-api-contracts)
9. [Implementation Handoff Notes](#9-implementation-handoff-notes)

---

## 1. Architecture Overview

### Current State

```
┌─────────────┐    SSE (chat)     ┌─────────────┐
│   Frontend  │◄──────────────────│   Harness   │
│  (Next.js)  │                   │  (FastAPI)  │
│             │    WS (per-job)   │             │
│             │◄──────────────────│             │
└─────────────┘                   └─────────────┘
```

- **Chat**: SSE stream per message request — reactive only
- **Agent jobs**: WebSocket per job_id — isolated broadcast

### Proposed State

```
┌─────────────┐    WS (session)   ┌─────────────┐    Internal    ┌─────────────┐
│   Frontend  │◄──────────────────│   Harness   │◄───────────────│  Event Bus  │
│  (Next.js)  │                   │  (FastAPI)  │                │   (Redis)   │
│             │    REST / POST    │             │                │             │
│             │──────────────────►│             │                │             │
└─────────────┘                   └─────────────┘                └─────────────┘
                                        ▲
                                        │ POST /api/agent-ping
                                        │
                                  ┌─────────────┐
                                  │ Agent Jobs  │
                                  │  (Claude)   │
                                  └─────────────┘
```

- **Session WebSocket**: Single persistent connection per authenticated user
- **Event bus**: Redis pub/sub routes all push events (agent pings, calendar, email, tasks)
- **Agent ping endpoint**: Internal POST that agents call to report status

---

## 2. WebSocket Push Channel

### 2.1 Endpoint

```
WS /api/push?token=<jwt>
```

### 2.2 Connection Lifecycle

```
Frontend                              Harness
    │                                    │
    │──── WS upgrade + ?token=JWT ──────►│
    │                                    │
    │◄─── { type: "connected",           │
    │       session_id: "...",           │
    │       reconnect_token: "..." } ────│
    │                                    │
    │◄─── { type: "...", ... } ──────────│  (push events)
    │                                    │
    │──── { type: "pong" } ─────────────►│  (keepalive response)
    │                                    │
    │◄─── { type: "ping" } ──────────────│  (server ping every 30s)
    │                                    │
```

### 2.3 Session Management

| Field | Type | Description |
|-------|------|-------------|
| `session_id` | string | UUID assigned on connect; used for routing |
| `user_id` | string | Extracted from JWT; events are filtered to this user |
| `reconnect_token` | string | Short-lived token (5 min) for session resume |

**Backend State (in-memory + Redis)**

```python
# apps/harness/core/push_manager.py

class PushSession:
    session_id: str
    user_id: str
    send_fn: Callable[[dict], Awaitable[None]]
    connected_at: datetime
    last_ping: datetime

class PushManager:
    _sessions: dict[str, PushSession]  # session_id -> session
    _user_sessions: dict[str, set[str]]  # user_id -> {session_id, ...}
    
    async def register(self, session_id: str, user_id: str, send_fn)
    async def unregister(self, session_id: str)
    async def push_to_user(self, user_id: str, event: dict)
    async def push_to_session(self, session_id: str, event: dict)
```

**Redis Pub/Sub Channel**

```
Channel: tars:push:{user_id}
Payload: JSON event envelope
```

Each harness instance subscribes to its active users' channels. On event receipt, it forwards to all local sessions for that user.

### 2.4 Reconnection Strategy

1. **Client disconnects** → Frontend stores `reconnect_token` and `session_id`
2. **Reconnect within 5 min** → Pass both in query: `?token=JWT&reconnect=<token>&session=<id>`
3. **Server validates** → If valid, replays buffered events (ring buffer, max 100 events, 5 min TTL)
4. **Expired or invalid** → Fresh session assigned, no replay

### 2.5 Message Envelope Schema

All push messages follow this envelope:

```typescript
interface PushEnvelope {
  type: string;           // Message type (see Section 7)
  payload: object;        // Type-specific data
  timestamp: string;      // ISO 8601
  sender: string;         // "tars" | "agent:{job_id}" | "system"
  priority: "normal" | "interrupt";  // UI treatment hint
  conversation_id?: string;  // If this event should appear in a chat thread
  job_id?: string;        // If related to an agent job
}
```

---

## 3. Agent Ping Endpoint

### 3.1 Purpose

Running agent jobs (Claude Code subprocess or future executors) call this endpoint to report:

- **Milestones** — progress updates ("Analyzing codebase...", "Found 3 issues")
- **Gate questions** — blocking prompts requiring user input
- **Spawned agents** — child agent creation notifications
- **Completion/failure** — final status with summary

### 3.2 Endpoint

```
POST /api/agent-ping
```

**Auth**: Internal only — requires `X-Internal-Token` header matching `INTERNAL_API_TOKEN` env var. Not exposed to external clients.

### 3.3 Request Schema

```typescript
interface AgentPingRequest {
  job_id: string;
  parent_job_id?: string;  // For child agents
  event_type: "milestone" | "gate" | "spawn" | "complete" | "failed";
  message: string;         // Human-readable status
  metadata?: {
    // milestone
    progress_pct?: number;  // 0-100
    stage?: string;
    
    // gate
    gate_id?: string;       // Unique ID for this gate
    gate_type?: "approval" | "question" | "choice";
    options?: GateOption[];
    timeout_sec?: number;   // Auto-reject after timeout
    
    // spawn
    child_job_id?: string;
    child_agent_type?: string;
    child_instruction?: string;
    
    // complete
    summary?: string;
    pr_url?: string;
    files_changed?: number;
    
    // failed
    error?: string;
    stack_trace?: string;
  };
}

interface GateOption {
  id: string;
  label: string;
  description?: string;
  is_default?: boolean;
}
```

### 3.4 Response

```typescript
interface AgentPingResponse {
  ok: boolean;
  error?: string;
  
  // For gate events, poll this until response arrives
  gate_response_url?: string;  // GET /api/agent-gate/{gate_id}/response
}
```

### 3.5 Routing to Push Channel

```python
# On ping receipt:
async def handle_agent_ping(ping: AgentPingRequest):
    # 1. Update AgentJob record in DB
    job = await db.get(AgentJob, ping.job_id)
    job.status = map_event_to_status(ping.event_type)
    
    # 2. Build push event
    event = {
        "type": f"agent_{ping.event_type}",
        "payload": {
            "job_id": ping.job_id,
            "parent_job_id": ping.parent_job_id,
            "message": ping.message,
            **ping.metadata,
        },
        "timestamp": utcnow().isoformat(),
        "sender": f"agent:{ping.job_id}",
        "priority": "interrupt" if ping.event_type == "gate" else "normal",
        "conversation_id": job.conversation_id,
        "job_id": ping.job_id,
    }
    
    # 3. Push to user's session
    await push_manager.push_to_user(job.user_id, event)
    
    # 4. Store in job's ring buffer for reconnect replay
    await job_manager.buffer_event(ping.job_id, event)
```

---

## 4. Gate Question System

### 4.1 Flow

```
Agent Job                    Harness                    Frontend
    │                           │                           │
    │── POST /agent-ping ──────►│                           │
    │   event_type: gate        │                           │
    │   gate_id: "gate_xyz"     │                           │
    │                           │── WS push ───────────────►│
    │                           │   type: agent_gate        │
    │                           │   gate_id: "gate_xyz"     │
    │                           │   options: [...]          │
    │                           │                           │
    │◄── 202 Accepted ──────────│                           │
    │   gate_response_url       │                           │
    │                           │                           │
    │   (agent polls...)        │                           │
    │                           │                           │
    │                           │◄── POST ──────────────────│
    │                           │   /agent-gate-response    │
    │                           │   gate_id, selected_id    │
    │                           │                           │
    │◄── GET gate response ─────│                           │
    │   { selected_id: "..." }  │                           │
    │                           │                           │
    │   (agent continues)       │                           │
```

### 4.2 Gate Response Endpoint

```
POST /api/agent-gate-response
```

**Auth**: User JWT (standard auth)

```typescript
interface GateResponseRequest {
  gate_id: string;
  selected_id: string;       // ID of chosen option
  custom_input?: string;     // For "other" / free-text options
}

interface GateResponseResult {
  ok: boolean;
  error?: string;
}
```

### 4.3 Agent-Side Polling

Agents poll for gate responses:

```
GET /api/agent-gate/{gate_id}/response
```

**Auth**: Internal token

**Response**:
- `200 OK` with `{ selected_id, custom_input }` → gate answered
- `202 Accepted` with `{ pending: true }` → still waiting
- `408 Request Timeout` → gate timed out (use default or fail)

### 4.4 Backend State

```python
# apps/harness/agents/gate_manager.py

class PendingGate:
    gate_id: str
    job_id: str
    user_id: str
    options: list[GateOption]
    timeout_at: datetime
    response: Optional[GateResponse] = None

class GateManager:
    _pending: dict[str, PendingGate]  # gate_id -> gate
    _gate_events: dict[str, asyncio.Event]  # gate_id -> wait event
    
    async def create_gate(self, gate: PendingGate) -> str
    async def respond(self, gate_id: str, response: GateResponse)
    async def wait_for_response(self, gate_id: str, timeout: float) -> Optional[GateResponse]
```

---

## 5. Agent Job Lineage Tracking

### 5.1 Database Schema Extension

The existing `AgentJob` model already has `parent_job_id`. We add:

```python
# apps/harness/db/models.py

class AgentJob(Base):
    # ... existing fields ...
    
    # Lineage
    parent_job_id: Optional[str] = Column(String, ForeignKey("agent_jobs.id"), nullable=True)
    depth: int = Column(Integer, default=0)  # 0 = root, 1 = child, etc.
    root_job_id: Optional[str] = Column(String, ForeignKey("agent_jobs.id"), nullable=True)
    
    # Relationships
    parent = relationship("AgentJob", remote_side=[id], foreign_keys=[parent_job_id])
    children = relationship("AgentJob", foreign_keys=[parent_job_id])
```

### 5.2 Recording Spawns

When an agent spawns a child (via `spawn` ping event):

```python
async def record_spawn(parent_job_id: str, child_data: dict):
    parent = await db.get(AgentJob, parent_job_id)
    
    child = AgentJob(
        id=child_data["child_job_id"],
        user_id=parent.user_id,
        agent_type=child_data["child_agent_type"],
        instruction=child_data["child_instruction"],
        parent_job_id=parent_job_id,
        depth=parent.depth + 1,
        root_job_id=parent.root_job_id or parent.id,
        conversation_id=parent.conversation_id,
        status="pending",
    )
    await db.add(child)
```

### 5.3 Querying the Tree

```sql
-- Get full tree for a root job
WITH RECURSIVE job_tree AS (
    SELECT id, parent_job_id, agent_type, instruction, status, depth
    FROM agent_jobs
    WHERE id = :root_job_id
    
    UNION ALL
    
    SELECT j.id, j.parent_job_id, j.agent_type, j.instruction, j.status, j.depth
    FROM agent_jobs j
    INNER JOIN job_tree jt ON j.parent_job_id = jt.id
)
SELECT * FROM job_tree ORDER BY depth, created_at;
```

### 5.4 Frontend Tree Data Structure

```typescript
interface AgentJobTree {
  job: AgentJob;
  children: AgentJobTree[];
}

// Flattened for rendering:
interface AgentJobNode {
  job: AgentJob;
  depth: number;
  parent_id: string | null;
  is_last_sibling: boolean;
}
```

API endpoint:

```
GET /api/agent-jobs/{job_id}/tree
```

Returns the full tree rooted at `job_id` (or its `root_job_id` if it's a child).

---

## 6. Proactive TARS Message Triggers

### 6.1 Event Bus Design

All push-worthy events route through a unified event bus:

```python
# apps/harness/core/event_bus.py

class EventType(Enum):
    AGENT_PING = "agent_ping"
    CALENDAR_PROXIMITY = "calendar_proximity"
    EMAIL_RECEIVED = "email_received"
    EMAIL_DIGEST_READY = "email_digest_ready"
    TASK_DUE_SOON = "task_due_soon"
    TASK_COMPLETED = "task_completed"
    MEETING_ENDED = "meeting_ended"
    CRON_COMPLETED = "cron_completed"

class EventBus:
    async def publish(self, event_type: EventType, payload: dict, user_id: str):
        """Publish event to Redis for all harness instances."""
        
    async def subscribe(self, user_id: str, handler: Callable):
        """Subscribe to events for a user."""
```

### 6.2 Event Sources

| Source | Trigger | Event Type |
|--------|---------|------------|
| Agent jobs | POST /agent-ping | `AGENT_PING` |
| Calendar cron | Event starts in ≤15 min | `CALENDAR_PROXIMITY` |
| Gmail webhook | New email matching filters | `EMAIL_RECEIVED` |
| Email digest cron | Daily digest generated | `EMAIL_DIGEST_READY` |
| Task cron | Due date within 24h | `TASK_DUE_SOON` |
| Task completion | Status → "done" | `TASK_COMPLETED` |
| Fireflies webhook | Meeting transcript ready | `MEETING_ENDED` |
| Any cron job | Job completes | `CRON_COMPLETED` |

### 6.3 Priority & Throttle Rules

```python
# apps/harness/core/push_policy.py

PRIORITY_RULES = {
    # Interrupt (always push immediately, UI shows prominently)
    "agent_gate": "interrupt",
    "agent_failed": "interrupt",
    
    # Normal (push immediately, standard UI)
    "agent_milestone": "normal",
    "agent_complete": "normal",
    "agent_spawn": "normal",
    "calendar_proximity": "normal",
    "meeting_ended": "normal",
    
    # Batched (aggregate similar events, push after delay)
    "email_received": "batch:60s",  # Batch for 60s
    "task_completed": "batch:30s",
}

THROTTLE_RULES = {
    # Max events per type per minute
    "agent_milestone": 10,
    "email_received": 5,
    
    # Quiet hours (no push, queue for later)
    "quiet_hours": ("22:00", "07:00"),  # User's timezone
}

async def should_push(event: dict, user_prefs: dict) -> bool:
    """Evaluate whether to push immediately, batch, or suppress."""
```

### 6.4 TARS-Initiated Message Generation

When a proactive event warrants a chat message, TARS generates a response:

```python
async def create_tars_initiated_message(event: dict, user_id: str):
    """Generate a TARS message for a proactive event."""
    
    # Get or create today's proactive conversation
    conversation = await get_or_create_proactive_conversation(user_id)
    
    # Generate message via Tier 1 (Haiku) - fast, cheap
    prompt = build_proactive_prompt(event)
    response = await model_client.complete(prompt, tier=ModelTier.TIER_1)
    
    # Save to conversation
    message = Message(
        conversation_id=conversation.id,
        role="assistant",
        content=response,
        model_used="haiku",
    )
    await db.add(message)
    
    # Push to frontend
    await push_manager.push_to_user(user_id, {
        "type": "tars_initiated",
        "payload": {
            "conversation_id": conversation.id,
            "message": {
                "id": message.id,
                "content": response,
                "event_type": event["type"],
            },
        },
        "timestamp": utcnow().isoformat(),
        "sender": "tars",
        "priority": "normal",
    })
```

---

## 7. Message Types & Frontend Contract

### 7.1 Full Message Type Catalog

| Type | Sender | Priority | Requires Action | Description |
|------|--------|----------|-----------------|-------------|
| `tars_response` | tars | normal | No | Reactive response to user message |
| `tars_initiated` | tars | normal | No | Proactive TARS message (calendar, digest) |
| `agent_milestone` | agent:{id} | normal | No | Progress update from running agent |
| `agent_gate` | agent:{id} | interrupt | **Yes** | Blocking question requiring chip selection |
| `agent_complete` | agent:{id} | normal | No | Agent finished successfully |
| `agent_failed` | agent:{id} | interrupt | No | Agent failed with error |
| `agent_spawn` | agent:{id} | normal | No | Child agent was created |
| `system_event` | system | normal | Varies | Email, calendar, task notifications |

### 7.2 Visual Treatment Recommendations

```typescript
interface MessageVisualConfig {
  type: string;
  sender_label: string;
  avatar: "tars" | "agent" | "system";
  bubble_style: "default" | "card" | "banner" | "inline";
  accent_color?: string;
  show_timestamp: boolean;
  show_actions: boolean;
  animation?: "fade-in" | "slide-up" | "pulse";
}

const MESSAGE_VISUALS: Record<string, MessageVisualConfig> = {
  tars_response: {
    sender_label: "TARS",
    avatar: "tars",
    bubble_style: "default",
    show_timestamp: true,
    show_actions: true,
    animation: "fade-in",
  },
  
  tars_initiated: {
    sender_label: "TARS",
    avatar: "tars",
    bubble_style: "card",
    accent_color: "var(--c-moss)",
    show_timestamp: true,
    show_actions: true,
    animation: "slide-up",
  },
  
  agent_milestone: {
    sender_label: "Agent",
    avatar: "agent",
    bubble_style: "inline",
    show_timestamp: false,
    show_actions: false,
    animation: "fade-in",
  },
  
  agent_gate: {
    sender_label: "Agent",
    avatar: "agent",
    bubble_style: "card",
    accent_color: "var(--c-amber)",
    show_timestamp: true,
    show_actions: true,  // Chip selection buttons
    animation: "pulse",
  },
  
  agent_complete: {
    sender_label: "Agent",
    avatar: "agent",
    bubble_style: "card",
    accent_color: "var(--c-moss)",
    show_timestamp: true,
    show_actions: true,  // View PR, View Details
    animation: "slide-up",
  },
  
  agent_failed: {
    sender_label: "Agent",
    avatar: "agent",
    bubble_style: "card",
    accent_color: "var(--c-rose)",
    show_timestamp: true,
    show_actions: true,  // Retry, View Logs
    animation: "pulse",
  },
  
  agent_spawn: {
    sender_label: "Agent",
    avatar: "agent",
    bubble_style: "inline",
    show_timestamp: false,
    show_actions: false,
    animation: "fade-in",
  },
  
  system_event: {
    sender_label: "System",
    avatar: "system",
    bubble_style: "banner",
    show_timestamp: true,
    show_actions: true,
    animation: "slide-up",
  },
};
```

### 7.3 Payload Schemas by Type

```typescript
// tars_response (reactive)
interface TarsResponsePayload {
  conversation_id: string;
  message_id: string;
  content: string;
  model_used?: string;
  tool_results?: ToolResult[];
}

// tars_initiated (proactive)
interface TarsInitiatedPayload {
  conversation_id: string;
  message: {
    id: string;
    content: string;
    event_type: string;  // calendar_proximity, email_digest, etc.
  };
  trigger: {
    type: string;
    data: object;  // Event-specific context
  };
}

// agent_milestone
interface AgentMilestonePayload {
  job_id: string;
  parent_job_id?: string;
  message: string;
  progress_pct?: number;
  stage?: string;
}

// agent_gate
interface AgentGatePayload {
  job_id: string;
  gate_id: string;
  gate_type: "approval" | "question" | "choice";
  message: string;
  options: GateOption[];
  timeout_sec?: number;
}

// agent_complete
interface AgentCompletePayload {
  job_id: string;
  summary: string;
  pr_url?: string;
  files_changed?: number;
  duration_sec: number;
}

// agent_failed
interface AgentFailedPayload {
  job_id: string;
  error: string;
  stack_trace?: string;
  recoverable: boolean;
}

// agent_spawn
interface AgentSpawnPayload {
  job_id: string;         // Parent
  child_job_id: string;
  child_agent_type: string;
  child_instruction: string;
}

// system_event
interface SystemEventPayload {
  event_type: "email" | "calendar" | "task" | "meeting";
  title: string;
  description?: string;
  action_url?: string;
  data: object;
}
```

---

## 8. API Contracts

### 8.1 WebSocket Push Channel

```yaml
# WS /api/push

Connection:
  query:
    token: string           # JWT (required)
    reconnect: string       # Reconnect token (optional)
    session: string         # Previous session ID (optional)
  
  onOpen:
    server -> client:
      type: "connected"
      session_id: string
      reconnect_token: string
      buffered_events: PushEnvelope[]  # Replayed on reconnect

Server Messages (server -> client):
  PushEnvelope:
    type: string
    payload: object
    timestamp: string (ISO 8601)
    sender: string
    priority: "normal" | "interrupt"
    conversation_id?: string
    job_id?: string

Client Messages (client -> server):
  Pong:
    type: "pong"
```

### 8.2 Agent Ping Endpoint

```yaml
POST /api/agent-ping

Headers:
  X-Internal-Token: string  # Required, matches INTERNAL_API_TOKEN

Request Body:
  job_id: string            # Required
  parent_job_id?: string
  event_type: enum          # milestone | gate | spawn | complete | failed
  message: string           # Required
  metadata?: object         # Event-specific fields

Response 200:
  ok: true
  gate_response_url?: string  # For gate events

Response 401:
  ok: false
  error: "Invalid internal token"

Response 404:
  ok: false
  error: "Job not found"
```

### 8.3 Gate Response Endpoint

```yaml
POST /api/agent-gate-response

Headers:
  Authorization: Bearer <JWT>

Request Body:
  gate_id: string
  selected_id: string
  custom_input?: string

Response 200:
  ok: true

Response 400:
  ok: false
  error: "Gate already answered" | "Invalid option"

Response 404:
  ok: false
  error: "Gate not found or expired"
```

### 8.4 Gate Poll Endpoint (Internal)

```yaml
GET /api/agent-gate/{gate_id}/response

Headers:
  X-Internal-Token: string

Response 200 (answered):
  selected_id: string
  custom_input?: string

Response 202 (pending):
  pending: true

Response 408 (timeout):
  error: "Gate timed out"

Response 404:
  error: "Gate not found"
```

### 8.5 Agent Job Tree Endpoint

```yaml
GET /api/agent-jobs/{job_id}/tree

Headers:
  Authorization: Bearer <JWT>

Response 200:
  root_job_id: string
  nodes: AgentJobNode[]

AgentJobNode:
  id: string
  parent_job_id?: string
  agent_type: string
  instruction: string
  status: string
  depth: number
  created_at: string
  completed_at?: string
```

---

## 9. Implementation Handoff Notes

### 9.1 Backend Agent Tasks

**Priority 1: Core Infrastructure**

| Task | File(s) | Est. Hours |
|------|---------|------------|
| Create `PushManager` class | `apps/harness/core/push_manager.py` | 4h |
| Add WS `/api/push` endpoint | `apps/harness/api/routes/push.py` | 3h |
| Redis pub/sub integration | `apps/harness/core/push_manager.py` | 3h |
| Session reconnect + buffer replay | `apps/harness/core/push_manager.py` | 2h |

**Priority 2: Agent Ping System**

| Task | File(s) | Est. Hours |
|------|---------|------------|
| Add `/api/agent-ping` endpoint | `apps/harness/api/routes/agent_jobs.py` | 2h |
| Create `GateManager` class | `apps/harness/agents/gate_manager.py` | 3h |
| Add `/api/agent-gate-response` endpoint | `apps/harness/api/routes/agent_jobs.py` | 2h |
| Add `/api/agent-gate/{id}/response` poll endpoint | `apps/harness/api/routes/agent_jobs.py` | 1h |
| Integrate ping -> push routing | `apps/harness/agents/job_manager.py` | 2h |

**Priority 3: Lineage & Proactive**

| Task | File(s) | Est. Hours |
|------|---------|------------|
| Add `depth`, `root_job_id` columns to `AgentJob` | `apps/harness/db/models.py` | 1h |
| Create migration | `apps/harness/db/migrations/` | 0.5h |
| Add `/api/agent-jobs/{id}/tree` endpoint | `apps/harness/api/routes/agent_jobs.py` | 2h |
| Create `EventBus` class | `apps/harness/core/event_bus.py` | 3h |
| Create `PushPolicy` throttle/priority logic | `apps/harness/core/push_policy.py` | 2h |
| Integrate cron jobs with event bus | `apps/harness/jobs/*.py` | 3h |

**Total Backend Estimate: ~32 hours**

### 9.2 Frontend Agent Tasks

**Priority 1: Push Channel Client**

| Task | File(s) | Est. Hours |
|------|---------|------------|
| Extend `TarsWebSocket` for push channel | `apps/web/lib/websocket.ts` | 2h |
| Create `usePushChannel` hook | `apps/web/hooks/usePushChannel.ts` | 3h |
| Session reconnect logic | `apps/web/hooks/usePushChannel.ts` | 2h |
| Global push event dispatcher | `apps/web/lib/push-events.ts` | 2h |

**Priority 2: Chat Integration**

| Task | File(s) | Est. Hours |
|------|---------|------------|
| Handle `tars_initiated` in chat | `apps/web/app/(app)/chat/page.tsx` | 3h |
| Proactive message card component | `apps/web/components/chat/ProactiveCard.tsx` | 2h |
| Agent stream inline updates | `apps/web/components/agent-jobs/AgentJobStream.tsx` | 2h |

**Priority 3: Gate UI**

| Task | File(s) | Est. Hours |
|------|---------|------------|
| Gate question modal component | `apps/web/components/agent-jobs/GateModal.tsx` | 3h |
| Chip selection with keyboard nav | `apps/web/components/agent-jobs/GateModal.tsx` | 2h |
| Gate response API integration | `apps/web/lib/api-client.ts` | 1h |

**Priority 4: Agent Tree**

| Task | File(s) | Est. Hours |
|------|---------|------------|
| Agent tree visualization component | `apps/web/components/agent-jobs/AgentTree.tsx` | 4h |
| Integrate tree into job detail view | `apps/web/app/(app)/agent-jobs/[id]/page.tsx` | 2h |

**Total Frontend Estimate: ~28 hours**

### 9.3 Suggested Implementation Order

```
Week 1:
  BE: PushManager + WS endpoint + Redis pub/sub
  FE: TarsWebSocket extension + usePushChannel hook

Week 2:
  BE: Agent ping endpoint + GateManager
  FE: Chat integration for tars_initiated

Week 3:
  BE: Gate response endpoints + agent integration
  FE: Gate modal + chip selection UI

Week 4:
  BE: Lineage tracking + tree endpoint + EventBus
  FE: Agent tree visualization

Week 5:
  BE: Proactive triggers (calendar, email cron)
  FE: Polish, edge cases, testing
```

### 9.4 Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Redis availability | Use in-memory fallback for single-instance dev |
| WS connection drops | Aggressive reconnect with buffer replay |
| Gate timeout races | Use distributed lock (Redis) for gate state |
| Push spam | Priority/throttle rules + quiet hours |
| Mobile push when app closed | Defer to PWA push notifications (existing system) |

### 9.5 Testing Checklist

**Backend**
- [ ] Unit: PushManager session lifecycle
- [ ] Unit: GateManager timeout behavior
- [ ] Integration: Agent ping -> push delivery
- [ ] Integration: Gate response round-trip
- [ ] Load: 100 concurrent WS connections

**Frontend**
- [ ] Unit: usePushChannel hook states
- [ ] Unit: Gate modal keyboard navigation
- [ ] E2E: Agent job with gate question
- [ ] E2E: Proactive message appears in chat
- [ ] Cross-browser: WS reconnect behavior

---

## Appendix A: Environment Variables

```bash
# Add to .env

# Internal API token for agent-to-harness communication
INTERNAL_API_TOKEN=generate_random_64_chars

# Push channel buffer settings
PUSH_BUFFER_SIZE=100
PUSH_BUFFER_TTL_SEC=300

# Gate timeout default (seconds)
GATE_DEFAULT_TIMEOUT_SEC=300
```

---

## Appendix B: Migration Script

```python
# apps/harness/db/migrations/versions/xxxx_add_agent_lineage.py

def upgrade():
    op.add_column('agent_jobs', sa.Column('depth', sa.Integer(), default=0))
    op.add_column('agent_jobs', sa.Column('root_job_id', sa.String(), nullable=True))
    op.create_foreign_key(
        'fk_agent_jobs_root_job_id',
        'agent_jobs', 'agent_jobs',
        ['root_job_id'], ['id']
    )
    op.create_index('ix_agent_jobs_root_job_id', 'agent_jobs', ['root_job_id'])

def downgrade():
    op.drop_index('ix_agent_jobs_root_job_id')
    op.drop_constraint('fk_agent_jobs_root_job_id', 'agent_jobs')
    op.drop_column('agent_jobs', 'root_job_id')
    op.drop_column('agent_jobs', 'depth')
```

---

*End of specification*
