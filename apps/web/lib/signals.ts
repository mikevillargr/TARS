import { apiGet, apiPost } from "@/lib/api-client"

// ─── Types — mirror api/routes/signals.py ────────────────────────────────────

export type SignalSource =
  | "gmail"
  | "fireflies"
  | "calendar"
  | "project"
  | "feed"
  | "strava"

export type SignalUrgency = "normal" | "time" | "overdue"

export type SignalStatus = "open" | "snoozed" | "done" | "dismissed"

/**
 * The complete action vocabulary. Nothing outside this list can appear on a
 * card — the generator picks from it, and the harness dispatches on it.
 *
 * EXECUTED SERVER-SIDE, EDITABLE FIRST — SignalCard expands an inline form
 * (InlineActionForm) before any of these commit; Confirm sends the edits as
 * payload_override, merged over the action's own payload server-side:
 *   create_reminder  Add to To-Dos      the default home for signal work
 *   create_task      Add to Projects    escalation, for tracked project work
 *   create_event     Book it            only when the signal carries an event
 *
 * PURE NAVIGATION — source_ref is already the id; no form, no chat, just a
 * route computed server-side (ActResult.route) and pushed to:
 *   open_meeting     Open meeting / Open project / Review transcript
 *
 * HANDED TO CHAT — needs actual composition or judgement, so it opens a
 * pre-seeded conversation (optionally carrying a freeform steering note)
 * where the existing approval gates apply (email in particular keeps its
 * draft-card confirm step):
 *   draft_reply      Draft reply / Draft chase email / Ask X for times
 *   move_event       Move <event> / Reschedule
 *   save_brain       Save to Second Brain
 *   discuss          Ask TARS about this — the catch-all
 */
export type SignalActionKind =
  | "create_reminder"
  | "create_task"
  | "create_event"
  | "draft_reply"
  | "move_event"
  | "open_meeting"
  | "save_brain"
  | "discuss"

/** Kinds SignalCard shows an inline form for before committing (FORM_KINDS in
 *  SignalCard.tsx) — everything else either navigates (open_meeting) or
 *  opens a conversation. */
export const EXECUTED_KINDS: SignalActionKind[] = [
  "create_reminder",
  "create_task",
  "create_event",
]

export interface SignalAction {
  kind: SignalActionKind
  label: string
  payload?: Record<string, unknown>
}

export interface SignalCalendarEvent {
  title?: string
  start: string
  end?: string
  duration_min?: number
  location?: string
  notes?: string
}

export interface Signal {
  id: string
  kind: "action" | "fyi"
  source: SignalSource
  source_label: string
  source_ref: string | null
  citation: string | null
  /** A resolved client name, or (email only, when no client matches) a coarse
   *  category like "Billing" — rendered as its own chip, not folded into
   *  source_label or the title. */
  context_label: string | null
  title: string
  urgency: SignalUrgency
  reasoning: string | null
  actions: SignalAction[]
  calendar_event: SignalCalendarEvent | null
  status: SignalStatus
  snoozed_until: string | null
  created_at: string
}

export interface ActResult {
  ok: boolean
  conversation_id: string | null
  task_id: string | null
  task_ids: string[] | null
  event_id: string | null
  /** In-app route to push to — set for open_meeting, which is pure
   *  navigation and never actually needed a conversation. */
  route: string | null
  message: string
}

/** Edits made in a card's inline form, and/or freeform steering for a chat
 *  handoff — both optional, both merged server-side over the action's own
 *  payload rather than replacing it. */
export interface ActOptions {
  payloadOverride?: Record<string, unknown>
  note?: string
}

/**
 * Relative age for the card's mono header. Coarse on purpose — "2h ago" is the
 * useful precision here; "2h 14m ago" is noise on a triage surface.
 *
 * Safe from hydration mismatch because signals only ever render after a
 * client-side fetch; the server render has an empty list.
 */
export function formatAge(iso: string): string {
  const then = new Date(iso).getTime()
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 2) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days === 1 ? "yesterday" : `${days}d ago`
}

// ─── API ─────────────────────────────────────────────────────────────────────

export function listSignals(status: SignalStatus | "all" = "open") {
  return apiGet<Signal[]>(`/signals?status=${status}`)
}

export function actOnSignal(id: string, kind: SignalActionKind, opts?: ActOptions) {
  return apiPost<ActResult>(`/signals/${id}/act`, {
    kind,
    payload_override: opts?.payloadOverride,
    note: opts?.note,
  })
}

export function snoozeSignal(id: string, until?: string) {
  return apiPost<Signal>(`/signals/${id}/snooze`, until ? { until } : {})
}

export function dismissSignal(id: string) {
  return apiPost<Signal>(`/signals/${id}/dismiss`)
}

export function restoreSignal(id: string) {
  return apiPost<Signal>(`/signals/${id}/restore`)
}

/**
 * Real URL, not a blob. iOS opens its native "Add to Calendar" sheet for a
 * text/calendar response; blob URLs and location-navigation downloads both
 * break inside the installed PWA shell (v2.15.1 → v2.15.5).
 */
export function signalIcsUrl(id: string): string {
  return `/api/proxy/signals/${id}/event.ics`
}

// ─── Right-rail data, from existing endpoints ────────────────────────────────

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string | null
  all_day?: boolean
}

export interface TaskRow {
  id: string
  title: string
  status: string
  due_at: string | null
}

export async function listTodayEvents(): Promise<CalendarEvent[]> {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return apiGet<CalendarEvent[]>(
    `/calendar/events?start=${start.toISOString()}&end=${end.toISOString()}`,
  )
}

export async function listOverdueTasks(): Promise<TaskRow[]> {
  const all = await apiGet<TaskRow[]>("/tasks")
  const now = Date.now()
  return all.filter(
    t =>
      t.status !== "done" &&
      t.due_at !== null &&
      new Date(t.due_at).getTime() < now,
  )
}
