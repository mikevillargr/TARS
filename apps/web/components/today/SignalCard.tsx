"use client"

import { useRef, useState } from "react"
import { X, Clock, ChevronDown, CalendarPlus, Link2, MoreHorizontal } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import type { Signal, SignalAction, SignalUrgency } from "@/lib/today-mock"

/**
 * SignalCard — one AI-inferred item.
 *
 * Anatomy, in reading order:
 *   provenance + status  →  imperative title  →  primary action + alternates
 *
 * Rules this card enforces:
 *   · The primary action is always specifically named ("Draft reply"), never a
 *     generic "Approve" — you know what will happen before you tap. TARS picks
 *     it; the alternates it considered stay one tap away in the overflow menu.
 *   · Reasoning is disclosable, not default-visible. Triage speed beats
 *     transparency-by-default; transparency is one tap away.
 *   · Dismissal is always recoverable, and reachable two ways: the × for
 *     pointer, a swipe for thumb.
 *   · Urgency reads through a tinted hairline border and a mono status badge —
 *     not a colored side-stripe. Depth by surface and border is the house
 *     style; a fat accent bar is a different product's language.
 *   · Text sits on --c-surface, never on the ambient field, so the WCAG AA
 *     contrast work from v2.15.12 survives the wallpaper.
 */

// ─── Urgency vocabulary ──────────────────────────────────────────────────────

interface UrgencyStyle {
  accent: string
  border: string
  badge: string | null
}

const URGENCY: Record<SignalUrgency, UrgencyStyle> = {
  normal: {
    accent: "var(--c-moss)",
    border: "var(--c-border)",
    badge: null,
  },
  time: {
    accent: "var(--c-amber)",
    border: "color-mix(in srgb, var(--c-amber) 45%, var(--c-border))",
    badge: "today",
  },
  overdue: {
    accent: "var(--c-rose)",
    border: "color-mix(in srgb, var(--c-rose) 50%, var(--c-border))",
    badge: "overdue",
  },
}

// ─── Swipe tuning ────────────────────────────────────────────────────────────

const AXIS_LOCK_PX = 10    // movement before we decide horizontal vs. vertical
const COMMIT_PX = 88       // past this, releasing commits the action
const MAX_DRAG_PX = 132    // rubber-band ceiling

type SwipeIntent = "dismiss" | "snooze" | null

interface SignalCardProps {
  signal: Signal
  onAct: (signal: Signal, action: SignalAction) => void
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
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState<SwipeIntent>(null)

  const start = useRef<{ x: number; y: number } | null>(null)
  const axis = useRef<"x" | "y" | null>(null)

  const style = URGENCY[signal.urgency]
  const [primary, ...alternates] = signal.actions

  // Which action the current drag would commit, and whether it's armed yet.
  const intent: SwipeIntent = dx === 0 ? null : dx < 0 ? "dismiss" : "snooze"
  const armed = Math.abs(dx) >= COMMIT_PX

  // ── Swipe handlers ─────────────────────────────────────────────────────────
  // touch-action: pan-y on the card lets the browser keep vertical scrolling
  // natively, so we never have to preventDefault (which React's passive
  // listeners wouldn't allow anyway).

  function handleTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY }
    axis.current = null
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!start.current || leaving) return
    const t = e.touches[0]
    const rawX = t.clientX - start.current.x
    const rawY = t.clientY - start.current.y

    if (!axis.current) {
      if (Math.abs(rawX) < AXIS_LOCK_PX && Math.abs(rawY) < AXIS_LOCK_PX) return
      axis.current = Math.abs(rawX) > Math.abs(rawY) ? "x" : "y"
    }
    if (axis.current !== "x") return

    // Rubber-band past the commit point so the card never feels unbounded.
    const over = Math.max(0, Math.abs(rawX) - COMMIT_PX)
    const damped = Math.sign(rawX) * Math.min(Math.abs(rawX) - over * 0.6, MAX_DRAG_PX)
    setDx(damped)
  }

  function handleTouchEnd() {
    if (axis.current === "x" && Math.abs(dx) >= COMMIT_PX) {
      const committed: SwipeIntent = dx < 0 ? "dismiss" : "snooze"
      setLeaving(committed)
      // Let the exit transition play before the row leaves the list.
      setTimeout(() => {
        if (committed === "dismiss") onDismiss(signal.id)
        else onSnooze(signal.id)
      }, 200)
    } else {
      setDx(0)
    }
    start.current = null
    axis.current = null
  }

  const translate = leaving
    ? leaving === "dismiss"
      ? "-110%"
      : "110%"
    : `${dx}px`

  return (
    <div className="relative">
      {/* Swipe intent layer — sits behind the card, revealed as it moves */}
      {(intent || leaving) && (
        <div
          className="absolute inset-0 flex items-center justify-between px-5 rounded-lg pointer-events-none"
          style={{ backgroundColor: "var(--c-surface-2)" }}
          aria-hidden="true"
        >
          <span
            className="flex items-center gap-1.5"
            style={{
              color: armed || leaving === "snooze" ? "var(--c-moss)" : "var(--c-ink-faint)",
              opacity: (intent === "snooze" || leaving === "snooze") ? 1 : 0,
              transform: `scale(${armed && intent === "snooze" ? 1.06 : 1})`,
              transition: "color 140ms ease, transform 140ms cubic-bezier(0.25, 1, 0.5, 1)",
            }}
          >
            <Clock size={15} />
            <span className="tars-label" style={{ color: "inherit" }}>snooze</span>
          </span>
          <span
            className="flex items-center gap-1.5"
            style={{
              color: armed || leaving === "dismiss" ? "var(--c-rose)" : "var(--c-ink-faint)",
              opacity: (intent === "dismiss" || leaving === "dismiss") ? 1 : 0,
              transform: `scale(${armed && intent === "dismiss" ? 1.06 : 1})`,
              transition: "color 140ms ease, transform 140ms cubic-bezier(0.25, 1, 0.5, 1)",
            }}
          >
            <span className="tars-label" style={{ color: "inherit" }}>dismiss</span>
            <X size={15} />
          </span>
        </div>
      )}

      <div
        className="card relative"
        style={{
          padding: "0.875rem 1rem",
          borderColor: style.border,
          touchAction: "pan-y",
          transform: `translate3d(${translate}, 0, 0)`,
          opacity: leaving ? 0 : 1,
          // No transition while the finger is down — the card must track it 1:1.
          transition:
            dx !== 0 && !leaving
              ? "none"
              : "transform 220ms cubic-bezier(0.25, 1, 0.5, 1), opacity 200ms ease-out",
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        data-selectable
      >
        {/* Header row: provenance + status + dismiss */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="tars-label" style={{ color: style.accent }}>
              {signal.sourceLabel}
            </span>
            <span className="tars-label tars-label--muted">· {signal.age}</span>
            {style.badge && (
              <span
                className="badge"
                style={{
                  backgroundColor:
                    signal.urgency === "overdue" ? "var(--c-rose-soft)" : "var(--c-amber-soft)",
                  color: style.accent,
                }}
              >
                {style.badge}
              </span>
            )}
          </div>
          <button
            onClick={() => onDismiss(signal.id)}
            className="shrink-0 p-1 -m-1 rounded opacity-45 hover:opacity-100 transition-opacity"
            style={{ color: "var(--c-ink-muted)" }}
            title="Dismiss"
            aria-label={`Dismiss: ${signal.title}`}
          >
            <X size={15} />
          </button>
        </div>

        {/* The ask */}
        <p
          className="text-[0.9375rem] leading-snug mb-3"
          style={{ color: "var(--c-ink)", textWrap: "pretty" }}
        >
          {signal.title}
        </p>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onAct(signal, primary)}
            className="tars-send-btn px-3 py-1.5 rounded-md text-[0.8125rem] font-medium hover:opacity-85"
            style={{ backgroundColor: "var(--c-moss)", color: "var(--c-canvas)" }}
          >
            {primary.label}
          </button>

          {/* Alternates TARS considered but didn't pick */}
          {alternates.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="p-1.5 rounded-md transition-colors hover:opacity-100 opacity-60"
                style={{
                  backgroundColor: "var(--c-surface-2)",
                  border: "1px solid var(--c-border)",
                  color: "var(--c-ink-muted)",
                }}
                aria-label="Other actions"
                title="Other actions"
              >
                <MoreHorizontal size={14} />
              </DropdownMenuTrigger>
              {/* w-auto overrides base-ui's anchor-width sizing (the trigger is
                  an icon, so the menu would otherwise be ~30px wide). */}
              <DropdownMenuContent align="start" className="w-auto min-w-52">
                {alternates.map((action, i) => (
                  // base-ui Menu.Item fires onClick, not onSelect — onSelect is
                  // the text-selection event and never fires here (v2.15.5).
                  <DropdownMenuItem
                    key={`${action.kind}-${i}`}
                    onClick={() => onAct(signal, action)}
                    className="tars-label"
                    style={{ color: "var(--c-ink-muted)" }}
                  >
                    {action.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {signal.calendarEvent && (
            <button
              onClick={() => onAddToCalendar(signal)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md transition-colors text-[0.8125rem]"
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
                transition: "transform 180ms cubic-bezier(0.25, 1, 0.5, 1)",
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
            style={{
              borderColor: "var(--c-border-faint)",
              animation: "tars-chip-in 220ms cubic-bezier(0.25, 1, 0.5, 1)",
            }}
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
    </div>
  )
}
