"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Pause, Play, X, Maximize2, Minimize2 } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useSidebar } from "@/components/ui/sidebar"
import { useBrowserJob, type FeedRow } from "@/hooks/useBrowserJob"
import { BrowserViewport } from "./BrowserViewport"
import { ActionFeed } from "./ActionFeed"

interface Props {
  jobId: string | null
  task?: string
  /** Closing hides the panel; it does NOT end the run. Reopen from the pill. */
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MIN_W = 420
const MAX_W = 980
const DEFAULT_W = 640

function elapsed(from: number | null) {
  if (!from) return "00:00"
  const s = Math.max(0, Math.floor((Date.now() - from) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`
}

/**
 * Live browser observation.
 *
 * Desktop is a wide drawer (~640px): TARS's normal right panel is too narrow
 * for a 16:10 viewport to be readable, and a viewport you have to squint at is
 * worse than none.
 *
 * Mobile is a two-detent bottom sheet and deliberately does NOT offer take-over.
 * Driving a 1280px desktop viewport with a thumb is miserable, so the phone's
 * job is watch-and-decide: the primary action holds the run so it can be picked
 * up on a real screen. Same split TARS already makes elsewhere.
 */
export function BrowserPanel({ jobId, task, open, onOpenChange }: Props) {
  const isMobile = useIsMobile()
  const { frame, rows, status, paused, result, control, activeBox } = useBrowserJob(jobId)
  const [expanded, setExpanded] = useState(false)   // mobile detent
  const [fullscreen, setFullscreen] = useState(false) // desktop
  const [hovered, setHovered] = useState<FeedRow | null>(null)
  const [driving, setDriving] = useState(false)
  const [vnc, setVnc] = useState<{ takeover: boolean; vnc_url: string | null } | null>(null)
  const [startedAt] = useState(() => Date.now())
  const [width, setWidth] = useState(DEFAULT_W)
  const [dragging, setDragging] = useState(false)
  const [, forceTick] = useState(0)
  const sidebar = useSidebar()
  const restoreSidebar = useRef<boolean | null>(null)

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Take-over needs the browser container; local dev runs a headless Chromium
  // with no display to attach to. Ask rather than assume, so the control is
  // absent where it cannot work instead of opening a dead iframe.
  useEffect(() => {
    let alive = true
    // no-store: a cached capabilities response is how a client ends up with a
    // stale vnc_url and silently connects to the wrong websockify path.
    fetch("/api/proxy/browser/capabilities", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setVnc(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  // Push the page aside and collapse the nav to a rail while open. Not hidden
  // entirely — losing navigation to watch a browser run is a bad trade, and
  // every split-view reference (Suno, Twist, VS Code) keeps a rail.
  useEffect(() => {
    const showing = open && !!jobId && !isMobile
    document.documentElement.style.setProperty(
      "--browser-panel-w",
      showing ? `${fullscreen ? window.innerWidth : width}px` : "0px",
    )
    if (showing) {
      if (restoreSidebar.current === null) restoreSidebar.current = sidebar.open
      if (sidebar.open) sidebar.setOpen(false)
    } else if (restoreSidebar.current !== null) {
      if (restoreSidebar.current) sidebar.setOpen(true)
      restoreSidebar.current = null
    }
    return () => {
      document.documentElement.style.setProperty("--browser-panel-w", "0px")
    }
  }, [open, jobId, isMobile, width, fullscreen, sidebar])

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const move = (ev: PointerEvent) => {
      const next = Math.min(MAX_W, Math.max(MIN_W, window.innerWidth - ev.clientX))
      setWidth(next)
    }
    const up = () => {
      setDragging(false)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }, [])

  const toggleDrive = async () => {
    const next = !driving
    setDriving(next)
    // Taking the wheel means the agent stops; giving it back means it resumes.
    // Both of us driving at once is the one state that must not exist.
    await control(next ? "pause" : "resume")
    if (next) setFullscreen(true)
  }

  // Hidden but alive: render nothing. The chat header's Browser button is the
  // single way back — a floating pill as well meant two controls for one
  // action, one of them sitting over the composer.
  if (!jobId) return null
  if (!open && !isMobile) return null

  const live = status === "running"
  const actionCount = rows.filter((r) => r.kind === "action").length
  const current = rows.filter((r) => r.kind === "action").slice(-1)[0]
  const highlightRow = hovered?.box ? hovered : activeBox
  const lastUrl = [...rows].reverse().find((r) => r.url)?.url

  const statusPill = (
    <span
      className="tars-label inline-flex items-center gap-1.5 px-1.5 py-0.5"
      style={{
        borderRadius: 2,
        background: live
          ? "color-mix(in srgb, var(--c-moss) 16%, transparent)"
          : "var(--c-surface-2)",
        color: live ? "var(--c-moss)" : "var(--c-ink-faint)",
      }}
    >
      <span
        className={live && !paused ? "animate-pulse" : ""}
        style={{
          width: 5,
          height: 5,
          borderRadius: 99,
          background: paused
            ? "var(--c-amber)"
            : live
              ? "var(--c-moss)"
              : "var(--c-ink-faint)",
        }}
      />
      {paused ? "HELD" : live ? "LIVE" : status === "failed" ? "FAILED" : "DONE"}
    </span>
  )

  // ── Mobile: bottom sheet, two detents ────────────────────────────────────
  if (isMobile) {
    return (
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col"
        style={{
          background: "var(--c-surface)",
          borderTop: "1px solid var(--c-border)",
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          height: expanded ? "85vh" : "auto",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          boxShadow: "0 -8px 32px color-mix(in srgb, var(--c-ink) 12%, transparent)",
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center gap-2 px-4 py-3"
          aria-label={expanded ? "Collapse browser panel" : "Expand browser panel"}
        >
          {statusPill}
          <span className="tars-label tars-label--muted flex-1 truncate text-left">
            {lastUrl?.replace(/^https?:\/\//, "").split("/")[0] ?? "BROWSER"}
          </span>
          <span className="tars-label tars-label--muted">{elapsed(startedAt)}</span>
        </button>

        {!expanded && (
          <div className="flex flex-col gap-2 px-4 pb-4">
            <div className="flex items-baseline gap-2">
              <span className="tars-label" style={{ color: "var(--c-moss)" }}>
                {current?.name?.toUpperCase() ?? "STARTING"}
              </span>
              {current?.label && (
                <span className="truncate text-[13px]" style={{ color: "var(--c-ink)" }}>
                  {current.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div
                className="h-[3px] flex-1 overflow-hidden"
                style={{ background: "var(--c-surface-2)", borderRadius: 2 }}
              >
                <div
                  className="h-full transition-all duration-500"
                  style={{
                    width: `${Math.min(100, actionCount * 8)}%`,
                    background: paused ? "var(--c-amber)" : "var(--c-moss)",
                  }}
                />
              </div>
              <span className="tars-label tars-label--muted shrink-0">
                {actionCount} ACTION{actionCount === 1 ? "" : "S"}
              </span>
            </div>
          </div>
        )}

        {expanded && (
          <>
            <div className="px-4 pb-3">
              <BrowserViewport frame={frame} active={null} showHighlight={false} url={lastUrl} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <ActionFeed rows={rows} stacked />
              {result && (
                <p className="py-3 text-[14px] leading-relaxed" style={{ color: "var(--c-ink)" }}>
                  {result}
                </p>
              )}
            </div>
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ borderTop: "1px solid var(--c-border-faint)" }}
            >
              <span className="tars-label tars-label--muted flex-1">
                {actionCount} ACTION{actionCount === 1 ? "" : "S"}
              </span>
              {live ? (
                <button
                  onClick={() => control(paused ? "resume" : "pause")}
                  className="tars-label px-3 py-2"
                  style={{
                    borderRadius: 6,
                    border: "1px solid var(--c-border)",
                    color: "var(--c-ink)",
                  }}
                >
                  {paused ? "RESUME" : "PAUSE FOR ME"}
                </button>
              ) : (
                <button
                  onClick={() => onOpenChange(false)}
                  className="tars-label px-3 py-2"
                  style={{ borderRadius: 6, border: "1px solid var(--c-border)" }}
                >
                  CLOSE
                </button>
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  // ── Desktop: wide drawer ─────────────────────────────────────────────────
  return (
    <aside
      className="fixed right-0 top-0 z-40 flex h-full flex-col"
      style={{
        width: fullscreen ? "100vw" : width,
        background: "var(--c-surface)",
        borderLeft: "1px solid var(--c-border)",
        transition: dragging ? "none" : "width 220ms cubic-bezier(0.32, 0.72, 0, 1)",
      }}
    >
      {!fullscreen && (
        <div
          onPointerDown={startResize}
          className="group absolute left-0 top-0 h-full"
          style={{ width: 7, marginLeft: -3, cursor: "col-resize", touchAction: "none" }}
          title="Drag to resize"
        >
          <div
            className="mx-auto h-full transition-colors"
            style={{
              width: 1,
              background: dragging ? "var(--c-moss)" : "transparent",
            }}
          />
        </div>
      )}
      <header
        className="flex items-center gap-2.5 px-4 py-3"
        style={{ borderBottom: "1px solid var(--c-border-faint)" }}
      >
        {statusPill}
        <span className="tars-label flex-1 truncate" style={{ color: "var(--c-ink)" }}>
          BROWSER
          {lastUrl && ` · ${lastUrl.replace(/^https?:\/\//, "").split("/")[0].toUpperCase()}`}
        </span>
        {live && (
          <button
            onClick={() => control(paused ? "resume" : "pause")}
            title={paused ? "Resume" : "Pause between turns"}
            className="p-1.5"
            style={{ borderRadius: 4, color: "var(--c-ink-muted)" }}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        )}
        <button
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? "Exit full screen" : "Full screen"}
          className="p-1.5"
          style={{ borderRadius: 4, color: "var(--c-ink-muted)" }}
        >
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button
          onClick={() => onOpenChange(false)}
          title="Hide (the run keeps going)"
          className="p-1.5"
          style={{ borderRadius: 4, color: "var(--c-ink-muted)" }}
        >
          <X size={14} />
        </button>
      </header>

      {task && (
        <p
          className="px-4 py-2.5 text-[13px] leading-relaxed"
          style={{ color: "var(--c-ink-muted)", borderBottom: "1px solid var(--c-border-faint)" }}
        >
          {task}
        </p>
      )}

      <div className="px-4 py-3">
        {driving && vnc?.vnc_url ? (
          <div className="flex flex-col gap-1.5">
            <iframe
              src={vnc.vnc_url}   /* full URL incl. params comes from the harness */
              title="Browser take-over"
              className="w-full"
              style={{
                aspectRatio: "16 / 10",
                borderRadius: 2,
                border: "1px solid var(--c-amber)",
                background: "var(--c-surface-2)",
              }}
            />
            <span className="tars-label" style={{ color: "var(--c-amber)" }}>
              YOU HAVE THE WHEEL · AGENT HELD
            </span>
          </div>
        ) : (
          <BrowserViewport frame={frame} active={highlightRow} url={lastUrl} />
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto px-4 py-1"
        style={{ borderTop: "1px solid var(--c-border-faint)" }}
      >
        <ActionFeed rows={rows} onHoverRow={setHovered} />
        {result && (
          <p className="py-3 text-[14px] leading-relaxed" style={{ color: "var(--c-ink)" }}>
            {result}
          </p>
        )}
      </div>

      <footer
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderTop: "1px solid var(--c-border-faint)" }}
      >
        <span className="tars-label tars-label--muted">
          {actionCount} ACTION{actionCount === 1 ? "" : "S"}
        </span>
        <span className="tars-label tars-label--muted">{elapsed(startedAt)}</span>
        <div className="flex-1" />
        {live && vnc?.takeover && (
          <button
            onClick={toggleDrive}
            className="tars-label px-3 py-1.5"
            style={{
              borderRadius: 6,
              border: `1px solid ${driving ? "var(--c-amber)" : "var(--c-border)"}`,
              color: driving ? "var(--c-amber)" : "var(--c-ink)",
            }}
            title={driving ? "Hand control back to the agent" : "Drive the browser yourself"}
          >
            {driving ? "HAND BACK" : "TAKE OVER"}
          </button>
        )}
      </footer>
    </aside>
  )
}
