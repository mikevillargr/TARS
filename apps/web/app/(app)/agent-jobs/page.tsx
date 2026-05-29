"use client"

import { useState } from "react"
import { Cpu, ChevronRight, Plus, X, CheckCircle, XCircle, Loader2, AlertCircle, Check } from "lucide-react"
import { MOCK_AGENT_JOBS } from "@/lib/mock-ui-data"

type AgentJob = typeof MOCK_AGENT_JOBS[number]

function StatusIcon({ status }: { status: string }) {
  if (status === "Running") {
    return (
      <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-moss-soft)" }}>
        <Loader2 size={16} className="animate-spin" style={{ color: "var(--c-moss)" }} />
      </span>
    )
  }
  if (status === "Needs Input") {
    return (
      <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-amber-soft)" }}>
        <AlertCircle size={16} style={{ color: "var(--c-amber)" }} />
      </span>
    )
  }
  if (status === "Done") {
    return (
      <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-surface-2)" }}>
        <CheckCircle size={16} style={{ color: "var(--c-ink-muted)" }} />
      </span>
    )
  }
  return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-rose-soft)" }}>
      <XCircle size={16} style={{ color: "var(--c-rose)" }} />
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === "Running")     return <span className="badge badge-moss">Running</span>
  if (status === "Needs Input") return <span className="badge badge-amber">Needs Input</span>
  if (status === "Done")        return <span className="badge badge-neutral">Done</span>
  return <span className="badge badge-rose">Failed</span>
}

function formatCreated(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

const MOCK_OUTPUT: Record<string, string> = {
  aj1: `[09:00:01] Starting auth module refactor...\n[09:00:04] Reading src/auth/context.tsx\n[09:01:22] Applying new context provider pattern\n[09:02:14] Running TypeScript compiler...\n> tsc --noEmit\nNo errors found. Continuing...`,
  aj2: `[08:30:02] Fetching competitor URLs...\n[08:31:15] Scraped acme.io/pricing\n[08:33:44] Scraped rival.co/plans\n\n⚠ Need clarification: Found 2 pricing tiers for "Novex" but their website shows 3. Which should I use?`,
  aj3: `[16:00:02] Checking package.json...\n[16:00:08] Running npm update\n[16:01:10] Running test suite...\n✓ 142 tests passed\n[16:01:45] All tests green. Done.`,
  aj4: `[15:00:01] Connecting to infra-repo...\n[15:00:03] Running deploy script\n[15:00:30] ERROR: SSH connection to staging timed out\nDeploy aborted.`,
}

export default function AgentJobsPage() {
  const [selected, setSelected] = useState<AgentJob | null>(null)

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas">
      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-moss-soft)" }}>
              <Cpu size={17} style={{ color: "var(--c-moss)" }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>
                Agent Jobs
              </h1>
              <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>Delegated tasks executing autonomously.</p>
            </div>
          </div>
          <button className="btn-primary" style={{ padding: "0.35rem 0.75rem", fontSize: "0.8125rem" }}>
            <Plus size={14} /> New Job
          </button>
        </div>

        {/* Job list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {MOCK_AGENT_JOBS.map(job => (
            <button
              key={job.id}
              onClick={() => setSelected(prev => prev?.id === job.id ? null : job)}
              className="card flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer w-full text-left"
              style={{
                padding: "0.875rem 1rem",
                outline: selected?.id === job.id ? "2px solid var(--c-moss)" : "none",
                outlineOffset: "1px",
              }}
            >
              <StatusIcon status={job.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug truncate" style={{ color: "var(--c-ink)" }}>{job.instruction}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <code className="text-[11px] rounded px-1.5 py-0.5 font-mono"
                    style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}>
                    {job.context}
                  </code>
                  <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{job.duration}</span>
                  <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{formatCreated(job.created)}</span>
                </div>
              </div>
              <StatusBadge status={job.status} />
              <ChevronRight size={15} style={{ color: "var(--c-ink-faint)", flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      {selected && (
        <div className="w-[340px] border-l flex flex-col shrink-0 overflow-y-auto"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
          <div className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "var(--c-border)" }}>
            <div className="flex items-center gap-2">
              <StatusBadge status={selected.status} />
              <span className="text-xs" style={{ color: "var(--c-ink-faint)" }}>{selected.duration}</span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md transition-colors"
              style={{ color: "var(--c-ink-muted)" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-4 flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold leading-snug" style={{ color: "var(--c-ink)" }}>{selected.instruction}</p>
              <div className="mt-2 flex items-center gap-2">
                <code className="text-[11px] rounded px-1.5 py-0.5 font-mono"
                  style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}>
                  {selected.context}
                </code>
                <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{formatCreated(selected.created)}</span>
              </div>
            </div>

            {/* Needs Input approval */}
            {selected.status === "Needs Input" && (
              <div className="rounded-lg p-3 flex flex-col gap-3"
                style={{ backgroundColor: "var(--c-amber-soft)", border: "1px solid color-mix(in srgb, var(--c-amber) 25%, transparent)" }}>
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} style={{ color: "var(--c-amber)", marginTop: 1, flexShrink: 0 }} />
                  <p className="text-xs font-medium" style={{ color: "var(--c-amber)" }}>
                    TARS needs your input to continue.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button className="flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium transition-colors"
                    style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}>
                    <Check size={12} /> Approve
                  </button>
                  <button className="flex-1 rounded-md py-1.5 text-xs font-medium border transition-colors"
                    style={{ borderColor: "var(--c-border)", color: "var(--c-ink-muted)", backgroundColor: "var(--c-surface)" }}>
                    Modify
                  </button>
                  <button className="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors"
                    style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}>
                    Reject
                  </button>
                </div>
              </div>
            )}

            {/* Terminal output */}
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>
                Output
              </div>
              <pre className="rounded-lg p-3 text-[11px] font-mono overflow-x-auto leading-relaxed"
                style={{ backgroundColor: "#1a1714", color: "#e3ede9", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {MOCK_OUTPUT[selected.id] ?? "No output yet."}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
