"use client"

import { AlertTriangle, X } from "lucide-react"

/**
 * A tool call that failed, with a way out that isn't retyping the request.
 *
 * Before this, a failed browse_web or chart generation just became a sentence
 * in TARS's reply — "the browser run failed: TimeoutError" — and recovering
 * meant remembering what you originally asked and typing it again, in full.
 *
 * Retry does not blindly replay the exact same call. It hands the model a
 * plain-language "try that again" naming the specific thing that failed, so
 * the model can act on WHY it failed (a stale ref wants a fresh attempt, a
 * rate limit wants a pause, a bad chart spec wants different code) instead of
 * mechanically repeating whatever just didn't work.
 *
 * Only raised for a handful of tools where failure is plausible and the
 * original request is nontrivial to retype from memory — browse_web,
 * archive_page, generate_chart, sync_meetings. Most tools that fail already
 * recover in place (an email draft's own Send button just works again).
 */

export interface ToolFailure {
  tool: string
  message: string
  retry_prompt: string
}

const TOOL_LABELS: Record<string, string> = {
  browse_web: "Browser task",
  archive_page: "Page archive",
  generate_chart: "Chart",
  sync_meetings: "Meeting sync",
}

export function ToolFailedCard({
  failure,
  onRetry,
  onDismiss,
}: {
  failure: ToolFailure
  onRetry: (prompt: string) => void
  onDismiss?: () => void
}) {
  const label = TOOL_LABELS[failure.tool] ?? failure.tool

  return (
    <div
      className="flex items-start gap-3 rounded-xl px-3.5 py-2.5 max-w-lg"
      style={{ border: "1px solid var(--c-rose)", backgroundColor: "var(--c-rose-soft)" }}
    >
      <div className="shrink-0 mt-0.5" style={{ color: "var(--c-rose)" }}>
        <AlertTriangle size={15} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="tars-label" style={{ color: "var(--c-rose)" }}>{label.toUpperCase()} FAILED</p>
        <p className="text-sm mt-0.5" style={{ color: "var(--c-ink)" }}>{failure.message}</p>
        <button
          onClick={() => onRetry(failure.retry_prompt)}
          className="tars-label mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md"
          style={{ background: "var(--c-rose)", color: "var(--c-canvas)" }}
        >
          RETRY
        </button>
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="p-1 shrink-0" style={{ color: "var(--c-rose)" }} title="Dismiss">
          <X size={11} />
        </button>
      )}
    </div>
  )
}
