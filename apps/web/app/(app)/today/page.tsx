"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, Undo2, Video, AlertTriangle } from "lucide-react"
import { AmbientField } from "@/components/today/AmbientField"
import { useClockMs } from "@/hooks/useClock"
import { SignalCard } from "@/components/today/SignalCard"
import {
  MOCK_SIGNALS,
  MOCK_FYI,
  MOCK_MEETINGS,
  MOCK_OVERDUE,
  MOCK_BRIEF,
  type Signal,
  type SignalAction,
  type SignalUrgency,
} from "@/lib/today-mock"

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
 * the count of everything else sit in the mono layer beside it. The group
 * headers below carry the precise breakdown; this line only has to answer
 * "how bad is today".
 */
function buildReadout(urgent: number, rest: number): { lead: string; aside: string | null } {
  if (urgent === 0 && rest === 0) return { lead: "All clear", aside: null }
  if (urgent === 0) {
    return { lead: "Nothing urgent", aside: `${rest} when you can` }
  }
  return {
    lead: `${urgent} can't wait`,
    aside: rest > 0 ? `${rest} that can` : null,
  }
}

// ─── Status model ────────────────────────────────────────────────────────────
// Mirrors the proposed Signal.status column. Dismissal is never destructive:
// cleared items remain visitable, which is what makes fast triage safe.

type SignalStatus = "open" | "snoozed" | "cleared" | "done"

interface PendingUndo {
  id: string
  label: string
  previous: SignalStatus
}

/**
 * A blank list means three different things, and conflating them makes the
 * screen lie two-thirds of the time:
 *
 *   earned  — you worked the stack down. Reward it, and show the receipt.
 *   quiet   — nothing came in. Don't congratulate someone for an empty inbox
 *             they had no hand in; tell them what lands here and when.
 *   parked  — everything got snoozed. Nothing is done. Saying "all clear"
 *             here is the fastest way to teach someone to distrust a readout.
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
  acted: 0,
  dismissed: 0,
  snoozed: 0,
  firstAt: null,
  lastAt: null,
}

function formatSpan(ms: number): string {
  const secs = Math.round(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

// ─── .ics generation ─────────────────────────────────────────────────────────

function toIcsStamp(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "")
}

function buildIcs(signal: Signal): string {
  const ev = signal.calendarEvent
  if (!ev) return ""
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TARS//Today//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${signal.id}@tarsmv.duckdns.org`,
    `DTSTAMP:${toIcsStamp(new Date().toISOString())}`,
    `DTSTART:${toIcsStamp(ev.start)}`,
    `DTEND:${toIcsStamp(ev.end)}`,
    `SUMMARY:${ev.title}`,
    ev.location ? `LOCATION:${ev.location}` : "",
    ev.notes ? `DESCRIPTION:${ev.notes}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n")
}

/**
 * MOCK ONLY — blob download.
 *
 * Production must serve this from a real endpoint
 * (`GET /api/signals/{id}/event.ics`, Content-Type: text/calendar) behind a
 * plain <a href>. Blob URLs and window.location navigation both break inside
 * the installed PWA shell — that was the v2.15.1 → v2.15.5 Second Brain export
 * saga. Do not repeat it here.
 */
function downloadIcs(signal: Signal) {
  const ics = buildIcs(signal)
  if (!ics) return
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `${signal.calendarEvent?.title.replace(/\s+/g, "-").toLowerCase()}.ics`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TodayPage() {
  const [statuses, setStatuses] = useState<Record<string, SignalStatus>>(() =>
    Object.fromEntries(MOCK_SIGNALS.map(s => [s.id, "open" as SignalStatus])),
  )
  const [briefOpen, setBriefOpen] = useState(false)
  const [undo, setUndo] = useState<PendingUndo | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [tally, setTally] = useState<SessionTally>(EMPTY_TALLY)

  // Client-only clock (avoids SSR hydration mismatch on the readout)
  const clockMs = useClockMs()
  const clock = clockMs === null ? null : new Date(clockMs)

  // Auto-expire the undo affordance
  useEffect(() => {
    if (!undo) return
    const id = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(id)
  }, [undo])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(id)
  }, [toast])

  const openSignals = useMemo(
    () => MOCK_SIGNALS.filter(s => statuses[s.id] === "open"),
    [statuses],
  )
  const snoozedCount = useMemo(
    () => Object.values(statuses).filter(s => s === "snoozed").length,
    [statuses],
  )
  const clearedCount = useMemo(
    () => Object.values(statuses).filter(s => s === "cleared" || s === "done").length,
    [statuses],
  )

  const setStatus = useCallback(
    (id: string, next: SignalStatus, undoLabel: string) => {
      setStatuses(prev => {
        setUndo({ id, label: undoLabel, previous: prev[id] })
        return { ...prev, [id]: next }
      })
      // Session receipt — recorded here rather than in an effect so there's no
      // cascading render, and so undo can't corrupt the tally after the fact.
      setTally(prev => {
        const now = Date.now()
        return {
          acted: prev.acted + (next === "done" ? 1 : 0),
          dismissed: prev.dismissed + (next === "cleared" ? 1 : 0),
          snoozed: prev.snoozed + (next === "snoozed" ? 1 : 0),
          firstAt: prev.firstAt ?? now,
          lastAt: now,
        }
      })
    },
    [],
  )

  const handleDismiss = useCallback(
    (id: string) => setStatus(id, "cleared", "Dismissed"),
    [setStatus],
  )
  const handleSnooze = useCallback(
    (id: string) => setStatus(id, "snoozed", "Snoozed until tonight"),
    [setStatus],
  )

  const handleAct = useCallback(
    (signal: Signal, action: SignalAction) => {
      // MOCK — production dispatches to the existing tool endpoints
      // (send_email / create_task / update_calendar_event / …).
      setStatus(signal.id, "done", `${action.label} — done`)
      setToast(`${action.label} → would call ${action.kind}()`)
    },
    [setStatus],
  )

  const handleAddToCalendar = useCallback((signal: Signal) => {
    downloadIcs(signal)
    setToast("Calendar file generated — native add sheet opens on device")
  }, [])

  const handleUndo = useCallback(() => {
    if (!undo) return
    setStatuses(prev => ({ ...prev, [undo.id]: undo.previous }))
    setUndo(null)
  }, [undo])

  const allClear = openSignals.length === 0
  const urgentCount = openSignals.filter(
    s => s.urgency === "overdue" || s.urgency === "time",
  ).length
  const readout = buildReadout(urgentCount, openSignals.length - urgentCount)

  // Which blank state we're in — see BlankKind. "parked" wins over "earned"
  // because deferred work isn't finished work, and claiming otherwise is the
  // kind of small lie that costs a readout its credibility.
  const touched = tally.acted + tally.dismissed + tally.snoozed
  const blankKind: BlankKind =
    snoozedCount > 0 && tally.acted + tally.dismissed === 0
      ? "parked"
      : touched > 0
        ? "earned"
        : "quiet"
  const dateLine = clock
    ? clock
        .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
        .toUpperCase()
    : ""
  const timeLine = clock
    ? clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
    : ""

  // Next inference pass. MOCK — production reads this off the actual cron
  // schedule rather than assuming a 4-hourly sweep.
  const nextSweep = clock
    ? `${String((Math.floor(clock.getHours() / 4) + 1) * 4 % 24).padStart(2, "0")}:00`
    : ""

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto">
      <AmbientField load={openSignals.length} allClear={allClear} />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* ── Instrument readout — deliberately not a greeting ─────────────── */}
        <header className="mb-6">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="tars-label tars-label--moss">brief</span>
            <span className="tars-label">· {dateLine}</span>
            <span className="tars-label">· {timeLine}</span>
          </div>
          <div className="flex items-baseline gap-4 mt-2 flex-wrap">
            {/* Re-keys on change so the tick animation replays — state
                feedback, not decoration: the verdict visibly softens as you
                clear the stack. */}
            <span
              key={readout.lead}
              className="tars-title inline-block"
              style={{
                color: "var(--c-ink)",
                animation: "tars-count-tick 320ms cubic-bezier(0.25, 1, 0.5, 1)",
              }}
            >
              {readout.lead}
            </span>
            {readout.aside && <span className="tars-label">{readout.aside}</span>}
            <span className="tars-label">{MOCK_MEETINGS.length} meetings</span>
            {/* "tasks" is load-bearing — there's also an overdue *signal*
                group below, and two different "overdue 2" readouts meaning
                different things is how you teach someone to distrust a UI. */}
            <span className="tars-label" style={{ color: "var(--c-rose)" }}>
              {MOCK_OVERDUE.length} tasks overdue
            </span>
          </div>
        </header>

        <div className="flex flex-col lg:flex-row gap-6">
          {/* ── Main column ──────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Synthesis prose — what the cron digest used to be */}
            <div className="card mb-5" style={{ padding: "0.75rem 1rem" }}>
              <button
                onClick={() => setBriefOpen(v => !v)}
                className="flex items-center gap-2 w-full text-left"
                aria-expanded={briefOpen}
              >
                <ChevronDown
                  size={13}
                  style={{
                    color: "var(--c-ink-faint)",
                    transform: briefOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    transition: "transform 180ms ease",
                  }}
                />
                <span className="tars-label">TARS&rsquo;s read on today</span>
              </button>
              {briefOpen && (
                <p
                  className="text-sm leading-relaxed mt-3"
                  style={{ color: "var(--c-ink-muted)", textWrap: "pretty" }}
                  data-selectable
                >
                  {MOCK_BRIEF}
                </p>
              )}
            </div>

            {/* Needs you — grouped by urgency, never truncated */}
            {!allClear && (
              <div className="mb-8">
                {GROUP_ORDER.map(group => {
                  const items = openSignals.filter(s => s.urgency === group)
                  if (items.length === 0) return null
                  return (
                    <section key={group} className="mb-6 last:mb-0">
                      <div className="flex items-baseline gap-2 mb-3">
                        <span
                          className="tars-label"
                          style={{
                            color:
                              group === "overdue"
                                ? "var(--c-rose)"
                                : group === "time"
                                  ? "var(--c-amber)"
                                  : "var(--c-ink-faint)",
                          }}
                        >
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
                different things. The field calms behind all of them. */}
            {allClear && (
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

                    {/* The receipt. Evidence of work done, in the machine
                        voice — this is the reward, not a confetti burst. */}
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
                        <span className="tars-label tars-label--muted">
                          {tally.dismissed} dismissed
                        </span>
                      )}
                      {tally.snoozed > 0 && (
                        <span className="tars-label tars-label--muted">
                          {tally.snoozed} snoozed
                        </span>
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
                      Nothing done, everything deferred. {snoozedCount} come back tonight.
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

                {snoozedCount > 0 && blankKind === "earned" && (
                  <span className="tars-label tars-label--muted mt-4">
                    {snoozedCount} waiting for tonight
                  </span>
                )}
              </div>
            )}

            {/* FYI — awareness only, no card weight */}
            <div className="flex items-baseline gap-2 mb-3">
              <span className="tars-label">fyi</span>
              <span className="tars-label tars-label--muted">{MOCK_FYI.length}</span>
            </div>
            <ul className="flex flex-col gap-2 mb-8">
              {MOCK_FYI.map(item => (
                <li key={item.id} className="flex items-start gap-2.5 text-sm">
                  <span className="tars-label shrink-0 mt-[3px]">{item.sourceLabel}</span>
                  <span style={{ color: "var(--c-ink-muted)", textWrap: "pretty" }}>
                    {item.text}
                  </span>
                </li>
              ))}
            </ul>

            {/* Recoverable destinations */}
            <div className="flex items-center gap-2 pt-4 border-t" style={{ borderColor: "var(--c-border-faint)" }}>
              <button
                className="px-2.5 py-1.5 rounded-md transition-colors"
                style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
              >
                <span className="tars-label">snoozed {snoozedCount}</span>
              </button>
              <button
                className="px-2.5 py-1.5 rounded-md transition-colors"
                style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
              >
                <span className="tars-label">cleared {clearedCount}</span>
              </button>
            </div>
          </div>

          {/* ── Right rail — today's fixed shape ──────────────────────────── */}
          <aside className="lg:w-72 shrink-0 flex flex-col gap-4">
            <div className="card" style={{ padding: "0.875rem 1rem" }}>
              <span className="tars-label">today</span>
              <div className="flex flex-col gap-3 mt-3">
                {MOCK_MEETINGS.map(m => (
                  <div key={m.id} className="flex items-start gap-2.5">
                    <span
                      className="tars-label shrink-0 mt-[3px]"
                      style={{ color: "var(--c-ink-muted)" }}
                    >
                      {m.time}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.8125rem] leading-snug" style={{ color: "var(--c-ink)" }}>
                        {m.title}
                      </p>
                      {m.canPrep && (
                        <button
                          className="flex items-center gap-1 mt-1 transition-opacity hover:opacity-70"
                          style={{ color: "var(--c-moss)" }}
                        >
                          <Video size={11} />
                          <span className="tars-label" style={{ color: "var(--c-moss)" }}>
                            prep
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: "0.875rem 1rem" }}>
              <div className="flex items-center gap-1.5">
                <AlertTriangle size={11} style={{ color: "var(--c-rose)" }} />
                <span className="tars-label" style={{ color: "var(--c-rose)" }}>
                  overdue
                </span>
              </div>
              <div className="flex flex-col gap-2 mt-3">
                {MOCK_OVERDUE.map(o => (
                  <div key={o.id} className="flex items-start justify-between gap-2">
                    <span className="text-[0.8125rem] leading-snug" style={{ color: "var(--c-ink)" }}>
                      {o.title}
                    </span>
                    <span className="tars-label shrink-0">{o.age}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Undo bar — makes dismissal safe ─────────────────────────────────── */}
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
          {/* Draining hairline — shows how long undo stays available, so the
              5s window is legible instead of a guess. */}
          <span
            key={undo.id}
            className="absolute bottom-0 left-0 h-[2px]"
            style={{
              backgroundColor: "var(--c-moss)",
              animation: "tars-undo-drain 5s linear forwards",
            }}
            aria-hidden="true"
          />
          <span className="tars-label" style={{ color: "var(--c-canvas)" }}>
            {undo.label}
          </span>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 transition-opacity hover:opacity-70"
          >
            <Undo2 size={13} />
            <span className="tars-label" style={{ color: "var(--c-canvas)" }}>
              undo
            </span>
          </button>
        </div>
      )}

      {/* ── Mock action feedback ────────────────────────────────────────────── */}
      {toast && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-lg"
          style={{
            bottom: "calc(8rem + env(safe-area-inset-bottom, 0px))",
            backgroundColor: "var(--c-surface)",
            border: "1px solid var(--c-moss)",
            animation: "tars-pill-in 220ms ease-out",
          }}
        >
          <span className="tars-label" style={{ color: "var(--c-moss)" }}>
            {toast}
          </span>
        </div>
      )}
    </div>
  )
}
