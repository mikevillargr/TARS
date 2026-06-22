"use client"

import { useEffect, useState, useRef, useCallback } from "react"
import { Plus, Trash2, Circle, CheckCircle2, Calendar, ClipboardList, Pencil, Check } from "lucide-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Reminder {
  id: string
  text: string
  done: boolean
  due_at: string | null
  created_at: string
  updated_at: string
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function startOfDayUTC(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function isDateToday(d: Date): boolean {
  const now = new Date()
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
}

function isDateTomorrow(d: Date): boolean {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
}

function isDatePast(d: Date): boolean {
  return startOfDayUTC(d) < startOfDayUTC(new Date())
}

function formatDue(due_at: string): string {
  const d = new Date(due_at)
  if (isDateToday(d)) return "today"
  if (isDateTomorrow(d)) return "tomorrow"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ─── Grouping logic ──────────────────────────────────────────────────────────

type Group = "overdue" | "today" | "tomorrow" | "upcoming" | "someday" | "done"

function getGroup(r: Reminder): Group {
  if (r.done) return "done"
  if (!r.due_at) return "someday"
  const due = new Date(r.due_at)
  if (isDatePast(due)) return "overdue"
  if (isDateToday(due)) return "today"
  if (isDateTomorrow(due)) return "tomorrow"
  return "upcoming"
}

const GROUP_ORDER: Group[] = ["overdue", "today", "tomorrow", "upcoming", "someday"]

const GROUP_LABELS: Record<Group, string> = {
  overdue: "OVERDUE",
  today: "TODAY",
  tomorrow: "TOMORROW",
  upcoming: "UPCOMING",
  someday: "SOMEDAY",
  done: "DONE",
}

// ─── QuickAdd ─────────────────────────────────────────────────────────────────

function QuickAdd({ onAdd }: { onAdd: (text: string, due_at: string | null) => void }) {
  const [value, setValue] = useState("")
  const [date, setDate] = useState("")
  const textRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)

  function commit() {
    if (!value.trim()) return
    onAdd(value.trim(), date || null)
    setValue("")
    setDate("")
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commit()
    if (e.key === "Escape") {
      setValue("")
      setDate("")
      textRef.current?.blur()
    }
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--c-border)] group">
      <Plus size={14} className="text-[var(--c-ink-faint)] group-focus-within:text-[var(--moss)] transition-colors shrink-0" />
      <div className="relative shrink-0">
        <button
          onClick={() => dateRef.current?.showPicker?.() ?? dateRef.current?.click()}
          className={`flex items-center gap-1 tars-label px-2 py-1 rounded transition-colors ${
            date
              ? "text-[var(--moss)] bg-[var(--moss)]/10"
              : "text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
          }`}
          title="Set due date"
        >
          <Calendar size={12} />
          {date ? new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
        </button>
        <input
          ref={dateRef}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="absolute inset-0 opacity-0 pointer-events-none w-0"
          tabIndex={-1}
        />
      </div>
      <input
        ref={textRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKey}
        placeholder="Add a to-do…"
        className="flex-1 bg-transparent text-sm text-[var(--c-ink)] placeholder:text-[var(--c-ink-faint)] outline-none"
      />
      {value.trim() && (
        <button
          onClick={commit}
          className="shrink-0 flex items-center justify-center w-6 h-6 rounded-full transition-colors"
          style={{ background: "var(--c-moss)", color: "var(--c-surface)" }}
          aria-label="Add to-do"
        >
          <Plus size={13} />
        </button>
      )}
    </div>
  )
}

// ─── ReminderRow ──────────────────────────────────────────────────────────────

function ReminderRow({
  reminder,
  onToggle,
  onDelete,
  onEdit,
}: {
  reminder: Reminder
  onToggle: () => void
  onDelete: () => void
  onEdit: (text: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(reminder.text)
  const inputRef = useRef<HTMLInputElement>(null)

  const isDue = reminder.due_at ? isDatePast(new Date(reminder.due_at)) : false

  function handleDoubleClick() {
    setDraft(reminder.text)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function handleEditKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitEdit()
    if (e.key === "Escape") {
      setDraft(reminder.text)
      setEditing(false)
    }
  }

  function commitEdit() {
    if (draft.trim() && draft.trim() !== reminder.text) {
      onEdit(draft.trim())
    }
    setEditing(false)
  }

  return (
    <div className={`group flex items-start gap-3 px-4 py-2.5 hover:bg-[var(--c-surface)] transition-colors ${reminder.done ? "opacity-40" : ""}`}>
      <button
        onClick={onToggle}
        className="mt-0.5 shrink-0 text-[var(--c-ink-faint)] hover:text-[var(--moss)] transition-colors"
        aria-label={reminder.done ? "Mark incomplete" : "Mark done"}
      >
        {reminder.done
          ? <CheckCircle2 size={16} className="text-[var(--moss)]" />
          : <Circle size={16} />
        }
      </button>

      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleEditKey}
            onBlur={commitEdit}
            className="w-full bg-transparent text-sm text-[var(--c-ink)] outline-none border-b border-[var(--moss)]"
          />
        ) : (
          <span
            onDoubleClick={handleDoubleClick}
            className={`text-sm text-[var(--c-ink)] ${reminder.done ? "line-through" : ""}`}
          >
            {reminder.text}
          </span>
        )}

        {reminder.due_at && !reminder.done && (
          <div className={`flex items-center gap-1 mt-0.5 tars-label ${isDue ? "text-rose-500" : "text-[var(--c-ink-faint)]"}`}>
            <Calendar size={10} />
            {formatDue(reminder.due_at)}
          </div>
        )}
      </div>

      {editing ? (
        <button
          onMouseDown={(e) => { e.preventDefault(); commitEdit() }}
          className="shrink-0 mt-0.5 text-[var(--moss)]"
          aria-label="Save"
        >
          <Check size={14} />
        </button>
      ) : (
        <div className="shrink-0 mt-0.5 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
          <button
            onClick={handleDoubleClick}
            className="text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors"
            aria-label="Edit"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={onDelete}
            className="text-[var(--c-ink-faint)] hover:text-rose-500 transition-colors"
            aria-label="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Group section ────────────────────────────────────────────────────────────

function GroupSection({
  group,
  reminders,
  onToggle,
  onDelete,
  onEdit,
}: {
  group: Group
  reminders: Reminder[]
  onToggle: (id: string) => void
  onDelete: (id: string) => void
  onEdit: (id: string, text: string) => void
}) {
  if (reminders.length === 0) return null
  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2">
        <span className="tars-label">{GROUP_LABELS[group]}</span>
        <span className="tars-label text-[var(--c-ink-faint)]">· {reminders.length}</span>
      </div>
      {reminders.map((r) => (
        <ReminderRow
          key={r.id}
          reminder={r}
          onToggle={() => onToggle(r.id)}
          onDelete={() => onDelete(r.id)}
          onEdit={(text) => onEdit(r.id, text)}
        />
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [showDone, setShowDone] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Reminder[]>("/reminders?done=all")
      setReminders(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(text: string, due_at: string | null) {
    // Convert local date string (YYYY-MM-DD) to ISO datetime at noon local time
    const due_iso = due_at ? new Date(due_at + "T12:00:00").toISOString() : null
    const optimistic: Reminder = {
      id: `tmp-${Date.now()}`,
      text,
      done: false,
      due_at: due_iso,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    setReminders((prev) => [optimistic, ...prev])
    try {
      const created = await apiPost<Reminder>("/reminders", { text, due_at: due_iso })
      setReminders((prev) => prev.map((r) => r.id === optimistic.id ? created : r))
    } catch {
      setReminders((prev) => prev.filter((r) => r.id !== optimistic.id))
    }
  }

  async function handleToggle(id: string) {
    const reminder = reminders.find((r) => r.id === id)
    if (!reminder) return
    const newDone = !reminder.done
    setReminders((prev) => prev.map((r) => r.id === id ? { ...r, done: newDone } : r))
    try {
      await apiPatch(`/reminders/${id}`, { done: newDone })
    } catch {
      setReminders((prev) => prev.map((r) => r.id === id ? { ...r, done: !newDone } : r))
    }
  }

  async function handleDelete(id: string) {
    setReminders((prev) => prev.filter((r) => r.id !== id))
    try {
      await apiDelete(`/reminders/${id}`)
    } catch {
      load()
    }
  }

  async function handleEdit(id: string, text: string) {
    setReminders((prev) => prev.map((r) => r.id === id ? { ...r, text } : r))
    try {
      await apiPatch(`/reminders/${id}`, { text })
    } catch {
      load()
    }
  }

  const grouped: Record<Group, Reminder[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    upcoming: [],
    someday: [],
    done: [],
  }
  for (const r of reminders) {
    grouped[getGroup(r)].push(r)
  }

  const pending = reminders.filter((r) => !r.done)
  const done = grouped.done

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--c-border)]">
        <div className="flex items-center gap-3">
          <ClipboardList size={16} className="text-[var(--c-ink-faint)]" />
          <span className="tars-title">To-Dos</span>
          {pending.length > 0 && (
            <span className="tars-label text-[var(--c-ink-faint)]">{pending.length}</span>
          )}
        </div>
      </div>

      {/* Quick add */}
      <div className="max-w-2xl w-full">
        <QuickAdd onAdd={(text, due_at) => handleAdd(text, due_at)} />
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl w-full">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <span className="tars-label text-[var(--c-ink-faint)]">LOADING…</span>
          </div>
        ) : pending.length === 0 && done.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2">
            <ClipboardList size={24} className="text-[var(--c-ink-faint)]" />
            <span className="tars-label text-[var(--c-ink-faint)]">NO TO-DOS</span>
            <span className="text-xs text-[var(--c-ink-faint)] mt-1">Type above and press Enter to add one</span>
          </div>
        ) : (
          <div className="py-2">
            {GROUP_ORDER.map((g) => (
              <GroupSection
                key={g}
                group={g}
                reminders={grouped[g]}
                onToggle={handleToggle}
                onDelete={handleDelete}
                onEdit={handleEdit}
              />
            ))}

            {done.length > 0 && (
              <div>
                <button
                  onClick={() => setShowDone((v) => !v)}
                  className="flex items-center gap-2 px-4 py-2 w-full text-left"
                >
                  <span className="tars-label text-[var(--c-ink-faint)]">
                    {showDone ? "▾" : "▸"} DONE · {done.length}
                  </span>
                </button>
                {showDone && (
                  <div>
                    {done.map((r) => (
                      <ReminderRow
                        key={r.id}
                        reminder={r}
                        onToggle={() => handleToggle(r.id)}
                        onDelete={() => handleDelete(r.id)}
                        onEdit={(text) => handleEdit(r.id, text)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
