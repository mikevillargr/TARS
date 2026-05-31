"use client"

import { useCallback, useEffect, useState } from "react"
import { Clock, Play, Loader2, CheckCircle2, XCircle, RefreshCw, Circle } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api-client"

interface CronJob {
  name:          string
  description:   string
  interval_sec:  number
  last_run_at:   string | null
  next_run_at:   string | null
  last_status:   "pending" | "running" | "ok" | "error"
  last_error:    string | null
  run_count:     number
}

function humanInterval(sec: number): string {
  if (sec < 60)        return `Every ${sec}s`
  if (sec < 3600)      return `Every ${sec / 60}m`
  if (sec % 3600 === 0) return `Every ${sec / 3600}h`
  return `Every ${Math.round(sec / 60)}m`
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—"
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs   = Math.abs(diff)
  const past  = diff < 0
  const label =
    abs < 60    ? `${Math.round(abs)}s`
    : abs < 3600  ? `${Math.round(abs / 60)}m`
    : abs < 86400 ? `${Math.round(abs / 3600)}h`
    :               `${Math.round(abs / 86400)}d`
  return past ? `${label} ago` : `in ${label}`
}

function StatusChip({ status }: { status: CronJob["last_status"] }) {
  const cfg = {
    ok:      { label: "OK",      color: "var(--c-moss)",      bg: "var(--c-moss-soft)",  icon: CheckCircle2 },
    error:   { label: "Error",   color: "var(--c-rose)",      bg: "var(--c-rose-soft)",  icon: XCircle },
    running: { label: "Running", color: "var(--c-amber)",     bg: "var(--c-amber-soft)", icon: Loader2 },
    pending: { label: "Pending", color: "var(--c-ink-faint)", bg: "var(--c-surface-2)",  icon: Circle },
  }[status]

  const Icon = cfg.icon

  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ color: cfg.color, backgroundColor: cfg.bg }}
    >
      <Icon size={10} className={status === "running" ? "animate-spin" : ""} />
      {cfg.label}
    </span>
  )
}

export default function CronPage() {
  const [jobs,     setJobs]     = useState<CronJob[]>([])
  const [loading,  setLoading]  = useState(true)
  const [running,  setRunning]  = useState<string | null>(null)
  const [selected, setSelected] = useState<CronJob | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiGet<{ items: CronJob[] }>("/cron")
      setJobs(data.items)
      // Keep selected in sync
      setSelected(prev => prev
        ? data.items.find(j => j.name === prev.name) ?? null
        : null
      )
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // Refresh every 30s so status + next_run stay fresh
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  async function runNow(job: CronJob) {
    setRunning(job.name)
    try {
      await apiPost(`/cron/${job.name}/run`)
      // Poll for completion
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000))
        await load()
        const updated = jobs.find(j => j.name === job.name)
        if (updated && updated.last_status !== "running") break
      }
    } catch (err) {
      console.error(err)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="flex h-full" style={{ backgroundColor: "var(--c-canvas)" }}>
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: "var(--c-surface-2)" }}
            >
              <Clock size={17} style={{ color: "var(--c-ink-muted)" }} />
            </div>
            <div>
              <h1
                className="text-lg font-semibold leading-tight"
                style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}
              >
                Cron Manager
              </h1>
              <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>Scheduled recurring tasks</p>
            </div>
          </div>
          <button
            onClick={load}
            className="p-2 rounded-lg transition-colors"
            style={{ color: "var(--c-ink-muted)" }}
            title="Refresh"
          >
            <RefreshCw size={15} />
          </button>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <Clock size={28} style={{ color: "var(--c-ink-faint)" }} />
              <p className="text-sm" style={{ color: "var(--c-ink-faint)" }}>No jobs scheduled</p>
            </div>
          ) : (
            <div
              className="rounded-xl overflow-hidden"
              style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}
            >
              {/* Column headers */}
              <div
                className="grid text-[0.65rem] font-semibold uppercase tracking-wider px-4 py-2.5"
                style={{
                  gridTemplateColumns: "2fr 1.2fr 1.4fr 1.4fr 1fr",
                  backgroundColor: "var(--c-surface-2)",
                  color: "var(--c-ink-faint)",
                  borderBottom: "1px solid var(--c-border)",
                }}
              >
                <span>Job</span>
                <span>Cadence</span>
                <span>Last Run</span>
                <span>Next Run</span>
                <span>Status</span>
              </div>

              {/* Rows */}
              {jobs.map((job, i) => (
                <button
                  key={job.name}
                  onClick={() => setSelected(prev => prev?.name === job.name ? null : job)}
                  className="grid w-full text-left px-4 py-3.5 transition-colors"
                  style={{
                    gridTemplateColumns: "2fr 1.2fr 1.4fr 1.4fr 1fr",
                    alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none",
                    backgroundColor: selected?.name === job.name ? "var(--c-surface-2)" : "transparent",
                  }}
                >
                  <div className="pr-3">
                    <div className="text-sm font-medium leading-snug" style={{ color: "var(--c-ink)" }}>
                      {job.name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                    </div>
                    <div className="text-[11px] mt-0.5 truncate" style={{ color: "var(--c-ink-faint)" }}>{job.description}</div>
                  </div>
                  <span className="text-xs" style={{ color: "var(--c-ink-muted)" }}>{humanInterval(job.interval_sec)}</span>
                  <span className="text-xs" style={{ color: "var(--c-ink-faint)" }}>{relativeTime(job.last_run_at)}</span>
                  <span className="text-xs" style={{ color: "var(--c-ink-faint)" }}>{relativeTime(job.next_run_at)}</span>
                  <StatusChip status={job.last_status} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      {selected && (
        <div
          className="w-72 border-l flex flex-col shrink-0"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between"
            style={{ borderColor: "var(--c-border)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
              {selected.name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
            </span>
            <button onClick={() => setSelected(null)} style={{ color: "var(--c-ink-faint)" }}>
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Stats */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "Cadence",   value: humanInterval(selected.interval_sec) },
                { label: "Runs",      value: selected.run_count.toString() },
                { label: "Last run",  value: relativeTime(selected.last_run_at) },
                { label: "Next run",  value: relativeTime(selected.next_run_at) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg p-2.5" style={{ backgroundColor: "var(--c-surface-2)" }}>
                  <div className="text-[10px] mb-0.5" style={{ color: "var(--c-ink-faint)" }}>{label}</div>
                  <div className="text-xs font-medium" style={{ color: "var(--c-ink)" }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Status */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>
                Status
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={selected.last_status} />
                {selected.last_error && (
                  <span className="text-[11px]" style={{ color: "var(--c-rose)" }}>
                    {selected.last_error}
                  </span>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>
                Description
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--c-ink-muted)" }}>
                {selected.description}
              </p>
            </div>

            {/* Run now */}
            <button
              onClick={() => runNow(selected)}
              disabled={running === selected.name || selected.last_status === "running"}
              className="w-full flex items-center justify-center gap-2 text-sm py-2 rounded-xl font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
            >
              {running === selected.name || selected.last_status === "running" ? (
                <><Loader2 size={14} className="animate-spin" /> Running…</>
              ) : (
                <><Play size={14} /> Run Now</>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
