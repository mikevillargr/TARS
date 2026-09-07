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
 * Action kinds the harness knows how to dispatch. The first three execute
 * server-side; the rest open a pre-seeded conversation, because they need
 * composition or judgement and chat is where the approval gates already live.
 */
export type SignalActionKind =
  | "create_task"
  | "create_reminder"
  | "create_event"
  | "draft_reply"
  | "move_event"
  | "open_meeting"
  | "save_brain"
  | "discuss"

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
  event_id: string | null
  message: string
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

export function actOnSignal(id: string, kind: SignalActionKind) {
  return apiPost<ActResult>(`/signals/${id}/act`, { kind })
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
