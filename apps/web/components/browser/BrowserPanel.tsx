"use client"

import { useEffect, useState } from "react"
import { Pause, Play, X, Maximize2, Minimize2 } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useBrowserJob, type FeedRow } from "@/hooks/useBrowserJob"
import { BrowserViewport } from "./BrowserViewport"
import { ActionFeed } from "./ActionFeed"

interface Props {
  jobId: string | null
  task?: string
  onClose: () => void
}

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
export function BrowserPanel({ jobId, task, onClose }: Props) {
  const isMobile = useIsMobile()
  const { frame, rows, status, paused, result, control, activeBox } = useBrowserJob(jobId)
  const [expanded, setExpanded] = useState(false)   // mobile detent
  const [fullscreen, setFullscreen] = useState(false) // desktop
  const [hovered, setHovered] = useState<FeedRow | null>(null)
  const [startedAt] = useState(() => Date.now())
  const [, forceTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  if (!jobId) return null

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
                  onClick={onClose}
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
        width: fullscreen ? "100vw" : 640,
        background: "var(--c-surface)",
        borderLeft: "1px solid var(--c-border)",
      }}
    >
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
        <button onClick={onClose} title="Close" className="p-1.5" style={{ borderRadius: 4, color: "var(--c-ink-muted)" }}>
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
        <BrowserViewport frame={frame} active={highlightRow} url={lastUrl} />
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
        {live && (
          <button
            className="tars-label px-3 py-1.5"
            style={{
              borderRadius: 6,
              border: "1px solid var(--c-border)",
              color: "var(--c-ink)",
            }}
            title="Interactive control lands with the noVNC container"
            disabled
          >
            TAKE OVER
          </button>
        )}
      </footer>
    </aside>
  )
}
