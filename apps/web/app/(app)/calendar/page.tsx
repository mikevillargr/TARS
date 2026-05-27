"use client"

import { useMemo, useState, useRef, Fragment } from "react"
import { useRouter } from "next/navigation"
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Video,
  CheckSquare,
  Clock as ClockIcon,
  Cpu,
  X,
  ArrowRight,
} from "lucide-react"
import {
  MOCK_MEETINGS,
  MOCK_TASKS,
  MOCK_CRON_JOBS,
  MOCK_AGENT_JOBS,
} from "@/lib/mock-ui-data"

type ViewMode = "month" | "week" | "day"
type EventType = "meeting" | "task" | "cron" | "agent"

interface CalendarEvent {
  id: string
  type: EventType
  title: string
  start: Date
  durationMin: number
  source: any
}

const TYPE_STYLES: Record<EventType, { dot: string; bg: string; text: string; borderColor: string; icon: any; label: string }> = {
  meeting: { dot: "bg-moss",       bg: "bg-moss-soft",   text: "text-moss",      borderColor: "#2d5a4f", icon: Video,        label: "Meeting"  },
  task:    { dot: "bg-amber",      bg: "bg-amber-soft",  text: "text-amber",     borderColor: "#b8651a", icon: CheckSquare,  label: "Task"     },
  cron:    { dot: "bg-ink-muted",  bg: "bg-surface-2",   text: "text-ink",       borderColor: "#6b6357", icon: ClockIcon,    label: "Cron Job" },
  agent:   { dot: "bg-rose",       bg: "bg-rose-soft",   text: "text-rose",      borderColor: "#a04848", icon: Cpu,          label: "Agent Job"},
}

const TODAY = new Date("2026-05-27T09:00:00Z")

function startOfWeek(d: Date) {
  const out = new Date(d)
  const diff = (out.getDay() + 6) % 7
  out.setDate(out.getDate() - diff)
  out.setHours(0, 0, 0, 0)
  return out
}

function addDays(d: Date, n: number) {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function parseDueDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const d = new Date(s + "T09:00:00")
  return isNaN(d.getTime()) ? null : d
}

function durationFromString(s: string): number {
  const m = /(\d+)\s*m/.exec(s)
  return m ? parseInt(m[1], 10) : 30
}

function parseCronNextRun(s: string, base: Date): Date {
  const out = new Date(base)
  out.setHours(10, 0, 0, 0)
  if (/tomorrow/i.test(s)) out.setDate(out.getDate() + 1)
  else if (/sunday/i.test(s)) {
    const target = startOfWeek(base)
    target.setDate(target.getDate() + 6)
    out.setTime(target.getTime())
  }
  const tm = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(s)
  if (tm) {
    let h = parseInt(tm[1], 10)
    const min = parseInt(tm[2], 10)
    const ampm = (tm[3] || "").toUpperCase()
    if (ampm === "PM" && h < 12) h += 12
    if (ampm === "AM" && h === 12) h = 0
    out.setHours(h, min, 0, 0)
  }
  return out
}

function buildEvents(): CalendarEvent[] {
  const events: CalendarEvent[] = []
  MOCK_MEETINGS.forEach((m: any) => {
    events.push({ id: `meeting-${m.id}`, type: "meeting", title: m.title, start: new Date(m.date), durationMin: durationFromString(m.duration), source: m })
  })
  MOCK_TASKS.forEach((t: any) => {
    const d = parseDueDate(t.dueDate)
    if (!d) return
    events.push({ id: `task-${t.id}`, type: "task", title: t.title, start: d, durationMin: 30, source: t })
  })
  MOCK_CRON_JOBS.forEach((c: any, idx: number) => {
    const base = addDays(TODAY, idx % 5)
    const start = parseCronNextRun(c.nextRun || "10:00 AM", base)
    events.push({ id: `cron-${c.id}`, type: "cron", title: c.name, start, durationMin: 15, source: c })
  })
  MOCK_AGENT_JOBS.forEach((a: any) => {
    events.push({ id: `agent-${a.id}`, type: "agent", title: a.instruction, start: new Date(a.created), durationMin: 30, source: a })
  })
  return events
}

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7)

function formatHour(h: number) {
  if (h === 12) return "12 PM"
  return h > 12 ? `${h - 12} PM` : `${h} AM`
}

// ─── Mini month picker ────────────────────────────────────────────
function MiniMonth({ anchor, selected, onSelect }: { anchor: Date; selected: Date; onSelect: (d: Date) => void }) {
  const [cursor, setCursor] = useState(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
  const firstDay = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const startGrid = startOfWeek(firstDay)
  const days: Date[] = Array.from({ length: 42 }, (_, i) => addDays(startGrid, i))
  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button
          className="p-1 rounded text-ink-muted hover:bg-surface-2"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-medium tracking-wide">{monthLabel}</span>
        <button
          className="p-1 rounded text-ink-muted hover:bg-surface-2"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 text-[10px] text-ink-faint text-center mb-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i}>{d}</div>)}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth()
          const isSelected = isSameDay(d, selected)
          const isToday = isSameDay(d, TODAY)
          return (
            <button
              key={i}
              onClick={() => onSelect(d)}
              className={`aspect-square text-[11px] rounded-md flex items-center justify-center transition-colors ${
                isSelected ? "bg-moss text-surface font-semibold"
                : isToday   ? "bg-moss-soft text-moss font-medium"
                : inMonth   ? "text-ink hover:bg-surface-2"
                :              "text-ink-faint hover:bg-surface-2"
              }`}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── Event block ─────────────────────────────────────────────────
function EventBlock({ event, onClick, variant }: { event: CalendarEvent; onClick: () => void; variant: "week" | "day" | "month" }) {
  const style = TYPE_STYLES[event.type]
  const Icon = style.icon
  const timeLabel = event.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

  if (variant === "month") {
    return (
      <button
        onClick={onClick}
        className={`w-full text-left flex items-center gap-1 px-1 py-0.5 rounded text-[10px] ${style.bg} ${style.text} truncate`}
      >
        <span className={`w-1 h-1 rounded-full ${style.dot} shrink-0`} />
        <span className="truncate">{event.title}</span>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className={`block w-full text-left rounded-md ${style.bg} overflow-hidden hover:shadow-sm transition-shadow`}
      style={{ borderLeft: `2px solid ${style.borderColor}`, padding: "3px 6px" }}
    >
      <div className={`flex items-center gap-1 text-[10px] font-medium ${style.text}`}>
        <Icon size={10} />
        <span className="font-mono">{timeLabel}</span>
      </div>
      <div className="text-[11px] font-medium text-ink mt-0.5 truncate leading-tight">{event.title}</div>
    </button>
  )
}

// ─── Week view ───────────────────────────────────────────────────
function WeekView({ anchor, events, onEventClick }: { anchor: Date; events: CalendarEvent[]; onEventClick: (e: CalendarEvent) => void }) {
  const start = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="min-w-[720px]">
      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b border-border bg-surface sticky top-0 z-10">
        <div />
        {days.map((d) => {
          const isToday = isSameDay(d, TODAY)
          return (
            <div key={d.toISOString()} className={`text-center py-2 border-l border-border-faint ${isToday ? "bg-moss-soft/50" : ""}`}>
              <div className="text-[10px] uppercase tracking-wider text-ink-muted font-medium">
                {d.toLocaleDateString(undefined, { weekday: "short" })}
              </div>
              <div className={`font-serif text-lg ${isToday ? "text-moss font-medium" : "text-ink"}`}>{d.getDate()}</div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]">
        {HOURS.map((h) => (
          <Fragment key={h}>
            <div className="text-[10px] text-ink-faint text-right pr-2 pt-1 border-t border-border-faint h-16">
              {formatHour(h)}
            </div>
            {days.map((d) => {
              const cellEvents = events.filter((e) => isSameDay(e.start, d) && e.start.getHours() === h)
              return (
                <div key={`${d.toISOString()}-${h}`} className="border-t border-l border-border-faint h-16 p-0.5 space-y-0.5">
                  {cellEvents.map((ev) => (
                    <EventBlock key={ev.id} event={ev} onClick={() => onEventClick(ev)} variant="week" />
                  ))}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

// ─── Day view ────────────────────────────────────────────────────
function DayView({ events, onEventClick }: { events: CalendarEvent[]; onEventClick: (e: CalendarEvent) => void }) {
  return (
    <div className="max-w-3xl mx-auto">
      <div className="grid grid-cols-[60px_1fr]">
        {HOURS.map((h) => {
          const hourEvents = events.filter((e) => e.start.getHours() === h)
          return (
            <Fragment key={h}>
              <div className="text-[10px] text-ink-faint text-right pr-2 pt-1 border-t border-border-faint h-20">
                {formatHour(h)}
              </div>
              <div className="border-t border-l border-border-faint h-20 p-1 space-y-1">
                {hourEvents.map((ev) => (
                  <EventBlock key={ev.id} event={ev} onClick={() => onEventClick(ev)} variant="day" />
                ))}
              </div>
            </Fragment>
          )
        })}
      </div>
      {events.length === 0 && (
        <div className="text-center py-12 text-sm text-ink-muted italic">Nothing scheduled.</div>
      )}
    </div>
  )
}

// ─── Month view ──────────────────────────────────────────────────
function MonthView({ anchor, events, onEventClick, onDayClick }: { anchor: Date; events: CalendarEvent[]; onEventClick: (e: CalendarEvent) => void; onDayClick: (d: Date) => void }) {
  const firstDay = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const startGrid = startOfWeek(firstDay)
  const days = Array.from({ length: 42 }, (_, i) => addDays(startGrid, i))

  return (
    <div className="p-2 sm:p-4">
      <div className="grid grid-cols-7 gap-px bg-border-faint rounded-lg overflow-hidden border border-border-faint">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-surface text-[10px] uppercase tracking-wider text-ink-muted font-medium text-center py-2">{d}</div>
        ))}
        {days.map((d) => {
          const inMonth = d.getMonth() === anchor.getMonth()
          const isToday = isSameDay(d, TODAY)
          const dayEvents = events.filter((e) => isSameDay(e.start, d)).sort((a, b) => a.start.getTime() - b.start.getTime())
          return (
            <div
              key={d.toISOString()}
              className={`bg-surface min-h-[90px] p-1 flex flex-col gap-0.5 cursor-pointer hover:bg-surface-2/50 transition-colors ${!inMonth ? "opacity-50" : ""}`}
              onClick={() => onDayClick(d)}
            >
              <div className={`text-[11px] font-medium self-end mb-0.5 ${isToday ? "bg-moss text-surface w-5 h-5 rounded-full flex items-center justify-center" : "text-ink-muted pr-1"}`}>
                {d.getDate()}
              </div>
              <div className="flex flex-col gap-0.5 overflow-hidden">
                {dayEvents.slice(0, 3).map((ev) => (
                  <div key={ev.id} onClick={(e) => { e.stopPropagation(); onEventClick(ev) }}>
                    <EventBlock event={ev} onClick={() => onEventClick(ev)} variant="month" />
                  </div>
                ))}
                {dayEvents.length > 3 && (
                  <span className="text-[9px] text-ink-faint pl-1">+{dayEvents.length - 3} more</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Add Event Modal ─────────────────────────────────────────────
function AddEventModal({ defaultDate, onClose }: { defaultDate: Date; onClose: () => void }) {
  const dateStr = defaultDate.toISOString().slice(0, 10)
  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-lg overflow-hidden border border-border">
        <div className="p-4 border-b border-border flex justify-between items-center bg-canvas">
          <h2 className="font-serif text-lg font-medium">New Event</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={20} /></button>
        </div>

        <div className="p-4 space-y-4">
          <div className="flex gap-1.5">
            <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium border bg-amber-soft text-amber" style={{ borderColor: "rgba(184,101,26,0.3)" }}>
              <CheckSquare size={12} /> Task
            </span>
          </div>
          <textarea
            placeholder="What needs to get done?"
            rows={3}
            className="w-full bg-canvas border border-border rounded-md px-4 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-moss focus:ring-1 focus:ring-moss resize-none"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-1">Due Date</label>
              <input type="date" defaultValue={dateStr} className="w-full bg-canvas border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-moss focus:ring-1 focus:ring-moss" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-1">Priority</label>
              <select className="w-full bg-canvas border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-moss">
                <option>Normal</option>
                <option>High</option>
                <option>Urgent</option>
                <option>Low</option>
              </select>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-border bg-canvas flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button onClick={onClose} className="btn-primary text-sm" style={{ padding: "0.375rem 0.875rem" }}>Create Task</button>
        </div>
      </div>
    </div>
  )
}

// ─── Event detail panel ──────────────────────────────────────────
function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const router = useRouter()
  const style = TYPE_STYLES[event.type]
  const Icon = style.icon

  const viewRoutes: Record<string, string> = {
    meeting: "/meetings",
    task: "/tasks",
    cron: "/cron",
    agent: "/agent-jobs",
  }

  return (
    <div className="w-[300px] border-l flex flex-col shrink-0 overflow-y-auto" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: "#d8d2c4" }}>
        <span className={`badge ${style.bg} ${style.text} flex items-center gap-1 text-[11px]`}>
          <Icon size={11} /> {style.label}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-md"
          style={{ color: "#6b6357" }}
          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
        >
          <X size={15} />
        </button>
      </div>

      <div className="p-4 space-y-4">
        <div>
          <h2 className="font-semibold text-sm text-[#1a1714] leading-snug" style={{ fontFamily: "var(--font-heading), serif" }}>
            {event.title}
          </h2>
          <p className="text-xs text-[#6b6357] mt-1">
            {event.start.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            {" · "}
            {event.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </p>
        </div>

        <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "#efeadf", border: "1px solid #e8e2d4" }}>
          {event.type === "meeting" && <>
            <Row label="Duration" value={event.source.duration} />
            <Row label="Source"   value={event.source.source} />
            <Row label="Attendees" value={String(event.source.attendees?.length || 0)} />
          </>}
          {event.type === "task" && <>
            <Row label="Status"   value={event.source.status} />
            <Row label="Priority" value={event.source.priority} />
            <Row label="Source"   value={event.source.source} />
          </>}
          {event.type === "cron" && <>
            <Row label="Schedule" value={event.source.schedule} />
            <Row label="Last Run" value={event.source.lastRun} />
          </>}
          {event.type === "agent" && <>
            <Row label="Status"   value={event.source.status} />
            <Row label="Context"  value={event.source.context} />
            <Row label="Duration" value={event.source.duration} />
          </>}
        </div>

        {event.type === "meeting" && event.source.summary && (
          <div>
            <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-1">Summary</div>
            <p className="text-xs text-[#1a1714] leading-relaxed">{event.source.summary}</p>
          </div>
        )}

        <button
          onClick={() => router.push(viewRoutes[event.type] || "/")}
          className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
        >
          View details <ArrowRight size={14} />
        </button>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-[#6b6357]">{label}</span>
      <span className="font-medium text-[#1a1714] capitalize">{value}</span>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("week")
  const [anchor, setAnchor] = useState<Date>(TODAY)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)

  const events = useMemo(() => buildEvents(), [])
  const eventsForDay = (d: Date) => events.filter((e) => isSameDay(e.start, d)).sort((a, b) => a.start.getTime() - b.start.getTime())

  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStart.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - touchStart.current.x
    const dy = t.clientY - touchStart.current.y
    touchStart.current = null
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      setAnchor(a => addDays(a, dx < 0 ? 1 : -1))
    }
  }

  const headerLabel = useMemo(() => {
    if (viewMode === "month") return anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
    if (viewMode === "day") return anchor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    const start = startOfWeek(anchor)
    const end = addDays(start, 6)
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
  }, [anchor, viewMode])

  const onPrev = () => {
    if (viewMode === "day") setAnchor(a => addDays(a, -1))
    else if (viewMode === "week") setAnchor(a => addDays(a, -7))
    else setAnchor(a => { const n = new Date(a); n.setMonth(n.getMonth() - 1); return n })
  }
  const onNext = () => {
    if (viewMode === "day") setAnchor(a => addDays(a, 1))
    else if (viewMode === "week") setAnchor(a => addDays(a, 7))
    else setAnchor(a => { const n = new Date(a); n.setMonth(n.getMonth() + 1); return n })
  }

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas">
      {/* Left sidebar: mini month + legend */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-border bg-surface p-4 gap-6 overflow-y-auto">
        <MiniMonth anchor={anchor} selected={anchor} onSelect={(d) => setAnchor(d)} />

        <div>
          <h3 className="text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-2">Legend</h3>
          <div className="space-y-1.5">
            {(["meeting", "task", "cron", "agent"] as EventType[]).map((t) => {
              const s = TYPE_STYLES[t]
              const Icon = s.icon
              return (
                <div key={t} className="flex items-center gap-2 text-xs text-ink">
                  <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                  <Icon size={12} className="text-ink-muted" />
                  <span>{s.label}s</span>
                </div>
              )
            })}
          </div>
        </div>
      </aside>

      {/* Main calendar */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-border bg-surface shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <CalendarIcon size={20} className="text-moss shrink-0" />
              <h1 className="font-serif text-xl sm:text-2xl font-medium truncate" style={{ fontFamily: "var(--font-heading), serif" }}>
                {headerLabel}
              </h1>
            </div>
            <button onClick={() => setIsAddOpen(true)} className="btn-primary flex items-center gap-1.5 text-sm" style={{ padding: "0.35rem 0.75rem" }}>
              <Plus size={14} /> <span className="hidden sm:inline">Event</span>
            </button>
          </div>

          <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <button onClick={onPrev} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-2">
                <ChevronLeft size={16} />
              </button>
              <button onClick={() => setAnchor(TODAY)} className="text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-surface-2 transition-colors">
                Today
              </button>
              <button onClick={onNext} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-2">
                <ChevronRight size={16} />
              </button>
            </div>

            <div className="flex items-center gap-0.5 bg-surface-2 p-0.5 rounded-md border border-border-faint">
              {(["month", "week", "day"] as ViewMode[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setViewMode(v)}
                  className={`px-3 py-1 rounded text-xs font-medium capitalize transition-colors ${viewMode === v ? "bg-surface text-ink shadow-sm" : "text-ink-muted hover:text-ink"}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-auto"
          onTouchStart={viewMode === "day" ? onTouchStart : undefined}
          onTouchEnd={viewMode === "day" ? onTouchEnd : undefined}
        >
          {viewMode === "week" && <WeekView anchor={anchor} events={events} onEventClick={setSelectedEvent} />}
          {viewMode === "day" && <DayView events={eventsForDay(anchor)} onEventClick={setSelectedEvent} />}
          {viewMode === "month" && (
            <MonthView
              anchor={anchor}
              events={events}
              onEventClick={setSelectedEvent}
              onDayClick={(d) => { setAnchor(d); setViewMode("day") }}
            />
          )}
        </div>
      </div>

      {/* Right panel */}
      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}

      {/* Add event modal */}
      {isAddOpen && <AddEventModal defaultDate={anchor} onClose={() => setIsAddOpen(false)} />}
    </div>
  )
}
