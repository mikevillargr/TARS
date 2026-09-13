"use client"

import { useState } from "react"
import Link from "next/link"
import { CheckCircle2, Circle, ClipboardList, ExternalLink, X } from "lucide-react"
import { apiPatch } from "@/lib/api-client"

/**
 * "What's on my list" answered with checkboxes, not a bulleted sentence.
 *
 * list_reminders used to return "3 pending reminder(s): • buy milk (due Sep 15)
 * ..." as plain text, which the model then relayed as a prose bullet list —
 * readable, but not actionable. Checking one off meant leaving chat for
 * To-Dos. Same last-mile gap the data table and artifact preview closed for
 * their own shapes, applied here: the list TARS already has is rendered as
 * the real thing instead of a description of it.
 *
 * Grouping and date logic are the same rules as the To-Dos page
 * (app/(app)/reminders/page.tsx) — overdue in rose, otherwise plain — so a
 * reminder reads identically whether you're looking at it in chat or on its
 * own page.
 */

export interface ReminderRow {
  id: string
  text: string
  done: boolean
  due_at: string | null
}

function isDatePast(d: Date): boolean {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  return startOfDay(d) < startOfDay(new Date())
}

function isDateToday(d: Date): boolean {
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function formatDue(due_at: string): string {
  const d = new Date(due_at)
  if (isDateToday(d)) return "today"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function RemindersListCard({
  reminders,
  onDismiss,
}: {
  reminders: ReminderRow[]
  onDismiss?: () => void
}) {
  const [rows, setRows] = useState(reminders)
  const [pending, setPending] = useState<Set<string>>(new Set())

  async function toggle(id: string) {
    const row = rows.find(r => r.id === id)
    if (!row || pending.has(id)) return
    const next = !row.done
    setRows(prev => prev.map(r => (r.id === id ? { ...r, done: next } : r)))
    setPending(prev => new Set(prev).add(id))
    try {
      await apiPatch(`/reminders/${id}`, { done: next })
    } catch {
      // Revert — the To-Do is still whatever it was before the click.
      setRows(prev => prev.map(r => (r.id === id ? { ...r, done: !next } : r)))
    } finally {
      setPending(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  if (rows.length === 0) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 max-w-md text-sm"
        style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-surface)", color: "var(--c-ink-muted)" }}
      >
        <ClipboardList size={14} style={{ color: "var(--c-ink-faint)" }} />
        No pending To-Dos.
      </div>
    )
  }

  return (
    <div
      className="rounded-xl overflow-hidden w-full max-w-md"
      style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-surface)" }}
    >
      <div className="flex items-center gap-2 px-3.5 py-2" style={{ borderBottom: "1px solid var(--c-border-faint)" }}>
        <ClipboardList size={13} style={{ color: "var(--c-ink-faint)" }} />
        <span className="tars-label tars-label--muted mr-auto">
          {rows.filter(r => !r.done).length} PENDING
        </span>
        <Link href="/reminders" className="p-1 rounded-md" style={{ color: "var(--c-ink-faint)" }} title="Open To-Dos">
          <ExternalLink size={12} />
        </Link>
        {onDismiss && (
          <button onClick={onDismiss} className="p-1" style={{ color: "var(--c-ink-faint)" }} title="Dismiss">
            <X size={11} />
          </button>
        )}
      </div>

      <div>
        {rows.map((r, i) => {
          const due = r.due_at ? new Date(r.due_at) : null
          const overdue = !r.done && due ? isDatePast(due) : false
          return (
            <div
              key={r.id}
              className="flex items-start gap-2.5 px-3.5 py-2"
              style={{
                borderBottom: i < rows.length - 1 ? "1px solid var(--c-border-faint)" : "none",
                opacity: r.done ? 0.5 : 1,
              }}
            >
              <button
                onClick={() => toggle(r.id)}
                className="mt-0.5 shrink-0"
                style={{ color: r.done ? "var(--c-moss)" : "var(--c-ink-faint)" }}
                aria-label={r.done ? "Mark incomplete" : "Mark done"}
              >
                {r.done ? <CheckCircle2 size={15} /> : <Circle size={15} />}
              </button>
              <span
                className="flex-1 min-w-0 text-sm"
                style={{ color: "var(--c-ink)", textDecoration: r.done ? "line-through" : "none" }}
              >
                {r.text}
              </span>
              {due && (
                <span
                  className="tars-label shrink-0 mt-0.5"
                  style={{ color: overdue ? "var(--c-rose)" : "var(--c-ink-faint)" }}
                >
                  {formatDue(r.due_at as string).toUpperCase()}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
