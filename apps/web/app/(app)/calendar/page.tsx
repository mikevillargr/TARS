"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState, Fragment } from "react"
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
  Loader2,
  RefreshCw,
} from "lucide-react"
import { apiGet, apiPost } from "@/lib/api-client"

type ViewMode = "month" | "week" | "day"
type EventType = "gcal" | "meeting" | "task" | "cron" | "agent"

interface CalendarEventOut {
  id: string
  type: string
  title: string
  start: string
  end: string | null
  duration_min: number
  all_day: boolean
  location: string | null
  attendees: string[]
  source_id: string | null
  description: string | null
}

interface CalendarEvent {
  id: string
  type: EventType
  title: string
  start: Date
  durationMin: number
  source: CalendarEventOut
}

const TYPE_STYLES: Record<EventType, { dot: string; bg: string; text: string; borderColor: string; icon: React.ElementType; label: string }> = {
  gcal:    { dot: "bg-moss",       bg: "bg-moss-soft",   text: "text-moss",      borderColor: "#2d5a4f", icon: CalendarIcon, label: "Calendar" },
  meeting: { dot: "bg-moss",       bg: "bg-moss-soft",   text: "text-moss",      borderColor: "#2d5a4f", icon: Video,        label: "Meeting"  },
  task:    { dot: "bg-amber",      bg: "bg-amber-soft",  text: "text-amber",     borderColor: "#b8651a", icon: CheckSquare,  label: "Task"     },
  cron:    { dot: "bg-ink-muted",  bg: "bg-surface-2",   text: "text-ink",       borderColor: "#6b6357", icon: ClockIcon,    label: "Cron Job" },
  agent:   { dot: "bg-rose",       bg: "bg-rose-soft",   text: "text-rose",      borderColor: "#a04848", icon: Cpu,          label: "Agent Job"},
}

const TODAY = new Date()

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

function getDateRange(mode: ViewMode, anchor: Date): { start: Date; end: Date } {
  if (mode === "day") {
    const s = new Date(anchor); s.setHours(0, 0, 0, 0)
    return { start: s, end: addDays(s, 1) }
  }
  if (mode === "week") {
    const s = startOfWeek(anchor)
    return { start: s, end: addDays(s, 7) }
  }
  const firstDay = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const s = startOfWeek(firstDay)
  return { start: s, end: addDays(s, 42) }
}

function fromApi(e: CalendarEventOut): CalendarEvent | null {
  if (!e.start) return null
  const start = new Date(e.start)
  if (isNaN(start.getTime())) return null
  return {
    id: e.id,
    type: e.type as EventType,
    title: e.title,
    start,
    durationMin: e.duration_min,
    source: e,
  }
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

function formatHour(h: number) {
  if (h === 0) return "12 AM"
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
        <button className="p-1 rounded text-ink-muted hover:bg-surface-2" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
          <ChevronLeft size={14} />
        </button>
        <span className="text-xs font-medium tracking-wide">{monthLabel}</span>
        <button className="p-1 rounded text-ink-muted hover:bg-surface-2" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
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
  const style = TYPE_STYLES[event.type] ?? TYPE_STYLES.gcal
  const Icon = style.icon
  const timeLabel = event.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

  if (variant === "month") {
    return (
      <button onClick={onClick} className={`w-full text-left flex items-center gap-1 px-1 py-0.5 rounded text-[10px] ${style.bg} ${style.text} truncate`}>
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
function AddEventModal({ defaultDate, onClose, onCreated }: { defaultDate: Date; onClose: () => void; onCreated: () => void }) {
  const pad = (n: number) => String(n).padStart(2, "0")
  const defaultDateStr = `${defaultDate.getFullYear()}-${pad(defaultDate.getMonth() + 1)}-${pad(defaultDate.getDate())}`

  const [title, setTitle] = useState("")
  const [date, setDate] = useState(defaultDateStr)
  const [startTime, setStartTime] = useState("09:00")
  const [durationMin, setDurationMin] = useState(60)
  const [location, setLocation] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    setError("")
    try {
      await apiPost("/calendar/events", {
        title: title.trim(),
        start: `${date}T${startTime}:00`,
        duration_min: durationMin,
        location: location.trim() || undefined,
      })
      onCreated()
      onClose()
    } catch {
      setError("Failed to create event. Is Google Calendar connected?")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-md overflow-hidden border border-border">
        <div className="p-4 border-b border-border flex justify-between items-center bg-canvas">
          <h2 className="font-serif text-lg font-medium">New Calendar Event</h2>
          <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={20} /></button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-1">Title</label>
            <input
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()}
              placeholder="Event title"
              className="input-field w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-field w-full" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-1">Time</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="input-field w-full" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-1">Duration</label>
              <select value={durationMin} onChange={e => setDurationMin(Number(e.target.value))} className="input-field w-full">
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-1">Location</label>
              <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Optional" className="input-field w-full" />
            </div>
          </div>
          {error && <p className="text-xs" style={{ color: "#a04848" }}>{error}</p>}
        </div>
        <div className="p-4 border-t border-border bg-canvas flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
          <button onClick={submit} disabled={saving || !title.trim()} className="btn-primary text-sm disabled:opacity-50" style={{ padding: "0.375rem 0.875rem" }}>
            {saving ? "Creating…" : "Create Event"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Event detail panel ──────────────────────────────────────────
function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const router = useRouter()
  const style = TYPE_STYLES[event.type] ?? TYPE_STYLES.gcal
  const Icon = style.icon

  const viewRoutes: Partial<Record<EventType, string>> = {
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
        <button onClick={onClose} className="p-1 rounded-md" style={{ color: "#6b6357" }}
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
            {!event.source.all_day && (
              <> · {event.start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</>
            )}
          </p>
        </div>

        <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "#efeadf", border: "1px solid #e8e2d4" }}>
          {(event.type === "gcal" || event.type === "meeting") && <>
            {event.source.duration_min && <Row label="Duration" value={`${event.source.duration_min}m`} />}
            {event.source.location && <Row label="Location" value={event.source.location} />}
            {event.source.attendees?.length > 0 && <Row label="Attendees" value={String(event.source.attendees.length)} />}
          </>}
          {event.type === "task" && <>
            <Row label="Type" value="Task due date" />
            {event.source.description && <Row label="Notes" value={event.source.description.slice(0, 60)} />}
          </>}
        </div>

        {event.source.attendees?.length > 0 && (
          <div>
            <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-1">Attendees</div>
            <div className="space-y-1">
              {event.source.attendees.map((a, i) => (
                <p key={i} className="text-xs text-[#1a1714]">{a}</p>
              ))}
            </div>
          </div>
        )}

        {event.source.description && (
          <div>
            <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-1">
              {event.type === "meeting" ? "Summary" : "Description"}
            </div>
            <p className="text-xs text-[#1a1714] leading-relaxed">{event.source.description.slice(0, 300)}</p>
          </div>
        )}

        {viewRoutes[event.type] && (
          <button
            onClick={() => router.push(viewRoutes[event.type]!)}
            className="btn-secondary w-full flex items-center justify-center gap-2 text-sm"
          >
            View details <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-[#6b6357]">{label}</span>
      <span className="font-medium text-[#1a1714]">{value}</span>
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────
export default function CalendarPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("week")
  const [anchor, setAnchor] = useState<Date>(TODAY)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchEvents = useCallback(async (mode: ViewMode, anc: Date) => {
    const range = getDateRange(mode, anc)
    setLoading(true)
    try {
      const data = await apiGet<CalendarEventOut[]>(
        `/calendar/events?start=${range.start.toISOString()}&end=${range.end.toISOString()}`
      )
      setEvents(data.flatMap(e => { const ev = fromApi(e); return ev ? [ev] : [] }))
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchEvents(viewMode, anchor)
  }, [viewMode, anchor, fetchEvents])

  // Scroll to current hour when switching to/from week or day view
  useEffect(() => {
    if (viewMode === "month" || !scrollRef.current) return
    const hour = new Date().getHours()
    const rowHeight = viewMode === "week" ? 64 : 80 // h-16 / h-20
    const scrollTo = Math.max(0, (hour - 1) * rowHeight)
    scrollRef.current.scrollTop = scrollTo
  }, [viewMode])

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
      {/* Left sidebar */}
      <aside className="hidden lg:flex flex-col w-60 shrink-0 border-r border-border bg-surface p-4 gap-6 overflow-y-auto">
        <MiniMonth anchor={anchor} selected={anchor} onSelect={(d) => setAnchor(d)} />
        <div>
          <h3 className="text-[10px] uppercase tracking-wider text-ink-muted font-medium mb-2">Legend</h3>
          <div className="space-y-1.5">
            {(["gcal", "meeting", "task"] as EventType[]).map((t) => {
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
              {loading && <Loader2 size={14} className="animate-spin text-ink-muted shrink-0" />}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchEvents(viewMode, anchor)}
                title="Refresh"
                className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
              >
                <RefreshCw size={14} />
              </button>
              <button
                onClick={() => setIsAddOpen(true)}
                className="btn-primary flex items-center gap-1.5 text-sm"
                style={{ padding: "0.35rem 0.75rem" }}
              >
                <Plus size={14} /> <span className="hidden sm:inline">Event</span>
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <button onClick={onPrev} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-2">
                <ChevronLeft size={16} />
              </button>
              <button onClick={() => setAnchor(new Date(TODAY))} className="text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-surface-2 transition-colors">
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
          ref={scrollRef}
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

      {selectedEvent && <EventDetail event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
      {isAddOpen && (
        <AddEventModal
          defaultDate={anchor}
          onClose={() => setIsAddOpen(false)}
          onCreated={() => fetchEvents(viewMode, anchor)}
        />
      )}
    </div>
  )
}
