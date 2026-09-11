"use client"

/**
 * InlineActionForm — the intermediate step for signal actions worth editing
 * before they exist.
 *
 * Renders inside SignalCard, below the action row, for the three kinds whose
 * outcome is fully specified by an editable payload (FORM_KINDS in
 * SignalCard.tsx): create_reminder, create_task, create_event. Nothing here
 * touches chat — Confirm calls onConfirm with an override object that the
 * harness merges over the action's own payload and executes directly.
 *
 * Each kind gets its own small field set rather than one generic form, since
 * "what needs editing" is genuinely different per kind (a due-date chip row
 * vs. a per-item checklist vs. a date/time/account triple).
 */

import { useMemo, useState } from "react"
import { Check } from "lucide-react"
import type { Signal, SignalAction } from "@/lib/signals"

interface InlineActionFormProps {
  signal: Signal
  action: SignalAction
  onCancel: () => void
  onConfirm: (override: Record<string, unknown>) => void
}

// ─── Shared bits ─────────────────────────────────────────────────────────────
// Exported so ComposeStrip.tsx (the equivalent intermediate step for the
// chat-handoff kinds) can match this look exactly instead of duplicating it.

export function FormShell({
  onCancel,
  onConfirm,
  confirmDisabled,
  confirmLabel = "Confirm",
  children,
}: {
  onCancel: () => void
  onConfirm: () => void
  confirmDisabled?: boolean
  confirmLabel?: string
  children: React.ReactNode
}) {
  return (
    <div
      className="mt-3 p-3 rounded-lg space-y-2.5"
      style={{
        backgroundColor: "var(--c-surface-2)",
        border: "1px solid var(--c-border-faint)",
        animation: "tars-chip-in 180ms cubic-bezier(0.25, 1, 0.5, 1)",
      }}
      // Stray Enter keypresses inside the form shouldn't bubble to anything
      // above it in the card.
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button
          onClick={onCancel}
          className="tars-label px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-100 opacity-60"
          style={{ color: "var(--c-ink-muted)" }}
        >
          cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={confirmDisabled}
          className="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium transition-opacity hover:opacity-85 disabled:opacity-40 disabled:hover:opacity-40"
          style={{ backgroundColor: "var(--c-moss)", color: "var(--c-canvas)" }}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  )
}

export const fieldStyle: React.CSSProperties = {
  backgroundColor: "var(--c-surface)",
  border: "1px solid var(--c-border)",
  color: "var(--c-ink)",
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="tars-label px-2 py-1 rounded-md transition-colors"
      style={
        active
          ? { backgroundColor: "color-mix(in srgb, var(--c-moss) 16%, transparent)", color: "var(--c-moss)" }
          : { backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-ink-faint)" }
      }
    >
      {children}
    </button>
  )
}

// ─── create_reminder ─────────────────────────────────────────────────────────

type DueChoice = "none" | "today" | "tomorrow" | "week"

function dueChoiceToIso(choice: DueChoice): string | null {
  if (choice === "none") return null
  const d = new Date()
  if (choice === "today") d.setHours(20, 0, 0, 0)
  if (choice === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0) }
  if (choice === "week") { d.setDate(d.getDate() + 5); d.setHours(9, 0, 0, 0) }
  return d.toISOString()
}

function ReminderForm({ signal, action, onCancel, onConfirm }: InlineActionFormProps) {
  const [text, setText] = useState(
    (action.payload?.text as string) || signal.title,
  )
  // Mirrors the backend's own default (urgent signals default to "today")
  // so the pre-selected chip never surprises — it's just made editable.
  const [due, setDue] = useState<DueChoice>(
    signal.urgency === "overdue" || signal.urgency === "time" ? "today" : "none",
  )

  return (
    <FormShell
      onCancel={onCancel}
      confirmDisabled={!text.trim()}
      onConfirm={() => onConfirm({ text: text.trim(), due_at: dueChoiceToIso(due) })}
    >
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="To-do text"
        className="w-full text-[0.8125rem] rounded-md px-2.5 py-1.5 outline-none"
        style={fieldStyle}
      />
      <div className="flex items-center gap-1.5 flex-wrap">
        <Chip active={due === "none"} onClick={() => setDue("none")}>no date</Chip>
        <Chip active={due === "today"} onClick={() => setDue("today")}>today</Chip>
        <Chip active={due === "tomorrow"} onClick={() => setDue("tomorrow")}>tomorrow</Chip>
        <Chip active={due === "week"} onClick={() => setDue("week")}>this week</Chip>
      </div>
    </FormShell>
  )
}

// ─── create_task ─────────────────────────────────────────────────────────────

const PRIORITIES = ["low", "normal", "high", "urgent"] as const

function TaskForm({ signal, action, onCancel, onConfirm }: InlineActionFormProps) {
  const items = (action.payload?.items as string[] | undefined) ?? []
  const isBatch = items.length > 1
  const defaultPriority =
    (action.payload?.priority as string) ||
    (signal.urgency === "overdue" || signal.urgency === "time" ? "high" : "normal")
  const [priority, setPriority] = useState(defaultPriority)

  // Grouped batch (e.g. "4 action items from X were never assigned") — the
  // checklist IS the form. One bundled task representing several unrelated
  // commitments is the exact anti-pattern this whole thing exists to avoid;
  // unchecking items is how you get "just the one I actually want tracked".
  const [checked, setChecked] = useState<boolean[]>(() => items.map(() => true))
  const [editedItems, setEditedItems] = useState<string[]>(items)
  const selectedCount = checked.filter(Boolean).length

  // Single item (or no item data at all) — plain title/description/priority.
  // Hooks live here unconditionally (not inside the isBatch branch below) so
  // the same set runs on every render regardless of which form this instance
  // ends up showing.
  const [title, setTitle] = useState((action.payload?.title as string) || signal.title)
  // Pre-filled from reasoning, visible and editable — the point isn't that
  // reasoning never belongs in a task description, it's that it shouldn't
  // land there without Mike seeing and choosing to keep it.
  const [description, setDescription] = useState(
    (action.payload?.description as string) || signal.reasoning || "",
  )

  if (isBatch) {
    return (
      <FormShell
        onCancel={onCancel}
        confirmDisabled={selectedCount === 0}
        confirmLabel={selectedCount <= 1 ? "Create task" : `Create ${selectedCount} tasks`}
        onConfirm={() =>
          onConfirm({
            selected_items: editedItems.filter((_, i) => checked[i]),
            priority,
          })
        }
      >
        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
          {items.map((_, i) => (
            <label key={i} className="flex items-start gap-2 cursor-pointer">
              <button
                type="button"
                onClick={() => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))}
                className="mt-0.5 shrink-0 w-4 h-4 rounded flex items-center justify-center transition-colors"
                style={
                  checked[i]
                    ? { backgroundColor: "var(--c-moss)" }
                    : { border: "1px solid var(--c-border)", backgroundColor: "var(--c-surface)" }
                }
                aria-pressed={checked[i]}
              >
                {checked[i] && <Check size={11} color="var(--c-canvas)" />}
              </button>
              <input
                value={editedItems[i]}
                onChange={(e) =>
                  setEditedItems((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                }
                disabled={!checked[i]}
                className="flex-1 text-[0.8125rem] rounded-md px-2 py-1 outline-none disabled:opacity-45"
                style={fieldStyle}
              />
            </label>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
          <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>priority</span>
          {PRIORITIES.map((p) => (
            <Chip key={p} active={priority === p} onClick={() => setPriority(p)}>{p}</Chip>
          ))}
        </div>
      </FormShell>
    )
  }

  return (
    <FormShell
      onCancel={onCancel}
      confirmDisabled={!title.trim()}
      onConfirm={() => onConfirm({ title: title.trim(), description: description.trim() || null, priority })}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Task title"
        className="w-full text-[0.8125rem] rounded-md px-2.5 py-1.5 outline-none"
        style={fieldStyle}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full text-[0.8125rem] rounded-md px-2.5 py-1.5 outline-none resize-none"
        style={fieldStyle}
      />
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>priority</span>
        {PRIORITIES.map((p) => (
          <Chip key={p} active={priority === p} onClick={() => setPriority(p)}>{p}</Chip>
        ))}
      </div>
    </FormShell>
  )
}

// ─── create_event ────────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, "0")
}

function EventForm({ signal, action, onCancel, onConfirm }: InlineActionFormProps) {
  const ev = signal.calendar_event
  const startDefault = useMemo(() => (ev?.start ? new Date(ev.start) : new Date()), [ev])

  const [title, setTitle] = useState((action.payload?.title as string) || ev?.title || signal.title)
  const [date, setDate] = useState(
    `${startDefault.getFullYear()}-${pad(startDefault.getMonth() + 1)}-${pad(startDefault.getDate())}`,
  )
  const [time, setTime] = useState(`${pad(startDefault.getHours())}:${pad(startDefault.getMinutes())}`)
  const [duration, setDuration] = useState(ev?.duration_min ?? 60)
  const [account, setAccount] = useState<"work" | "personal">("work")

  return (
    <FormShell
      onCancel={onCancel}
      confirmDisabled={!title.trim() || !date || !time}
      confirmLabel="Book it"
      onConfirm={() =>
        onConfirm({
          title: title.trim(),
          start: `${date}T${time}:00`,
          duration_min: duration,
          account,
        })
      }
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Event title"
        className="w-full text-[0.8125rem] rounded-md px-2.5 py-1.5 outline-none"
        style={fieldStyle}
      />
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="flex-1 text-[0.8125rem] rounded-md px-2.5 py-1.5 outline-none"
          style={fieldStyle}
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
          className="flex-1 text-[0.8125rem] rounded-md px-2.5 py-1.5 outline-none"
          style={fieldStyle}
        />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>duration</span>
        {[30, 60, 90, 120].map((m) => (
          <Chip key={m} active={duration === m} onClick={() => setDuration(m)}>
            {m < 60 ? `${m}m` : `${m / 60}h`}
          </Chip>
        ))}
        <span className="tars-label ml-2" style={{ color: "var(--c-ink-faint)" }}>calendar</span>
        <Chip active={account === "work"} onClick={() => setAccount("work")}>work</Chip>
        <Chip active={account === "personal"} onClick={() => setAccount("personal")}>personal</Chip>
      </div>
    </FormShell>
  )
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

export function InlineActionForm(props: InlineActionFormProps) {
  switch (props.action.kind) {
    case "create_reminder":
      return <ReminderForm {...props} />
    case "create_task":
      return <TaskForm {...props} />
    case "create_event":
      return <EventForm {...props} />
    default:
      return null
  }
}
