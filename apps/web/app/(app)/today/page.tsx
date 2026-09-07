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
} from "@/lib/today-mock"

// ─── Status model ────────────────────────────────────────────────────────────
// Mirrors the proposed Signal.status column. Dismissal is never destructive:
// cleared items remain visitable, which is what makes fast triage safe.

type SignalStatus = "open" | "snoozed" | "cleared" | "done"

interface PendingUndo {
  id: string
  label: string
  previous: SignalStatus
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
    (signal: Signal) => {
      // MOCK — production dispatches to the existing tool endpoints
      // (send_email / create_task / update_calendar_event / …).
      setStatus(signal.id, "done", `${signal.action.label} — done`)
      setToast(`${signal.action.label} → would call ${signal.action.kind}()`)
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
  const dateLine = clock
    ? clock
        .toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" })
        .toUpperCase()
    : ""
  const timeLine = clock
    ? clock.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
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
            <span className="tars-title" style={{ color: "var(--c-ink)" }}>
              {allClear ? "All clear" : `${openSignals.length} need you`}
            </span>
            <span className="tars-label">{MOCK_MEETINGS.length} meetings</span>
            <span className="tars-label" style={{ color: "var(--c-rose)" }}>
              {MOCK_OVERDUE.length} overdue
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

            {/* Needs you */}
            {!allClear && (
              <>
                <div className="flex items-baseline gap-2 mb-3">
                  <span className="tars-label">needs you</span>
                  <span className="tars-label tars-label--moss">{openSignals.length}</span>
                </div>
                <div className="flex flex-col gap-3 mb-8">
                  {openSignals.map(signal => (
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
              </>
            )}

            {/* All-clear state — the field calms, the machine reports in */}
            {allClear && (
              <div
                className="flex flex-col items-center justify-center text-center py-20 mb-8"
                style={{ animation: "tars-boot-in 700ms ease-out" }}
              >
                <span
                  className="tars-display mb-2"
                  style={{ color: "var(--c-moss)", fontFamily: "var(--font-mono), monospace" }}
                >
                  ALL CLEAR
                </span>
                <span className="tars-label">
                  {dateLine} · {timeLine} · nothing needs you
                </span>
                {snoozedCount > 0 && (
                  <span className="tars-label tars-label--muted mt-3">
                    {snoozedCount} snoozed for later
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
          className="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5 rounded-lg"
          style={{
            bottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))",
            backgroundColor: "var(--c-ink)",
            color: "var(--c-canvas)",
            animation: "tars-pill-in 220ms ease-out",
          }}
        >
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
