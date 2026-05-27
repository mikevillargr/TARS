"use client"

import { useState } from "react"
import { Cpu, ChevronRight, Plus, X, CheckCircle, XCircle, Loader2, AlertCircle, Check } from "lucide-react"
import { MOCK_AGENT_JOBS } from "@/lib/mock-ui-data"

type AgentJob = typeof MOCK_AGENT_JOBS[number]

function StatusIcon({ status }: { status: string }) {
  if (status === "Running") {
    return (
      <span
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: "#e3ede9" }}
      >
        <Loader2 size={16} className="animate-spin" style={{ color: "#2d5a4f" }} />
      </span>
    )
  }
  if (status === "Needs Input") {
    return (
      <span
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: "#f5e8d5" }}
      >
        <AlertCircle size={16} style={{ color: "#b8651a" }} />
      </span>
    )
  }
  if (status === "Done") {
    return (
      <span
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: "#efeadf" }}
      >
        <CheckCircle size={16} style={{ color: "#6b6357" }} />
      </span>
    )
  }
  // Failed
  return (
    <span
      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
      style={{ backgroundColor: "#f0dcdc" }}
    >
      <XCircle size={16} style={{ color: "#a04848" }} />
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
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: "#f6f3ec" }}>
      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: "#e3ede9" }}
            >
              <Cpu size={17} style={{ color: "#2d5a4f" }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#1a1714] leading-tight" style={{ fontFamily: "var(--font-heading), serif" }}>
                Agent Jobs
              </h1>
              <p className="text-xs text-[#948a7b]">Delegated tasks executing autonomously.</p>
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
                outline: selected?.id === job.id ? "2px solid #2d5a4f" : "none",
                outlineOffset: "1px",
              }}
            >
              <StatusIcon status={job.status} />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#1a1714] leading-snug truncate">{job.instruction}</p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <code
                    className="text-[11px] rounded px-1.5 py-0.5 font-mono"
                    style={{ backgroundColor: "#efeadf", color: "#6b6357" }}
                  >
                    {job.context}
                  </code>
                  <span className="text-[11px] text-[#948a7b]">{job.duration}</span>
                  <span className="text-[11px] text-[#948a7b]">{formatCreated(job.created)}</span>
                </div>
              </div>

              <StatusBadge status={job.status} />
              <ChevronRight size={15} style={{ color: "#948a7b", flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel ── */}
      {selected && (
        <div
          className="w-[340px] border-l flex flex-col shrink-0 overflow-y-auto"
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "#d8d2c4" }}
          >
            <div className="flex items-center gap-2">
              <StatusBadge status={selected.status} />
              <span className="text-xs text-[#948a7b]">{selected.duration}</span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md transition-colors"
              style={{ color: "#6b6357" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-4 flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold text-[#1a1714] leading-snug">{selected.instruction}</p>
              <div className="mt-2 flex items-center gap-2">
                <code
                  className="text-[11px] rounded px-1.5 py-0.5 font-mono"
                  style={{ backgroundColor: "#efeadf", color: "#6b6357" }}
                >
                  {selected.context}
                </code>
                <span className="text-[11px] text-[#948a7b]">{formatCreated(selected.created)}</span>
              </div>
            </div>

            {/* Needs Input approval */}
            {selected.status === "Needs Input" && (
              <div
                className="rounded-lg p-3 flex flex-col gap-3"
                style={{ backgroundColor: "#f5e8d5", border: "1px solid rgba(184,101,26,0.2)" }}
              >
                <div className="flex items-start gap-2">
                  <AlertCircle size={14} style={{ color: "#b8651a", marginTop: 1, flexShrink: 0 }} />
                  <p className="text-xs font-medium" style={{ color: "#b8651a" }}>
                    TARS needs your input to continue.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    className="flex-1 flex items-center justify-center gap-1 rounded-md py-1.5 text-xs font-medium transition-colors"
                    style={{ backgroundColor: "#2d5a4f", color: "#fbfaf6" }}
                  >
                    <Check size={12} /> Approve
                  </button>
                  <button
                    className="flex-1 rounded-md py-1.5 text-xs font-medium border transition-colors"
                    style={{ borderColor: "#d8d2c4", color: "#6b6357", backgroundColor: "#fbfaf6" }}
                  >
                    Modify
                  </button>
                  <button
                    className="flex-1 rounded-md py-1.5 text-xs font-medium transition-colors"
                    style={{ backgroundColor: "#f0dcdc", color: "#a04848" }}
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}

            {/* Terminal output */}
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-2">
                Output
              </div>
              <pre
                className="rounded-lg p-3 text-[11px] font-mono overflow-x-auto leading-relaxed"
                style={{ backgroundColor: "#1a1714", color: "#e3ede9", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
              >
                {MOCK_OUTPUT[selected.id] ?? "No output yet."}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
