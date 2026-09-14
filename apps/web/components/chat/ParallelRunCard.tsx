"use client"

import { useState } from "react"
import { Check, ChevronDown, Loader2, Network, X } from "lucide-react"

/**
 * Live view of an orchestrate_parallel run — N headless sub-agents fanned out
 * from one chat turn.
 *
 * During streaming this is fed by parallel_started / subtask_progress /
 * subtask_done SSE events; after the turn it re-renders from the persisted
 * parallel_run tool_result. Same card both ways: expanded with rolling
 * one-line previews while anything is running, collapsed to an outcome
 * summary once every subtask settles.
 */

export interface ParallelSubtask {
  index: number
  title: string
  role?: string | null
  model?: string | null
  status: "running" | "done" | "failed"
  preview?: string
  tokens?: number
}

export interface ParallelRun {
  run_id: string
  subtasks: ParallelSubtask[]
}

function StatusDot({ status }: { status: ParallelSubtask["status"] }) {
  if (status === "running") {
    return <Loader2 size={11} className="animate-spin shrink-0" style={{ color: "var(--c-moss)" }} />
  }
  if (status === "done") {
    return (
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}
      >
        <Check size={10} />
      </span>
    )
  }
  return (
    <span
      className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
      style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}
    >
      <X size={10} />
    </span>
  )
}

export function ParallelRunCard({
  run,
  onDismiss,
}: {
  run: ParallelRun
  onDismiss?: () => void
}) {
  const anyRunning = run.subtasks.some((s) => s.status === "running")
  // null = follow the run's lifecycle (open while running, collapse once it
  // settles — the synthesis text below is the thing to read then); once the
  // user toggles, their choice sticks.
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = userOpen ?? anyRunning

  const doneCount = run.subtasks.filter((s) => s.status === "done").length
  const failedCount = run.subtasks.filter((s) => s.status === "failed").length
  const summary = anyRunning
    ? `${doneCount + failedCount}/${run.subtasks.length} SETTLED`
    : failedCount > 0
      ? `${doneCount} DONE · ${failedCount} FAILED`
      : `${doneCount} DONE`

  return (
    <div
      className="rounded-xl overflow-hidden w-full max-w-2xl"
      style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-surface)" }}
    >
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}
        >
          <Network size={16} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--c-ink)" }}>
            Parallel run · {run.subtasks.length} sub-agent{run.subtasks.length !== 1 ? "s" : ""}
          </p>
          <p className="tars-label tars-label--muted">{summary}</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setUserOpen(!open)}
            className="tars-label flex items-center gap-1 px-2 py-1.5 rounded-lg"
            style={{ color: open ? "var(--c-moss)" : "var(--c-ink-faint)" }}
          >
            <ChevronDown
              size={11}
              style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 180ms" }}
            />
            DETAILS
          </button>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1" style={{ color: "var(--c-ink-faint)" }} title="Dismiss">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid var(--c-border-faint)", backgroundColor: "var(--c-canvas)" }}>
          {run.subtasks.map((s) => (
            <div
              key={s.index}
              className="flex items-start gap-2.5 px-3.5 py-2"
              style={{ borderBottom: "1px solid var(--c-border-faint)" }}
            >
              <span className="mt-0.5"><StatusDot status={s.status} /></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-xs font-medium truncate" style={{ color: "var(--c-ink)" }}>
                    {s.title}
                  </p>
                  {s.role && (
                    <span
                      className="tars-label px-1.5 py-0.5 rounded shrink-0"
                      style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}
                    >
                      {s.role.toUpperCase()}
                    </span>
                  )}
                  {s.model && (
                    <span
                      className="px-1.5 py-0.5 rounded shrink-0"
                      style={{
                        backgroundColor: "var(--c-moss-soft)",
                        color: "var(--c-moss)",
                        fontFamily: "var(--font-mono), monospace",
                        fontSize: 9,
                        letterSpacing: "0.04em",
                      }}
                    >
                      {s.model}
                    </span>
                  )}
                </div>
                {s.preview && (
                  <p
                    className="text-xs truncate mt-0.5"
                    style={{ color: s.status === "failed" ? "var(--c-rose)" : "var(--c-ink-muted)" }}
                  >
                    {s.preview}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
