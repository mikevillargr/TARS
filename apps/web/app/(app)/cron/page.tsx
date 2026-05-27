"use client"

import { useState } from "react"
import { Clock, X, Play, Pause } from "lucide-react"
import { MOCK_CRON_JOBS } from "@/lib/mock-ui-data"

type CronJob = typeof MOCK_CRON_JOBS[number]

function StatusBadge({ status }: { status: string }) {
  if (status === "Active") {
    return (
      <span className="badge badge-moss flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-[#2d5a4f] inline-block" />
        Active
      </span>
    )
  }
  if (status === "Failed") return <span className="badge badge-rose">Failed</span>
  return <span className="badge badge-neutral">{status}</span>
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onChange() }}
      className="relative inline-flex items-center shrink-0 transition-colors"
      style={{
        width: "2rem",
        height: "1.25rem",
        borderRadius: "9999px",
        backgroundColor: enabled ? "#2d5a4f" : "#d8d2c4",
      }}
      aria-label="Toggle"
    >
      <span
        className="absolute transition-transform"
        style={{
          width: "0.875rem",
          height: "0.875rem",
          borderRadius: "9999px",
          backgroundColor: "#ffffff",
          top: "50%",
          transform: `translateY(-50%) translateX(${enabled ? "1rem" : "0.125rem"})`,
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  )
}

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>(MOCK_CRON_JOBS)
  const [selected, setSelected] = useState<CronJob | null>(null)

  const toggleJob = (id: string) => {
    setJobs(prev =>
      prev.map(j => j.id === id ? { ...j, enabled: !j.enabled } : j)
    )
    setSelected(prev => prev && prev.id === id ? { ...prev, enabled: !prev.enabled } : prev)
  }

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
              style={{ backgroundColor: "#efeadf" }}
            >
              <Clock size={17} style={{ color: "#6b6357" }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#1a1714] leading-tight" style={{ fontFamily: "var(--font-heading), serif" }}>
                Cron Manager
              </h1>
              <p className="text-xs text-[#948a7b]">Scheduled recurring tasks.</p>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto p-4">
          <div
            className="rounded-xl overflow-hidden"
            style={{ backgroundColor: "#fbfaf6", border: "1px solid #d8d2c4" }}
          >
            {/* Table header */}
            <div
              className="grid text-[0.65rem] font-semibold uppercase tracking-wider px-4 py-2.5"
              style={{
                gridTemplateColumns: "2fr 2fr 1.5fr 1fr 80px",
                backgroundColor: "#efeadf",
                color: "#948a7b",
                borderBottom: "1px solid #d8d2c4",
              }}
            >
              <span>Name</span>
              <span>Schedule</span>
              <span>Next Run</span>
              <span>Status</span>
              <span className="text-center">Toggle</span>
            </div>

            {/* Rows */}
            {jobs.map((job, i) => (
              <button
                key={job.id}
                onClick={() => setSelected(prev => prev?.id === job.id ? null : job)}
                className="grid w-full text-left px-4 py-3 transition-colors cursor-pointer"
                style={{
                  gridTemplateColumns: "2fr 2fr 1.5fr 1fr 80px",
                  alignItems: "center",
                  borderTop: i > 0 ? "1px solid #e8e2d4" : "none",
                  backgroundColor: selected?.id === job.id ? "#f0ece4" : "transparent",
                }}
                onMouseEnter={e => { if (selected?.id !== job.id) e.currentTarget.style.backgroundColor = "#f6f3ec" }}
                onMouseLeave={e => { if (selected?.id !== job.id) e.currentTarget.style.backgroundColor = "transparent" }}
              >
                <span className="text-sm font-medium text-[#1a1714] truncate pr-3">{job.name}</span>
                <span className="text-xs text-[#6b6357] truncate pr-3">{job.schedule}</span>
                <span className="text-xs text-[#948a7b]">{job.nextRun}</span>
                <span><StatusBadge status={job.status} /></span>
                <span className="flex justify-center">
                  <Toggle enabled={job.enabled} onChange={() => toggleJob(job.id)} />
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      {selected && (
        <div
          className="w-[320px] border-l flex flex-col shrink-0"
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "#d8d2c4" }}
          >
            <span className="text-sm font-semibold text-[#1a1714] truncate pr-2">{selected.name}</span>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md transition-colors shrink-0"
              style={{ color: "#6b6357" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#1a1714] font-medium">Enabled</span>
              <Toggle
                enabled={jobs.find(j => j.id === selected.id)?.enabled ?? false}
                onChange={() => toggleJob(selected.id)}
              />
            </div>

            {/* Schedule info */}
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-2">
                Schedule
              </div>
              <div
                className="rounded-lg p-3 text-xs text-[#1a1714] leading-relaxed"
                style={{ backgroundColor: "#efeadf" }}
              >
                <div className="font-medium mb-0.5">{selected.schedule}</div>
                <div className="text-[#948a7b]">Next run: {selected.nextRun}</div>
              </div>
            </div>

            {/* Run history */}
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-2">
                Run History
              </div>
              <div className="flex flex-col gap-2">
                {selected.runHistory.map((run, i) => (
                  <div
                    key={i}
                    className="rounded-lg p-3"
                    style={{
                      backgroundColor: "#fbfaf6",
                      border: `1px solid ${run.status === "Failed" ? "rgba(160,72,72,0.25)" : "#e8e2d4"}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className={`badge ${run.status === "Success" ? "badge-moss" : "badge-rose"}`}
                        style={{ fontSize: "0.65rem" }}
                      >
                        {run.status}
                      </span>
                      <span className="text-[10px] text-[#948a7b]">{run.duration}</span>
                    </div>
                    <div className="text-[10px] text-[#6b6357] mb-1.5">{run.timestamp}</div>
                    <pre
                      className="text-[10px] font-mono leading-relaxed overflow-x-auto"
                      style={{ color: "#6b6357", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                    >
                      {run.output}
                    </pre>
                  </div>
                ))}
              </div>
            </div>

            {/* Manual trigger */}
            <button className="btn-secondary w-full justify-center" style={{ padding: "0.4rem 0.75rem", fontSize: "0.8125rem" }}>
              <Play size={13} /> Run Now
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
