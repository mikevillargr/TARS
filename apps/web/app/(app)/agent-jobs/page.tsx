"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Cpu, ChevronRight, Plus, X, CheckCircle, XCircle, Loader2, AlertCircle, ExternalLink } from "lucide-react"
import AgentJobStream from "@/components/agent-jobs/AgentJobStream"

// ── Types ──────────────────────────────────────────────────────────────────────

interface AgentJob {
  id: string
  agent_type: string
  instruction: string
  status: string
  branch: string
  pr_url?: string
  parent_job_id?: string
  created_at: string
  started_at?: string
  completed_at?: string
}

// ── Status helpers ─────────────────────────────────────────────────────────────

function uiStatus(status: string): string {
  if (status === "running") return "Running"
  if (status === "awaiting_approval") return "Needs Input"
  if (status === "completed") return "Done"
  if (status === "failed" || status === "cancelled") return status === "cancelled" ? "Cancelled" : "Failed"
  return "Pending"
}

function StatusIcon({ status }: { status: string }) {
  const s = uiStatus(status)
  if (s === "Running") return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-moss-soft)" }}>
      <Loader2 size={16} className="animate-spin" style={{ color: "var(--c-moss)" }} />
    </span>
  )
  if (s === "Needs Input") return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-amber-soft)" }}>
      <AlertCircle size={16} style={{ color: "var(--c-amber)" }} />
    </span>
  )
  if (s === "Done") return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-surface-2)" }}>
      <CheckCircle size={16} style={{ color: "var(--c-ink-muted)" }} />
    </span>
  )
  if (s === "Pending") return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-surface-2)" }}>
      <Loader2 size={16} style={{ color: "var(--c-ink-faint)" }} />
    </span>
  )
  return (
    <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-rose-soft)" }}>
      <XCircle size={16} style={{ color: "var(--c-rose)" }} />
    </span>
  )
}

function StatusBadge({ status }: { status: string }) {
  const s = uiStatus(status)
  if (s === "Running")     return <span className="badge badge-moss">Running</span>
  if (s === "Needs Input") return <span className="badge badge-amber">Needs Input</span>
  if (s === "Done")        return <span className="badge badge-neutral">Done</span>
  if (s === "Pending")     return <span className="badge badge-neutral">Pending</span>
  if (s === "Cancelled")   return <span className="badge badge-neutral">Cancelled</span>
  return <span className="badge badge-rose">Failed</span>
}

function agentTypeLabel(t: string): string {
  const map: Record<string, string> = {
    evolutionarist: "Evolutionarist",
    frontend: "Front-End",
    backend: "Back-End",
    sa: "Solutions Architect",
    release: "Release",
  }
  return map[t] ?? t
}

function formatCreated(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

const AGENT_TYPES = [
  { value: "evolutionarist", label: "Evolutionarist (auto-route)" },
  { value: "frontend", label: "Front-End Agent" },
  { value: "backend", label: "Back-End Agent" },
  { value: "sa", label: "Solutions Architect" },
  { value: "release", label: "Release" },
]

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AgentJobsPage() {
  return (
    <Suspense fallback={null}>
      <AgentJobsPageInner />
    </Suspense>
  )
}

function AgentJobsPageInner() {
  const searchParams = useSearchParams()
  const autoSelectId = searchParams.get("id")
  const didAutoSelect = useRef(false)

  const [jobs, setJobs] = useState<AgentJob[]>([])
  const [selected, setSelected] = useState<AgentJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [showNewJob, setShowNewJob] = useState(false)
  const [newInstruction, setNewInstruction] = useState("")
  const [newType, setNewType] = useState("evolutionarist")
  const [creating, setCreating] = useState(false)
  const [needsAttention, setNeedsAttention] = useState(false)

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/agent-jobs")
      if (res.ok) {
        const data = await res.json()
        setJobs(data.items ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadJobs()
    // Poll for status updates on running jobs every 5s
    const interval = setInterval(loadJobs, 5000)
    return () => clearInterval(interval)
  }, [loadJobs])

  // Auto-select job from ?id= query param (from "Watch live" / "Full view" links)
  useEffect(() => {
    if (!autoSelectId || didAutoSelect.current) return
    const match = jobs.find(j => j.id === autoSelectId)
    if (match) {
      setSelected(match)
      didAutoSelect.current = true
    }
  }, [autoSelectId, jobs])

  async function handleCreate() {
    if (!newInstruction.trim()) return
    setCreating(true)
    try {
      const res = await fetch("/api/proxy/agent-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: newInstruction.trim(), agent_type: newType }),
      })
      if (res.ok) {
        const job = await res.json() as AgentJob
        setJobs(prev => [job, ...prev])
        setSelected(job)
        setShowNewJob(false)
        setNewInstruction("")
        setNewType("evolutionarist")
      }
    } finally {
      setCreating(false)
    }
  }

  const activeJobs = jobs.filter(j => j.parent_job_id == null)

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas">
      {/* ── Main list ── */}
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
          <button
            className="btn-primary"
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.8125rem" }}
            onClick={() => setShowNewJob(true)}
          >
            <Plus size={14} /> New Job
          </button>
        </div>

        {/* Job list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {loading && (
            <div className="flex items-center gap-2 py-8 justify-center" style={{ color: "var(--c-ink-faint)" }}>
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          )}
          {!loading && activeJobs.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-16" style={{ color: "var(--c-ink-faint)" }}>
              <Cpu size={32} style={{ opacity: 0.3 }} />
              <p className="text-sm">No agent jobs yet.</p>
              <button className="btn-primary text-sm" onClick={() => setShowNewJob(true)}>
                <Plus size={14} /> Create your first job
              </button>
            </div>
          )}
          {activeJobs.map(job => (
            <button
              key={job.id}
              onClick={() => { setSelected(prev => prev?.id === job.id ? null : job); setNeedsAttention(false) }}
              className="card flex items-center gap-3 hover:shadow-md transition-shadow cursor-pointer w-full text-left"
              style={{
                padding: "0.875rem 1rem",
                outline: selected?.id === job.id ? "2px solid var(--c-moss)" : "none",
                outlineOffset: "1px",
              }}
            >
              <StatusIcon status={job.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug truncate" style={{ color: "var(--c-ink)" }}>
                  {job.instruction}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <code className="text-[11px] rounded px-1.5 py-0.5 font-mono"
                    style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}>
                    {agentTypeLabel(job.agent_type)}
                  </code>
                  <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
                    {formatCreated(job.created_at)}
                  </span>
                </div>
              </div>
              <StatusBadge status={job.status} />
              <ChevronRight size={15} style={{ color: "var(--c-ink-faint)", flexShrink: 0 }} />
            </button>
          ))}
        </div>
      </div>

      {/* ── Right panel — live stream ── */}
      {selected && (
        <div className="w-[380px] border-l flex flex-col shrink-0 overflow-hidden"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
          {/* Panel header */}
          <div className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "var(--c-border)" }}>
            <div className="flex items-center gap-2 min-w-0">
              <StatusBadge status={selected.status} />
              <span className="text-xs truncate" style={{ color: "var(--c-ink-faint)" }}>
                {agentTypeLabel(selected.agent_type)}
              </span>
              {needsAttention && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold animate-pulse"
                  style={{ backgroundColor: "var(--c-amber-soft)", color: "var(--c-amber)" }}>
                  Needs input
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {selected.pr_url && (
                <a
                  href={selected.pr_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 rounded-md transition-colors flex items-center gap-1 text-[11px]"
                  style={{ color: "var(--c-moss)" }}
                >
                  PR <ExternalLink size={11} />
                </a>
              )}
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
          </div>

          {/* Instruction */}
          <div className="px-4 py-2 border-b shrink-0" style={{ borderColor: "var(--c-border)" }}>
            <p className="text-xs leading-snug" style={{ color: "var(--c-ink-muted)" }}>
              {selected.instruction}
            </p>
          </div>

          {/* Live stream */}
          <div className="flex-1 overflow-hidden">
            <AgentJobStream
              jobId={selected.id}
              onApprovalNeeded={() => {
                setNeedsAttention(true)
                // Re-fetch to update status badge
                loadJobs()
              }}
            />
          </div>
        </div>
      )}

      {/* ── New Job modal ── */}
      {showNewJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}>
          <div className="card w-full max-w-md flex flex-col gap-4" style={{ padding: "1.5rem" }}>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold" style={{ color: "var(--c-ink)" }}>New Agent Job</h2>
              <button onClick={() => setShowNewJob(false)} style={{ color: "var(--c-ink-muted)" }}>
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--c-ink-muted)" }}>
                Agent type
              </label>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value)}
                className="input-field text-sm"
              >
                {AGENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium" style={{ color: "var(--c-ink-muted)" }}>
                Instruction
              </label>
              <textarea
                value={newInstruction}
                onChange={e => setNewInstruction(e.target.value)}
                placeholder="Describe the task for the agent…"
                rows={4}
                className="input-field text-sm resize-none"
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleCreate()
                }}
              />
              <p className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
                ⌘↵ to submit
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewJob(false)}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newInstruction.trim() || creating}
                className="btn-primary text-sm"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {creating ? "Creating…" : "Create job"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
