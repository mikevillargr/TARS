"use client"

import { useState, useMemo } from "react"
import { BookOpen, CheckSquare, Square, Check, Calendar, ChevronDown, ChevronUp, Loader2, X } from "lucide-react"
import { apiPost } from "@/lib/api-client"
import { analyzeContent, type CalendarHint } from "./contentAnalysis"

// ─── Bulk task chip ───────────────────────────────────────────────────────────

function BulkTasksChip({ items }: { items: string[] }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set(items.map((_, i) => i)))
  const [loading, setLoading] = useState(false)
  const [created, setCreated] = useState<number | null>(null)

  const toggle = (i: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  const toggleAll = () => {
    setSelected(selected.size === items.length ? new Set() : new Set(items.map((_, i) => i)))
  }

  const create = async () => {
    setLoading(true)
    let count = 0
    for (const i of selected) {
      try {
        await apiPost("/tasks", { title: items[i], priority: "normal", source: "chat" })
        count++
      } catch {}
    }
    setCreated(count)
    setLoading(false)
    setOpen(false)
  }

  if (created !== null) {
    return (
      <div
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl"
        style={{ backgroundColor: "#e3ede9", color: "#2d5a4f", border: "1px solid rgba(45,90,79,0.2)" }}
      >
        <Check size={11} />
        Created {created} {created === 1 ? "task" : "tasks"}
      </div>
    )
  }

  const numSelected = selected.size
  const chipLabel = open
    ? `${items.length} tasks`
    : numSelected === items.length
      ? `${items.length} tasks`
      : `${numSelected}/${items.length} tasks`

  return (
    <div className="relative">
      {/* Trigger chip */}
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl transition-colors"
        style={{
          backgroundColor: open ? "#efeadf" : "#f6f3ec",
          color: "#6b6357",
          border: `1px solid ${open ? "#c8c2b4" : "#d8d2c4"}`,
        }}
      >
        <CheckSquare size={11} style={{ color: "#2d5a4f" }} />
        Add {chipLabel}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Picker dropdown */}
      {open && (
        <div
          className="absolute left-0 mt-1.5 z-20 rounded-xl shadow-lg w-72"
          style={{ backgroundColor: "#fff", border: "1px solid #e8e2d4" }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: "1px solid #f0ebe2" }}
          >
            <button
              onClick={toggleAll}
              className="text-[10px] font-medium transition-colors"
              style={{ color: "#6b6357" }}
            >
              {selected.size === items.length ? "Deselect all" : "Select all"}
            </button>
            <button onClick={() => setOpen(false)} style={{ color: "#948a7b" }}>
              <X size={13} />
            </button>
          </div>

          {/* Item list */}
          <div className="py-1 max-h-56 overflow-y-auto">
            {items.map((item, i) => (
              <button
                key={i}
                onClick={() => toggle(i)}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[#faf8f4]"
              >
                {selected.has(i)
                  ? <CheckSquare size={13} className="mt-0.5 shrink-0" style={{ color: "#2d5a4f" }} />
                  : <Square size={13} className="mt-0.5 shrink-0" style={{ color: "#c4bdb2" }} />
                }
                <span
                  className="text-xs leading-snug"
                  style={{ color: selected.has(i) ? "#1a1714" : "#948a7b" }}
                >
                  {item}
                </span>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="px-3 py-2.5" style={{ borderTop: "1px solid #f0ebe2" }}>
            <button
              onClick={create}
              disabled={loading || numSelected === 0}
              className="w-full text-xs py-1.5 rounded-lg font-medium disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: "#2d5a4f", color: "#fff" }}
            >
              {loading
                ? "Creating…"
                : numSelected === 0
                  ? "Select tasks to add"
                  : `Add ${numSelected} ${numSelected === 1 ? "task" : "tasks"}`
              }
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Calendar chip ────────────────────────────────────────────────────────────

function CalendarChip({ hint }: { hint: CalendarHint }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(hint.suggestedTitle)
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [duration, setDuration] = useState("60")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    if (!date || !time) return
    setSaving(true)
    try {
      const datetime_iso = new Date(`${date}T${time}`).toISOString()
      await apiPost("/calendar/events", {
        title: title || hint.suggestedTitle,
        start: datetime_iso,
        duration_min: parseInt(duration) || 60,
      })
      setSaved(true)
      setOpen(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (saved) {
    return (
      <div
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl"
        style={{ backgroundColor: "#e3ede9", color: "#2d5a4f", border: "1px solid rgba(45,90,79,0.2)" }}
      >
        <Check size={11} />
        Added to calendar
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl transition-colors"
        style={{
          backgroundColor: open ? "#efeadf" : "#f6f3ec",
          color: "#6b6357",
          border: "1px solid #d8d2c4",
        }}
      >
        <Calendar size={11} style={{ color: "#2d5a4f" }} />
        Add to Calendar
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute left-0 mt-1.5 z-20 rounded-xl p-3 shadow-lg w-72"
          style={{ backgroundColor: "#fff", border: "1px solid #e8e2d4" }}
        >
          <p className="text-[10px] mb-2.5 leading-relaxed line-clamp-2" style={{ color: "#948a7b" }}>
            {hint.rawText}
          </p>

          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-medium block mb-0.5" style={{ color: "#6b6357" }}>Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg outline-none"
                style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium block mb-0.5" style={{ color: "#6b6357" }}>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                  style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                />
              </div>
              <div>
                <label className="text-[10px] font-medium block mb-0.5" style={{ color: "#6b6357" }}>Time</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                  style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-medium block mb-0.5" style={{ color: "#6b6357" }}>Duration (min)</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min={15}
                step={15}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg outline-none"
                style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              onClick={save}
              disabled={saving || !date || !time}
              className="flex-1 text-xs py-1.5 rounded-lg font-medium disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: "#2d5a4f", color: "#fff" }}
            >
              {saving ? "Adding…" : "Add to Calendar"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: "#f6f3ec", color: "#6b6357", border: "1px solid #d8d2c4" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Generic hover-only action ────────────────────────────────────────────────

function HoverAction({
  icon: Icon,
  label,
  doneLabel,
  onClick,
}: {
  icon: React.ElementType
  label: string
  doneLabel: string
  onClick: () => Promise<void>
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle")

  const handle = async () => {
    setState("loading")
    try {
      await onClick()
      setState("done")
      setTimeout(() => setState("idle"), 3000)
    } catch {
      setState("idle")
    }
  }

  return (
    <button
      onClick={handle}
      disabled={state === "loading" || state === "done"}
      className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-all"
      style={{
        backgroundColor: state === "done" ? "#e3ede9" : "transparent",
        color: state === "done" ? "#2d5a4f" : "#c4bdb2",
        border: `1px solid ${state === "done" ? "rgba(45,90,79,0.2)" : "transparent"}`,
      }}
    >
      {state === "loading" ? (
        <Loader2 size={9} className="animate-spin" />
      ) : state === "done" ? (
        <Check size={9} />
      ) : (
        <Icon size={9} />
      )}
      {state === "loading" ? "…" : state === "done" ? doneLabel : label}
    </button>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function MessageActions({ content }: { content: string }) {
  const analysis = useMemo(() => analyzeContent(content), [content])

  function deriveTitle(text: string): string {
    const first = text.split("\n").find((l) => l.trim()) || text
    return first.trim().replace(/^#+\s*/, "").slice(0, 80)
  }

  const saveToSecondBrain = async () => {
    await apiPost("/second-brain/ingest/text", {
      content,
      title: deriveTitle(content),
      tags: analysis.isResearch ? ["research", "chat"] : ["chat"],
      domain: "work",
    })
  }

  const createTask = async () => {
    await apiPost("/tasks", {
      title: deriveTitle(content),
      description: content.slice(0, 500),
      priority: "normal",
      source: "chat",
    })
  }

  const hasContextual = analysis.listItems.length >= 2 || analysis.calendarHint !== null

  return (
    <div className="mt-1.5 ml-1 space-y-1.5">
      {/* ── Contextual chips — always visible when detected ── */}
      {hasContextual && (
        <div className="flex flex-wrap items-start gap-2">
          {analysis.listItems.length >= 2 && (
            <div className="relative">
              <BulkTasksChip items={analysis.listItems} />
            </div>
          )}
          {analysis.calendarHint && (
            <CalendarChip hint={analysis.calendarHint} />
          )}
        </div>
      )}

      {/* ── Generic hover actions ── */}
      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <HoverAction
          icon={BookOpen}
          label={analysis.isResearch ? "Save research" : "Second Brain"}
          doneLabel="Saved"
          onClick={saveToSecondBrain}
        />
        {analysis.listItems.length < 2 && (
          <HoverAction
            icon={CheckSquare}
            label="Task"
            doneLabel="Added"
            onClick={createTask}
          />
        )}
      </div>
    </div>
  )
}
