"use client"

/**
 * SelectionToolbar — floating action bar on text selection anywhere in the app.
 *
 * Mount once in the app layout. Scope is controlled via [data-selectable] on
 * any content area that should trigger it (meetings, tasks, second brain, chat).
 *
 * Detection engine analyses the selected text and surfaces contextual actions:
 *
 *   Always:
 *     Copy · Task · Second Brain / Save snippet
 *
 *   Contextual (detected from selection):
 *     URL found      → Open URL
 *     Email found    → Compose (mailto)
 *     Date/time      → Add to Calendar (inline form, pre-filled)
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import {
  Copy, Check, CheckSquare, BookOpen, Calendar,
  Loader2, ExternalLink, Mail, ChevronDown,
} from "lucide-react"
import { apiPost } from "@/lib/api-client"

// ══════════════════════════════════════════════════════════════
// DETECTION ENGINE
// ══════════════════════════════════════════════════════════════

const URL_RE = /https?:\/\/[^\s<>"')\]]+/i
const EMAIL_RE = /\b[\w.+\-]+@[\w\-]+\.[a-zA-Z]{2,}\b/
const CODE_RE = /(?:[{};()=>]|function\s+\w|const\s+\w|import\s+|class\s+\w|\$\(|npm\s+|git\s+|curl\s+)/
const DATE_RE = /\b(tomorrow|today|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+|this\s+\w+|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?|\d{1,2}(st|nd|rd|th))\b/i
const TIME_RE = /\b(\d{1,2}(:\d{2})?\s*(am|pm))\b|\b(noon|midnight)\b/i

const MONTH_MAP: Record<string, number> = {
  january:1,february:2,march:3,april:4,may:5,june:6,
  july:7,august:8,september:9,october:10,november:11,december:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
}
const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]

function parseDateFromText(text: string): string {
  const t = text.toLowerCase()
  const today = new Date()

  if (/\btoday\b/.test(t))
    return today.toISOString().split("T")[0]

  if (/\btomorrow\b/.test(t)) {
    const d = new Date(today); d.setDate(d.getDate() + 1)
    return d.toISOString().split("T")[0]
  }

  for (let i = 0; i < DAYS.length; i++) {
    if (new RegExp(`\\b(next\\s+)?${DAYS[i]}\\b`).test(t)) {
      const d = new Date(today)
      const diff = (i - today.getDay() + 7) % 7 || 7
      d.setDate(d.getDate() + diff)
      return d.toISOString().split("T")[0]
    }
  }

  // Month name + day  e.g. "June 15" or "15 June"
  const monthNames = Object.keys(MONTH_MAP).join("|")
  let m = t.match(new RegExp(`(${monthNames})\\s+(\\d{1,2})`))
  if (!m) m = t.match(new RegExp(`(\\d{1,2})\\s+(${monthNames})`))
  if (m) {
    const monthStr = m[1].toLowerCase() in MONTH_MAP ? m[1].toLowerCase() : m[2]?.toLowerCase()
    const dayStr = m[1].match(/\d/) ? m[1] : m[2]
    if (monthStr && dayStr) {
      const month = MONTH_MAP[monthStr]
      const day = parseInt(dayStr)
      if (month && day >= 1 && day <= 31) {
        const year = today.getFullYear()
        return `${year}-${month.toString().padStart(2,"0")}-${day.toString().padStart(2,"0")}`
      }
    }
  }

  // MM/DD or MM-DD
  const slash = t.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/)
  if (slash) {
    const mo = parseInt(slash[1]), dy = parseInt(slash[2])
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31)
      return `${today.getFullYear()}-${mo.toString().padStart(2,"0")}-${dy.toString().padStart(2,"0")}`
  }

  return ""
}

function parseTimeFromText(text: string): string {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (m) {
    let h = parseInt(m[1])
    const min = m[2] ? parseInt(m[2]) : 0
    const ap = m[3].toLowerCase()
    if (ap === "pm" && h !== 12) h += 12
    if (ap === "am" && h === 12) h = 0
    return `${h.toString().padStart(2,"0")}:${min.toString().padStart(2,"0")}`
  }
  if (/\bnoon\b/i.test(text)) return "12:00"
  if (/\bmidnight\b/i.test(text)) return "00:00"
  return ""
}

interface SelectionContext {
  url:      string | null
  email:    string | null
  dateStr:  string         // YYYY-MM-DD or ""
  timeStr:  string         // HH:MM or ""
  hasDate:  boolean
  isCode:   boolean
}

function analyzeSelection(text: string): SelectionContext {
  const urlMatch  = text.match(URL_RE)
  const mailMatch = text.match(EMAIL_RE)
  const hasDate   = DATE_RE.test(text) || TIME_RE.test(text)
  return {
    url:     urlMatch  ? urlMatch[0]  : null,
    email:   mailMatch ? mailMatch[0] : null,
    dateStr: parseDateFromText(text),
    timeStr: parseTimeFromText(text),
    hasDate,
    isCode:  CODE_RE.test(text),
  }
}

// ══════════════════════════════════════════════════════════════
// POSITION HELPERS
// ══════════════════════════════════════════════════════════════

interface Pos { x: number; y: number; yBottom: number }

const TOOLBAR_HALF_W = 150

function getSelectionPos(range: Range): Pos {
  const rect = range.getBoundingClientRect()
  const vw   = window.innerWidth
  const cx   = rect.left + rect.width / 2
  return {
    x:       Math.max(TOOLBAR_HALF_W, Math.min(vw - TOOLBAR_HALF_W, cx)),
    y:       rect.top    - 8,
    yBottom: rect.bottom + 8,
  }
}

// ══════════════════════════════════════════════════════════════
// ACTION BUTTON
// ══════════════════════════════════════════════════════════════

function Action({
  icon: Icon,
  label,
  onClick,
  active,
  accent,
  chevron,
}: {
  icon:     React.ElementType
  label:    string
  onClick:  () => void | Promise<void>
  active?:  boolean
  accent?:  boolean
  chevron?: boolean
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle")

  const handle = async () => {
    if (state !== "idle") return
    const res = onClick()
    if (res instanceof Promise) {
      setState("loading")
      try { await res; setState("done") }
      catch { setState("idle") }
    }
  }

  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={handle}
      disabled={state === "loading"}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors"
      style={{
        color: state === "done"
          ? "#4ade80"
          : accent
            ? "#a7f3d0"
            : active
              ? "#fff"
              : "#d4cfc8",
        backgroundColor: active ? "rgba(255,255,255,0.08)" : "transparent",
        opacity: state === "loading" ? 0.6 : 1,
      }}
    >
      {state === "loading" ? <Loader2 size={11} className="animate-spin" />
       : state === "done"  ? <Check size={11} />
       :                     <Icon size={11} />}
      {state === "done" ? "Done" : label}
      {chevron && state === "idle" && <ChevronDown size={9} style={{ opacity: 0.6, marginLeft: 1 }} />}
    </button>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 14, backgroundColor: "#2e2e2e", margin: "0 1px" }} />
}

// ══════════════════════════════════════════════════════════════
// CALENDAR INLINE FORM
// ══════════════════════════════════════════════════════════════

function CalendarForm({
  text,
  dateStr,
  timeStr,
  pos,
  onDone,
  onCancel,
}: {
  text:    string
  dateStr: string
  timeStr: string
  pos:     Pos
  onDone:  () => void
  onCancel:() => void
}) {
  const [title,    setTitle]    = useState(text.slice(0, 80).replace(/\n/g," ").trim())
  const [date,     setDate]     = useState(dateStr)
  const [time,     setTime]     = useState(timeStr)
  const [duration, setDuration] = useState("60")
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const ref = useRef<HTMLDivElement>(null)


  const save = async () => {
    if (!date || !time) return
    setSaving(true)
    try {
      const start = new Date(`${date}T${time}`).toISOString()
      await apiPost("/calendar/events", {
        title,
        start,
        duration_min: parseInt(duration) || 60,
      })
      setSaved(true)
      setTimeout(onDone, 800)
    } catch { setSaving(false) }
  }

  return createPortal(
    <div
      ref={ref}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position:  "fixed",
        left:      pos.x,
        top:       pos.yBottom,
        transform: "translateX(-50%)",
        zIndex:    9999,
        width:     280,
      }}
    >
      {/* Arrow */}
      <div style={{
        width:0, height:0, margin:"0 auto 4px",
        borderLeft:"5px solid transparent",
        borderRight:"5px solid transparent",
        borderBottom:"5px solid #2a2a2a",
      }}/>
      <div
        className="rounded-xl shadow-xl p-3 space-y-2"
        style={{ backgroundColor: "#1a1a1a", border: "1px solid #2a2a2a" }}
      >
        {saved ? (
          <div className="flex items-center gap-2 justify-center py-2 text-xs" style={{ color: "#4ade80" }}>
            <Check size={13} /> Added to calendar
          </div>
        ) : (
          <>
            <div>
              <label className="block text-[10px] mb-1" style={{ color: "#888" }}>Event title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg outline-none"
                style={{ backgroundColor: "#242424", border: "1px solid #333", color: "#e5e0d8" }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "#888" }}>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                  style={{ backgroundColor: "#242424", border: "1px solid #333", color: "#e5e0d8", colorScheme: "dark" }}
                />
              </div>
              <div>
                <label className="block text-[10px] mb-1" style={{ color: "#888" }}>Time</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                  style={{ backgroundColor: "#242424", border: "1px solid #333", color: "#e5e0d8", colorScheme: "dark" }}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] mb-1" style={{ color: "#888" }}>Duration (min)</label>
              <input
                type="number"
                value={duration}
                min={15} step={15}
                onChange={(e) => setDuration(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg outline-none"
                style={{ backgroundColor: "#242424", border: "1px solid #333", color: "#e5e0d8" }}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={save}
                disabled={saving || !date || !time}
                className="flex-1 text-xs py-1.5 rounded-lg font-medium disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: "#2d5a4f", color: "#fff" }}
              >
                {saving ? "Adding…" : "Add to Calendar"}
              </button>
              <button
                onClick={onCancel}
                className="text-xs px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: "#2a2a2a", color: "#888" }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}

// ══════════════════════════════════════════════════════════════
// TOOLBAR PILL
// ══════════════════════════════════════════════════════════════

function Toolbar({
  text,
  pos,
  onDismiss,
}: {
  text:      string
  pos:       Pos
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [calOpen, setCalOpen] = useState(false)
  const ctx = analyzeSelection(text)


  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setTimeout(onDismiss, 800)
  }, [text, onDismiss])

  const createTask = useCallback(async () => {
    const title = text.replace(/\s+/g," ").trim()
    const path = typeof window !== "undefined" ? window.location.pathname : ""
    const source = path.startsWith("/meetings") ? "meeting"
      : path.startsWith("/second-brain") ? "second-brain"
      : path.startsWith("/tasks") ? "manual"
      : "chat"
    await apiPost("/tasks", {
      title: title.length > 120 ? title.slice(0,117)+"…" : title,
      priority: "normal",
      source,
    })
    setTimeout(onDismiss, 800)
  }, [text, onDismiss])

  const saveKnowledge = useCallback(async () => {
    await apiPost(
      ctx.url ? "/second-brain/ingest/url" : "/second-brain/ingest/text",
      ctx.url
        ? { url: ctx.url, tags: ["chat","highlight"], domain: "work" }
        : {
            content: text,
            title: text.replace(/\s+/g," ").split(" ").slice(0,8).join(" "),
            tags: ctx.isCode ? ["code","snippet","chat"] : ["chat","highlight"],
            domain: "work",
          }
    )
    setTimeout(onDismiss, 800)
  }, [text, ctx, onDismiss])

  return createPortal(
    <>
      {/* Pill */}
      <div
        ref={ref}
        onMouseDown={(e) => e.preventDefault()}
        style={{
          position:  "fixed",
          left:      pos.x,
          top:       pos.y,
          transform: "translate(-50%, -100%)",
          zIndex:    9999,
        }}
      >
        <div
          className="flex items-center rounded-xl shadow-2xl"
          style={{
            backgroundColor: "#1a1a1a",
            border:  "1px solid #2e2e2e",
            padding: "3px 5px",
            gap:     "1px",
          }}
        >
          {/* ── Copy ───────────────────────────────── */}
          <Action icon={Copy} label="Copy" onClick={copy} />

          <Divider />

          {/* ── Save ────────────────────────────────── */}
          <Action icon={CheckSquare} label="Task"         onClick={createTask}    />
          <Action
            icon={BookOpen}
            label={ctx.isCode ? "Save snippet" : "Second Brain"}
            onClick={saveKnowledge}
          />

          {/* ── Contextual ─────────────────────────── */}
          {(ctx.url || ctx.email || ctx.hasDate || ctx.isCode) && <Divider />}

          {/* URL → Open */}
          {ctx.url && (
            <Action
              icon={ExternalLink}
              label="Open"
              accent
              onClick={() => { window.open(ctx.url!, "_blank", "noopener"); onDismiss() }}
            />
          )}

          {/* Email → Compose */}
          {ctx.email && (
            <Action
              icon={Mail}
              label="Compose"
              accent
              onClick={() => { window.location.href = `mailto:${ctx.email}`; onDismiss() }}
            />
          )}

          {/* Date/time → Calendar form */}
          {ctx.hasDate && !calOpen && (
            <Action
              icon={Calendar}
              label="Calendar"
              accent
              chevron
              active={calOpen}
              onClick={() => setCalOpen(true)}
            />
          )}
          {ctx.hasDate && calOpen && (
            <Action
              icon={Calendar}
              label="Calendar"
              accent
              active
              onClick={() => setCalOpen(false)}
            />
          )}

          {/* Code snippets handled by the BookOpen "Save snippet" button above */}
        </div>

        {/* Caret */}
        <div style={{
          position:"absolute", bottom:-5, left:"50%",
          transform:"translateX(-50%)",
          width:0, height:0,
          borderLeft:"5px solid transparent",
          borderRight:"5px solid transparent",
          borderTop:"5px solid #2e2e2e",
        }}/>
      </div>

      {/* Calendar form — anchored below the selection */}
      {calOpen && (
        <CalendarForm
          text={text}
          dateStr={ctx.dateStr}
          timeStr={ctx.timeStr}
          pos={pos}
          onDone={() => { setCalOpen(false); onDismiss() }}
          onCancel={() => setCalOpen(false)}
        />
      )}
    </>,
    document.body
  )
}

// ══════════════════════════════════════════════════════════════
// GLOBAL LISTENER
// ══════════════════════════════════════════════════════════════

export function SelectionToolbar() {
  const [selection, setSelection] = useState<{ text: string; pos: Pos } | null>(null)

  const dismiss = useCallback(() => setSelection(null), [])

  useEffect(() => {
    function onMouseUp() {
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) return
        const text = sel.toString().trim()
        if (text.length < 2) return

        const range = sel.getRangeAt(0)
        const node  = range.commonAncestorContainer
        const el    = node.nodeType === 1 ? (node as Element) : node.parentElement
        if (!el?.closest("[data-selectable]")) return

        setSelection({ text, pos: getSelectionPos(range) })
      }, 10)
    }

    function onMouseDown(e: MouseEvent) {
      if (!(e.target as Element).closest("[data-selection-toolbar]")) dismiss()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss()
    }

    document.addEventListener("mouseup",   onMouseUp)
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown",   onKeyDown)
    document.addEventListener("scroll",    dismiss, { capture: true })

    return () => {
      document.removeEventListener("mouseup",   onMouseUp)
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown",   onKeyDown)
      document.removeEventListener("scroll",    dismiss, { capture: true })
    }
  }, [dismiss])

  if (!selection) return null

  return (
    <div data-selection-toolbar>
      <Toolbar text={selection.text} pos={selection.pos} onDismiss={dismiss} />
    </div>
  )
}
