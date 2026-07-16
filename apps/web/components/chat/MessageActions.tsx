"use client"

import { useState, useMemo } from "react"
import { BookOpen, CheckSquare, Square, Check, Calendar, ChevronDown, Loader2, X } from "lucide-react"
import { apiPost } from "@/lib/api-client"
import { analyzeContent, type CalendarHint, type ReplyOption } from "./contentAnalysis"

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
        style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)", border: "1px solid color-mix(in srgb, var(--c-moss) 25%, transparent)" }}
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
          backgroundColor: open ? "var(--c-surface-2)" : "var(--c-canvas)",
          color: "var(--c-ink-muted)",
          border: `1px solid ${open ? "var(--c-border)" : "var(--c-border)"}`,
        }}
      >
        <CheckSquare size={11} style={{ color: "var(--c-moss)" }} />
        Add {chipLabel}
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Picker dropdown */}
      {open && (
        <div
          className="absolute left-0 mt-1.5 z-20 rounded-xl shadow-lg w-72"
          style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-3 py-2"
            style={{ borderBottom: "1px solid var(--c-border-faint)" }}
          >
            <button
              onClick={toggleAll}
              className="text-[10px] font-medium transition-colors"
              style={{ color: "var(--c-ink-muted)" }}
            >
              {selected.size === items.length ? "Deselect all" : "Select all"}
            </button>
            <button onClick={() => setOpen(false)} style={{ color: "var(--c-ink-faint)" }}>
              <X size={13} />
            </button>
          </div>

          {/* Item list */}
          <div className="py-1 max-h-56 overflow-y-auto">
            {items.map((item, i) => (
              <button
                key={i}
                onClick={() => toggle(i)}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-2"
              >
                {selected.has(i)
                  ? <CheckSquare size={13} className="mt-0.5 shrink-0" style={{ color: "var(--c-moss)" }} />
                  : <Square size={13} className="mt-0.5 shrink-0" style={{ color: "var(--c-ink-faint)" }} />
                }
                <span
                  className="text-xs leading-snug"
                  style={{ color: selected.has(i) ? "var(--c-ink)" : "var(--c-ink-faint)" }}
                >
                  {item}
                </span>
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="px-3 py-2.5" style={{ borderTop: "1px solid var(--c-border-faint)" }}>
            <button
              onClick={create}
              disabled={loading || numSelected === 0}
              className="w-full text-xs py-1.5 rounded-lg font-medium disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
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
        style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)", border: "1px solid color-mix(in srgb, var(--c-moss) 25%, transparent)" }}
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
          backgroundColor: open ? "var(--c-surface-2)" : "var(--c-canvas)",
          color: "var(--c-ink-muted)",
          border: "1px solid var(--c-border)",
        }}
      >
        <Calendar size={11} style={{ color: "var(--c-moss)" }} />
        Add to Calendar
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute left-0 mt-1.5 z-20 rounded-xl p-3 shadow-lg w-72"
          style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}
        >
          <p className="text-[10px] mb-2.5 leading-relaxed line-clamp-2" style={{ color: "var(--c-ink-faint)" }}>
            {hint.rawText}
          </p>

          <div className="space-y-2">
            <div>
              <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--c-ink-muted)" }}>Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg outline-none"
                style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--c-ink-muted)" }}>Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                  style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
                />
              </div>
              <div>
                <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--c-ink-muted)" }}>Time</label>
                <input
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="w-full text-xs px-2 py-1.5 rounded-lg outline-none"
                  style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-medium block mb-0.5" style={{ color: "var(--c-ink-muted)" }}>Duration (min)</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                min={15}
                step={15}
                className="w-full text-xs px-2.5 py-1.5 rounded-lg outline-none"
                style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
              />
            </div>
          </div>

          <div className="flex gap-2 mt-3">
            <button
              onClick={save}
              disabled={saving || !date || !time}
              className="flex-1 text-xs py-1.5 rounded-lg font-medium disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
            >
              {saving ? "Adding…" : "Add to Calendar"}
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-xs px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: "var(--c-canvas)", color: "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Reply option chips ───────────────────────────────────────────────────────
// One-click chips that submit a pre-extracted TARS option as the user's reply.

function ReplyChips({ options, onSend }: { options: ReplyOption[]; onSend: (text: string) => void }) {
  const [sent, setSent] = useState<string | null>(null)

  if (sent !== null) {
    return (
      <div className="flex flex-wrap gap-1.5">
        <div
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl"
          style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)", border: "1px solid color-mix(in srgb, var(--c-moss) 25%, transparent)" }}
        >
          <Check size={11} />
          {sent}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt.label}
          onClick={() => { setSent(opt.label); onSend(opt.label) }}
          className="reply-chip inline-flex items-center text-xs px-3 py-1.5 rounded-xl"
          style={{
            backgroundColor: "var(--c-canvas)",
            color: "var(--c-ink-muted)",
            border: "1px solid var(--c-border)",
            transition: "background-color 150ms, color 150ms, border-color 150ms",
          }}
        >
          {opt.label}
        </button>
      ))}
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
        backgroundColor: state === "done" ? "var(--c-moss-soft)" : "transparent",
        color: state === "done" ? "var(--c-moss)" : "var(--c-ink-faint)",
        border: `1px solid ${state === "done" ? "color-mix(in srgb, var(--c-moss) 25%, transparent)" : "transparent"}`,
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

export function MessageActions({ content, onSend }: { content: string; onSend?: (text: string) => void }) {
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

  const hasContextual = analysis.replyOptions.length >= 2 || analysis.listItems.length >= 2 || analysis.calendarHint !== null

  return (
    <div className="mt-1.5 ml-1 space-y-1.5">
      {/* ── Reply option chips — one-click responses to TARS choice lists ── */}
      {analysis.replyOptions.length >= 2 && onSend && (
        <ReplyChips options={analysis.replyOptions} onSend={onSend} />
      )}

      {/* ── Contextual action chips — always visible when detected ── */}
      {(analysis.listItems.length >= 2 || analysis.calendarHint !== null) && (
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
