// Mock data for the /today screen.
//
// TEMPORARY — this stands in for the future `Signal` model + GET /api/signals.
// Shapes here are deliberately close to the proposed DB columns so swapping the
// mock for a real fetch is a one-line change in the page component.

export type SignalSource = "gmail" | "fireflies" | "calendar" | "project" | "strava"

export type SignalUrgency = "normal" | "time" | "overdue"

/** Every action maps 1:1 to a tool the harness already ships. */
export type SignalActionKind =
  | "draft_reply"      // send_email (draft card + approval gate)
  | "create_task"      // create_task
  | "move_event"       // update_calendar_event
  | "create_event"     // create_calendar_event
  | "save_brain"       // save_to_second_brain
  | "open_meeting"     // read_meeting

export interface SignalCalendarEvent {
  title: string
  /** ISO 8601 local — mock only; server will emit UTC. */
  start: string
  end: string
  location?: string
  notes?: string
}

export interface Signal {
  id: string
  source: SignalSource
  /** Mono badge text, e.g. "GMAIL". */
  sourceLabel: string
  /** Relative age, pre-formatted for the mock. */
  age: string
  title: string
  urgency: SignalUrgency
  action: { kind: SignalActionKind; label: string }
  /** Shown under the `why` disclosure. */
  reasoning: string
  /** What the inference was drawn from. */
  citation: string
  /**
   * Present when the signal implies a time-bound commitment. Drives the
   * "Add to calendar" affordance.
   */
  calendarEvent?: SignalCalendarEvent
}

export interface FyiItem {
  id: string
  sourceLabel: string
  text: string
}

export interface TodayMeeting {
  id: string
  time: string
  title: string
  canPrep: boolean
}

export interface OverdueItem {
  id: string
  title: string
  age: string
}

// ─── Signals ─────────────────────────────────────────────────────────────────

export const MOCK_SIGNALS: Signal[] = [
  {
    id: "sig_1",
    source: "gmail",
    sourceLabel: "Gmail",
    age: "2h ago",
    title: "Reply to J. Shorrock re: the AA Law contract redline",
    urgency: "time",
    action: { kind: "draft_reply", label: "Draft reply" },
    reasoning:
      "Thread has been open 2 days with a direct question to you (\"can you confirm clause 7.2 by Monday?\"). No reply sent from any of your accounts. Monday is tomorrow.",
    citation: "Gmail · Contract redline v3 — J. Shorrock",
  },
  {
    id: "sig_2",
    source: "fireflies",
    sourceLabel: "Fireflies",
    age: "1d ago",
    title: "Send OpenRice the Q4 scope document you committed to",
    urgency: "normal",
    action: { kind: "create_task", label: "Create task" },
    reasoning:
      "You said \"I'll get the scope over to you by end of week\" at 34:12 in the OpenRice sync. No matching task, artifact, or sent email exists.",
    citation: "Meeting · OpenRice PH — weekly sync",
  },
  {
    id: "sig_3",
    source: "calendar",
    sourceLabel: "Calendar",
    age: "just now",
    title: "You're double-booked Thursday 15:00 — NCH sync vs. LickSleeve call",
    urgency: "overdue",
    action: { kind: "move_event", label: "Move NCH sync" },
    reasoning:
      "Two accepted events overlap for the full hour. NCH sync is a recurring internal meeting; the LickSleeve call is a one-off with an external attendee, so the internal one is the cheaper move.",
    citation: "Calendar · Thu 11 Sep, 15:00–16:00",
  },
  {
    id: "sig_4",
    source: "fireflies",
    sourceLabel: "Fireflies",
    age: "3h ago",
    title: "Entire Travel Group asked for a follow-up session before the 19th",
    urgency: "normal",
    action: { kind: "create_event", label: "Schedule follow-up" },
    reasoning:
      "Aaron asked to \"lock in another session before the 19th\" near the end of the call and nobody proposed a time. Your Tue and Wed mornings that week are clear.",
    citation: "Meeting · Entire Travel Group — campaign review",
    calendarEvent: {
      title: "Entire Travel Group — follow-up session",
      start: "2026-09-16T10:00:00",
      end: "2026-09-16T11:00:00",
      location: "Google Meet",
      notes: "Follow-up requested during the campaign review call. Agenda TBC.",
    },
  },
  {
    id: "sig_5",
    source: "project",
    sourceLabel: "Projects",
    age: "5d ago",
    title: "NCH Inc. deck v3 has been In Progress for 5 days with no movement",
    urgency: "normal",
    action: { kind: "open_meeting", label: "Open project" },
    reasoning:
      "Task moved to In Progress on 2 Sep and hasn't been touched since. Its due date passed yesterday. Either it's done, or it's stuck.",
    citation: "Projects · NCH Inc. — Q4 deck",
  },
]

// ─── FYI — awareness only, no action needed ──────────────────────────────────

export const MOCK_FYI: FyiItem[] = [
  { id: "fyi_1", sourceLabel: "Gmail", text: "LickSleeve replied to the invoice thread — acknowledged, no ask." },
  { id: "fyi_2", sourceLabel: "Strava", text: "240 km logged this week. Longest ride since June." },
  { id: "fyi_3", sourceLabel: "Feed", text: "3 new items in AI/Tech, 1 saved to Second Brain automatically." },
]

// ─── Right rail ──────────────────────────────────────────────────────────────

export const MOCK_MEETINGS: TodayMeeting[] = [
  { id: "mtg_1", time: "09:00", title: "NCH Inc. standup", canPrep: true },
  { id: "mtg_2", time: "11:30", title: "Growth Rocket — internal pipeline", canPrep: false },
  { id: "mtg_3", time: "14:00", title: "AA Law — contract call", canPrep: true },
]

export const MOCK_OVERDUE: OverdueItem[] = [
  { id: "ovd_1", title: "NCH Inc. — Q4 deck v3", age: "1d" },
  { id: "ovd_2", title: "Send OpenRice September invoice", age: "3d" },
]

/** The synthesis paragraph — what the cron digest used to be, kept as prose. */
export const MOCK_BRIEF =
  "Three things actually need you today: the AA Law redline reply (Shorrock is waiting and Monday is his deadline), the Thursday double-booking, and the OpenRice scope doc you committed to on Friday. Everything else can wait. Your afternoon is clear after 15:00 — that's the only real block of focus time this week."
