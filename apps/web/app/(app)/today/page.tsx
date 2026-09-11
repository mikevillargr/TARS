"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, Undo2, Video, AlertTriangle, RefreshCw } from "lucide-react"
import { AmbientField } from "@/components/today/AmbientField"
import { SignalCard } from "@/components/today/SignalCard"
import { useClockMs } from "@/hooks/useClock"
import {
  listSignals,
  actOnSignal,
  snoozeSignal,
  dismissSignal,
  restoreSignal,
  signalIcsUrl,
  listTodayEvents,
  listOverdueTasks,
  type Signal,
  type SignalAction,
  type SignalUrgency,
  type CalendarEvent,
  type TaskRow,
} from "@/lib/signals"

// ─── Grouping ────────────────────────────────────────────────────────────────
// Uncapped by design: a heavy morning should look heavy. Hiding items behind
// "show 3 more" is exactly wrong on a surface whose whole job is "what needs
// you". Grouping gives the list structure instead of truncation.

const GROUP_ORDER: SignalUrgency[] = ["overdue", "time", "normal"]

const GROUP_LABEL: Record<SignalUrgency, string> = {
  overdue: "overdue",
  time: "today",
  normal: "when you can",
}

const GROUP_COLOR: Record<SignalUrgency, string> = {
  overdue: "var(--c-rose)",
  time: "var(--c-amber)",
  normal: "var(--c-ink-faint)",
}

/** Deterministic per-day pick so the line varies but never feels random. */
const ALL_CLEAR_LINES = [
  "Nothing needs you. Enjoy it.",
  "Zero signals. Suspiciously quiet.",
  "All clear. Don't get used to it.",
  "Nothing pending. Go ride.",
]

/**
 * The headline is a verdict, not a tally.
 *
 * "8 need you" makes you do the triage maths yourself. What's actually worth
 * knowing at 06:40 is whether anything is on fire — so lead with that, and let
 * the count of everything else sit in the mono layer beside it.
 */
function buildReadout(urgent: number, rest: number): { lead: string; aside: string | null } {
  if (urgent === 0 && rest === 0) return { lead: "All clear", aside: null }
  if (urgent === 0) return { lead: "Nothing urgent", aside: `${rest} when you can` }
  return { lead: `${urgent} can't wait`, aside: rest > 0 ? `${rest} that can` : null }
}

/**
 * A blank list means three different things, and conflating them makes the
 * screen lie two-thirds of the time.
 */
type BlankKind = "earned" | "quiet" | "parked"

interface SessionTally {
  acted: number
  dismissed: number
  snoozed: number
  firstAt: number | null
  lastAt: number | null
}

const EMPTY_TALLY: SessionTally = {
  acted: 0, dismissed: 0, snoozed: 0, firstAt: null, lastAt: null,
}

function formatSpan(ms: number): string {
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

interface PendingUndo {
  id: string
  label: string
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const router = useRouter()

  const [signals, setSignals] = useState<Signal[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [overdue, setOverdue] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [undo, setUndo] = useState<PendingUndo | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [tally, setTally] = useState<SessionTally>(EMPTY_TALLY)

  const clockMs = useClockMs()
  const clock = clockMs === null ? null : new Date(clockMs)

  // ── Load ───────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    try {
      // Awaited before the first setState so nothing mutates state
      // synchronously inside the mount effect (cascading-render warning).
      const rows = await listSignals("open")
      setSignals(rows)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach TARS")
    } finally {
      setLoading(false)
    }
    // The rail is supporting context, not the point of the screen — a
    // disconnected calendar must not blank the signals, so these fail quietly
    // and independently.
    listTodayEvents().then(setEvents).catch(() => setEvents([]))
    listOverdueTasks().then(setOverdue).catch(() => setOverdue([]))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!undo) return
    const id = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(id)
  }, [undo])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  // ── Derived ────────────────────────────────────────────────────────────────

  const actionSignals = useMemo(() => signals.filter(s => s.kind !== "fyi"), [signals])
  const fyiSignals = useMemo(() => signals.filter(s => s.kind === "fyi"), [signals])

  const urgentCount = actionSignals.filter(
    s => s.urgency === "overdue" || s.urgency === "time",
  ).length
  const readout = buildReadout(urgentCount, actionSignals.length - urgentCount)
  const allClear = actionSignals.length === 0

  const touched = tally.acted + tally.dismissed + tally.snoozed
  const blankKind: BlankKind =
    tally.snoozed > 0 && tally.acted + tally.dismissed === 0
      ? "parked"
      : touched > 0
        ? "earned"
        : "quiet"

  // ── Mutations ──────────────────────────────────────────────────────────────
  //
  // All three are optimistic: the card leaves immediately and comes back if the
  // server disagrees. On a triage surface the alternative — waiting on a
  // round-trip before the card moves — makes the whole screen feel broken.

  const recordTally = useCallback((key: "acted" | "dismissed" | "snoozed") => {
    setTally(prev => {
      const now = Date.now()
      return {
        ...prev,
        [key]: prev[key] + 1,
        firstAt: prev.firstAt ?? now,
        lastAt: now,
      }
    })
  }, [])

  const removeLocally = useCallback((id: string) => {
    setSignals(prev => prev.filter(s => s.id !== id))
  }, [])

  const handleDismiss = useCallback(
    async (id: string) => {
      const snapshot = signals
      removeLocally(id)
      recordTally("dismissed")
      setUndo({ id, label: "Dismissed" })
      try {
        await dismissSignal(id)
      } catch {
        setSignals(snapshot)
        setUndo(null)
        setToast("Couldn't dismiss — put it back")
      }
    },
    [signals, removeLocally, recordTally],
  )

  const handleSnooze = useCallback(
    async (id: string) => {
      const snapshot = signals
      removeLocally(id)
      recordTally("snoozed")
      setUndo({ id, label: "Snoozed until tonight" })
      try {
        await snoozeSignal(id)
      } catch {
        setSignals(snapshot)
        setUndo(null)
        setToast("Couldn't snooze — put it back")
      }
    },
    [signals, removeLocally, recordTally],
  )

  /**
   * Shared commit path for every way a signal can be acted on — a direct
   * click, a form's Confirm, and a compose strip's Confirm. Optimistic
   * removal + undo + navigation all live here once, so the three callers
   * below can't drift.
   */
  const commit = useCallback(
    async (
      signal: Signal,
      action: SignalAction,
      payloadOverride?: Record<string, unknown>,
      note?: string,
    ) => {
      const snapshot = signals
      removeLocally(signal.id)
      recordTally("acted")
      try {
        const res = await actOnSignal(signal.id, action.kind, { payloadOverride, note })
        // open_meeting is pure navigation — it never actually needed chat,
        // it just used to fall through to the conversation handoff below
        // because nothing claimed it first.
        if (res.route) {
          router.push(res.route)
          return
        }
        // Actions needing composition or judgement hand off to chat; follow
        // the handoff rather than leaving the user to find the conversation.
        if (res.conversation_id) {
          router.push(`/chat?open=${res.conversation_id}`)
          return
        }
        setUndo({ id: signal.id, label: res.message })
      } catch (err) {
        setSignals(snapshot)
        setToast(err instanceof Error ? err.message : "That didn't work")
      }
    },
    [signals, removeLocally, recordTally, router],
  )

  const handleAct = useCallback(
    (signal: Signal, action: SignalAction) => commit(signal, action),
    [commit],
  )

  const handleResolve = useCallback(
    (signal: Signal, action: SignalAction, override: Record<string, unknown>) =>
      commit(signal, action, override),
    [commit],
  )

  const handleCompose = useCallback(
    (signal: Signal, action: SignalAction, note: string) =>
      commit(signal, action, undefined, note),
    [commit],
  )

  const handleUndo = useCallback(async () => {
    if (!undo) return
    const id = undo.id
    setUndo(null)
    try {
      const restored = await restoreSignal(id)
      setSignals(prev => (prev.some(s => s.id === id) ? prev : [...prev, restored]))
    } catch {
      setToast("Couldn't undo")
    }
  }, [undo])

  const handleAddToCalendar = useCallback((signal: Signal) => {
    // Real URL, plain anchor — see signalIcsUrl for why this isn't a blob.
    const a = document.createElement("a")
    a.href = signalIcsUrl(signal.id)
    a.rel = "noopener"
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  // ── Presentation ───────────────────────────────────────────────────────────

  const dateLine = clock
    ? clock.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" }).toUpperCase()
    : ""
  const timeLine = clock
    ? clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : ""
  const nextSweep = clock
    ? `${String(((Math.floor(clock.getHours() / 4) + 1) * 4) % 24).padStart(2, "0")}:00`
    : ""

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto">
      <AmbientField load={actionSignals.length} allClear={allClear && !loading} />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* ── Instrument readout — deliberately not a greeting ─────────────── */}
        <header className="mb-6">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="tars-label tars-label--moss">brief</span>
            <span className="tars-label">· {dateLine}</span>
            <span className="tars-label">· {timeLine}</span>
            <button
              onClick={() => void load()}
              className="ml-1 p-1 rounded transition-opacity hover:opacity-100 opacity-50"
              style={{ color: "var(--c-ink-faint)" }}
              title="Refresh"
              aria-label="Refresh signals"
            >
              <RefreshCw size={12} />
            </button>
          </div>
          <div className="flex items-baseline gap-4 mt-2 flex-wrap">
            <span
              key={readout.lead}
              className="tars-title inline-block"
              style={{
                color: "var(--c-ink)",
                animation: "tars-count-tick 320ms cubic-bezier(0.25, 1, 0.5, 1)",
              }}
            >
              {loading ? "Reading your day" : readout.lead}
            </span>
            {!loading && readout.aside && (
              <span className="tars-label">{readout.aside}</span>
            )}
            {events.length > 0 && (
              <span className="tars-label">{events.length} meetings</span>
            )}
            {overdue.length > 0 && (
              <span className="tars-label" style={{ color: "var(--c-rose)" }}>
                {overdue.length} tasks overdue
              </span>
            )}
          </div>
        </header>

        {error && (
          <div
            className="card mb-5 flex items-center justify-between gap-3"
            style={{ borderColor: "color-mix(in srgb, var(--c-rose) 50%, var(--c-border))" }}
          >
            <span className="text-sm" style={{ color: "var(--c-ink-muted)" }}>
              {error}
            </span>
            <button
              onClick={() => void load()}
              className="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium"
              style={{ backgroundColor: "var(--c-moss)", color: "var(--c-canvas)" }}
            >
              Retry
            </button>
          </div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* ── Main column ──────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Skeletons, not a spinner — the shape of the answer arrives
                before the answer does. */}
            {loading && (
              <div className="flex flex-col gap-3">
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="card"
                    style={{ height: "7rem", opacity: 1 - i * 0.25 }}
                  >
                    <div
                      className="rounded"
                      style={{ width: "5rem", height: "0.5rem", backgroundColor: "var(--c-surface-2)" }}
                    />
                    <div
                      className="rounded mt-3"
                      style={{ width: "70%", height: "0.75rem", backgroundColor: "var(--c-surface-2)" }}
                    />
                    <div
                      className="rounded mt-4"
                      style={{ width: "6rem", height: "1.5rem", backgroundColor: "var(--c-surface-2)" }}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Needs you — grouped by urgency, never truncated */}
            {!loading && !allClear && (
              <div className="mb-8">
                {GROUP_ORDER.map(group => {
                  const items = actionSignals.filter(s => s.urgency === group)
                  if (items.length === 0) return null
                  return (
                    <section key={group} className="mb-6 last:mb-0">
                      <div className="flex items-baseline gap-2 mb-3">
                        <span className="tars-label" style={{ color: GROUP_COLOR[group] }}>
                          {GROUP_LABEL[group]}
                        </span>
                        <span className="tars-label tars-label--muted">{items.length}</span>
                      </div>
                      <div className="flex flex-col gap-3">
                        {items.map(signal => (
                          <SignalCard
                            key={signal.id}
                            signal={signal}
                            onAct={handleAct}
                            onResolve={handleResolve}
                            onCompose={handleCompose}
                            onSnooze={handleSnooze}
                            onDismiss={handleDismiss}
                            onAddToCalendar={handleAddToCalendar}
                          />
                        ))}
                      </div>
                    </section>
                  )
                })}
              </div>
            )}

            {/* Blank slate — three states, because a blank list means three
                different things. */}
            {!loading && allClear && !error && (
              <div
                className="flex flex-col items-center justify-center text-center py-20 mb-8"
                style={{ animation: "tars-boot-in 700ms cubic-bezier(0.25, 1, 0.5, 1)" }}
              >
                {blankKind === "earned" && (
                  <>
                    <span
                      className="tars-display mb-2"
                      style={{ color: "var(--c-moss)", fontFamily: "var(--font-mono), monospace" }}
                    >
                      ALL CLEAR
                    </span>
                    <span className="text-sm" style={{ color: "var(--c-ink-muted)" }}>
                      {ALL_CLEAR_LINES[(clock ? clock.getDate() : 0) % ALL_CLEAR_LINES.length]}
                    </span>
                    <div
                      className="flex items-center gap-3 mt-6 px-3 py-2 rounded-md flex-wrap justify-center"
                      style={{ border: "1px solid var(--c-border-faint)" }}
                    >
                      <span className="tars-label">{timeLine}</span>
                      {tally.acted > 0 && (
                        <span className="tars-label" style={{ color: "var(--c-moss)" }}>
                          {tally.acted} actioned
                        </span>
                      )}
                      {tally.dismissed > 0 && (
                        <span className="tars-label tars-label--muted">{tally.dismissed} dismissed</span>
                      )}
                      {tally.snoozed > 0 && (
                        <span className="tars-label tars-label--muted">{tally.snoozed} snoozed</span>
                      )}
                      {tally.firstAt && tally.lastAt && tally.lastAt - tally.firstAt > 1500 && (
                        <span className="tars-label tars-label--muted">
                          cleared in {formatSpan(tally.lastAt - tally.firstAt)}
                        </span>
                      )}
                    </div>
                  </>
                )}

                {blankKind === "parked" && (
                  <>
                    <span
                      className="tars-display mb-2"
                      style={{ color: "var(--c-amber)", fontFamily: "var(--font-mono), monospace" }}
                    >
                      ALL PARKED
                    </span>
                    <span className="text-sm" style={{ color: "var(--c-ink-muted)" }}>
                      Nothing done, everything deferred. {tally.snoozed} come back tonight.
                    </span>
                  </>
                )}

                {blankKind === "quiet" && (
                  <>
                    <span
                      className="tars-display mb-2"
                      style={{ color: "var(--c-ink-faint)", fontFamily: "var(--font-mono), monospace" }}
                    >
                      NOTHING IN
                    </span>
                    <span
                      className="text-sm max-w-sm"
                      style={{ color: "var(--c-ink-muted)", textWrap: "pretty" }}
                    >
                      No signals this sweep. TARS reads your inbox, meeting
                      transcripts, calendar, and open projects, and surfaces only
                      what needs a decision.
                    </span>
                    <span className="tars-label tars-label--muted mt-4">
                      next sweep {nextSweep}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* FYI — awareness only, no card weight */}
            {!loading && fyiSignals.length > 0 && (
              <>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="tars-label">fyi</span>
                  <span className="tars-label tars-label--muted">{fyiSignals.length}</span>
                </div>
                <ul className="flex flex-col gap-2 mb-8">
                  {fyiSignals.map(item => (
                    <li key={item.id} className="flex items-start gap-2.5 text-sm">
                      <span className="tars-label shrink-0 mt-[3px]">
                        {item.source_label}
                        {item.context_label ? ` · ${item.context_label}` : ""}
                      </span>
                      <span style={{ color: "var(--c-ink-muted)", textWrap: "pretty" }}>
                        {item.title}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          {/* ── Right rail — today's fixed shape ──────────────────────────── */}
          <aside className="lg:w-72 shrink-0 flex flex-col gap-4">
            <div className="card" style={{ padding: "0.875rem 1rem" }}>
              <span className="tars-label">today</span>
              {events.length === 0 ? (
                <p className="text-[0.8125rem] mt-3" style={{ color: "var(--c-ink-faint)" }}>
                  Nothing on the calendar.
                </p>
              ) : (
                <div className="flex flex-col gap-3 mt-3">
                  {events.map(ev => (
                    <div key={ev.id} className="flex items-start gap-2.5">
                      <span
                        className="tars-label shrink-0 mt-[3px]"
                        style={{ color: "var(--c-ink-muted)" }}
                      >
                        {new Date(ev.start).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[0.8125rem] leading-snug" style={{ color: "var(--c-ink)" }}>
                          {ev.title}
                        </p>
                      </div>
                      <Video size={11} style={{ color: "var(--c-ink-faint)", marginTop: 3 }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {overdue.length > 0 && (
              <div className="card" style={{ padding: "0.875rem 1rem" }}>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle size={11} style={{ color: "var(--c-rose)" }} />
                  <span className="tars-label" style={{ color: "var(--c-rose)" }}>overdue</span>
                </div>
                <div className="flex flex-col gap-2 mt-3">
                  {overdue.map(t => (
                    <button
                      key={t.id}
                      onClick={() => router.push(`/tasks?id=${t.id}`)}
                      className="text-left text-[0.8125rem] leading-snug transition-opacity hover:opacity-70"
                      style={{ color: "var(--c-ink)" }}
                    >
                      {t.title}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>
      </div>

      {/* ── Undo bar ────────────────────────────────────────────────────────── */}
      {undo && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-lg overflow-hidden"
          style={{
            bottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))",
            backgroundColor: "var(--c-ink)",
            color: "var(--c-canvas)",
            animation: "tars-pill-in 220ms cubic-bezier(0.25, 1, 0.5, 1)",
          }}
        >
          <span
            key={undo.id}
            className="absolute bottom-0 left-0 h-[2px]"
            style={{
              backgroundColor: "var(--c-moss)",
              animation: "tars-undo-drain 5s linear forwards",
            }}
            aria-hidden="true"
          />
          <span className="tars-label" style={{ color: "var(--c-canvas)" }}>{undo.label}</span>
          <button
            onClick={() => void handleUndo()}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          >
            <Undo2 size={13} />
            <span className="tars-label" style={{ color: "var(--c-canvas)" }}>undo</span>
          </button>
        </div>
      )}

      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-lg"
          style={{
            bottom: "calc(8rem + env(safe-area-inset-bottom, 0px))",
            backgroundColor: "var(--c-surface)",
            border: "1px solid var(--c-rose)",
            animation: "tars-pill-in 220ms cubic-bezier(0.25, 1, 0.5, 1)",
          }}
        >
          <span className="tars-label" style={{ color: "var(--c-rose)" }}>{toast}</span>
        </div>
      )}
    </div>
  )
}
