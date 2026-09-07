"use client"

import { useState } from "react"
import { X, Clock, ChevronDown, CalendarPlus, Link2 } from "lucide-react"
import type { Signal, SignalUrgency } from "@/lib/today-mock"

/**
 * SignalCard — one AI-inferred item.
 *
 * Anatomy, in reading order:
 *   source badge + age  →  imperative title  →  named action + why + snooze
 *
 * Rules this card enforces:
 *   · The primary action is always specifically named ("Draft reply"), never a
 *     generic "Approve" — the user should know what will happen before tapping.
 *   · Reasoning is disclosable, not default-visible. Triage speed beats
 *     transparency-by-default; transparency is one tap away.
 *   · Every card is dismissable, and dismissal is always recoverable.
 *   · Text sits on --c-surface, never on the ambient field, so the WCAG AA
 *     contrast work from v2.15.12 survives the wallpaper.
 */

const URGENCY_COLOR: Record<SignalUrgency, string> = {
  normal: "var(--c-moss)",
  time: "var(--c-amber)",
  overdue: "var(--c-rose)",
}

interface SignalCardProps {
  signal: Signal
  onAct: (signal: Signal) => void
  onSnooze: (id: string) => void
  onDismiss: (id: string) => void
  onAddToCalendar: (signal: Signal) => void
}

export function SignalCard({
  signal,
  onAct,
  onSnooze,
  onDismiss,
  onAddToCalendar,
}: SignalCardProps) {
  const [showWhy, setShowWhy] = useState(false)
  const accent = URGENCY_COLOR[signal.urgency]

  return (
    <div
      className="card relative overflow-hidden"
      style={{ padding: "0.875rem 1rem 0.875rem 1.125rem" }}
      data-selectable
    >
      {/* Urgency bar — same left-rail signal language as unread rows in Feed */}
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ backgroundColor: accent }}
        aria-hidden="true"
      />

      {/* Header row: provenance + dismiss */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="tars-label" style={{ color: accent }}>
            {signal.sourceLabel}
          </span>
          <span className="tars-label tars-label--muted">· {signal.age}</span>
        </div>
        <button
          onClick={() => onDismiss(signal.id)}
          className="shrink-0 p-1 -m-1 rounded transition-opacity hover:opacity-100 opacity-45"
          style={{ color: "var(--c-ink-muted)" }}
          title="Dismiss"
          aria-label={`Dismiss: ${signal.title}`}
        >
          <X size={15} />
        </button>
      </div>

      {/* The ask — human prose, Inter, max 2 lines of intent */}
      <p
        className="text-[0.9375rem] leading-snug mb-3"
        style={{ color: "var(--c-ink)", textWrap: "pretty" }}
      >
        {signal.title}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => onAct(signal)}
          className="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium transition-opacity hover:opacity-85"
          style={{ backgroundColor: "var(--c-moss)", color: "var(--c-canvas)" }}
        >
          {signal.action.label}
        </button>

        {signal.calendarEvent && (
          <button
            onClick={() => onAddToCalendar(signal)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[0.8125rem] transition-colors"
            style={{
              backgroundColor: "var(--c-surface-2)",
              border: "1px solid var(--c-border)",
              color: "var(--c-ink-muted)",
            }}
            title="Add to device calendar"
          >
            <CalendarPlus size={14} />
            <span className="hidden sm:inline">Add to calendar</span>
          </button>
        )}

        <button
          onClick={() => setShowWhy(v => !v)}
          className="flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors"
          style={{ color: "var(--c-ink-faint)" }}
          aria-expanded={showWhy}
        >
          <span className="tars-label">why</span>
          <ChevronDown
            size={12}
            style={{
              transform: showWhy ? "rotate(180deg)" : "none",
              transition: "transform 180ms ease",
            }}
          />
        </button>

        <button
          onClick={() => onSnooze(signal.id)}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-md ml-auto transition-colors"
          style={{ color: "var(--c-ink-faint)" }}
          title="Snooze until tonight"
        >
          <Clock size={14} />
          <span className="tars-label hidden sm:inline">snooze</span>
        </button>
      </div>

      {/* Reasoning disclosure — the "show your work" layer */}
      {showWhy && (
        <div
          className="mt-3 pt-3 border-t"
          style={{ borderColor: "var(--c-border-faint)", animation: "tars-chip-in 220ms ease-out" }}
        >
          <p
            className="text-[0.8125rem] leading-relaxed mb-2"
            style={{ color: "var(--c-ink-muted)", textWrap: "pretty" }}
          >
            {signal.reasoning}
          </p>
          <button
            className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
            style={{ color: "var(--c-moss)" }}
            title="Open source"
          >
            <Link2 size={12} />
            <span className="tars-label" style={{ color: "var(--c-moss)" }}>
              {signal.citation}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
