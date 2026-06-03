"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Clock, Play, Loader2, CheckCircle2, XCircle, Circle,
  Plus, Trash2, Pencil, RefreshCw, ChevronDown,
} from "lucide-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectorJob {
  name: string
  description: string
  interval_sec: number
  last_run_at: string | null
  next_run_at: string | null
  last_status: "pending" | "running" | "ok" | "error"
  last_error: string | null
  run_count: number
}

interface ScheduleConfig {
  frequency: "daily" | "weekdays" | "weekly" | "biweekly" | "monthly"
  time: string
  day_of_week: number
}

interface PromptJob {
  id: string
  name: string
  prompt_text: string
  schedule_config: ScheduleConfig
  schedule_human: string
  timezone: string
  enabled: boolean
  last_run_at: string | null
  last_run_status: "pending" | "running" | "ok" | "error" | null
  next_run_at: string | null
  last_output: string | null
  output_conversation_id: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INTERVAL_OPTIONS = [
  { label: "Every 5m",  value: 300 },
  { label: "Every 15m", value: 900 },
  { label: "Every 30m", value: 1800 },
  { label: "Every 1h",  value: 3600 },
  { label: "Every 4h",  value: 14400 },
  { label: "Every 12h", value: 43200 },
  { label: "Every 1d",  value: 86400 },
  { label: "Every 1w",  value: 604800 },
]

const FREQUENCY_OPTIONS = [
  { value: "daily",    label: "Every day" },
  { value: "weekdays", label: "Weekdays (Mon–Fri)" },
  { value: "weekly",   label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly",  label: "Monthly (1st of month)" },
]

const DAY_OPTIONS = [
  { value: 0, label: "Monday" },
  { value: 1, label: "Tuesday" },
  { value: 2, label: "Wednesday" },
  { value: 3, label: "Thursday" },
  { value: 4, label: "Friday" },
  { value: 5, label: "Saturday" },
  { value: 6, label: "Sunday" },
]


// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "—"
  const diff = (new Date(iso).getTime() - Date.now()) / 1000
  const abs  = Math.abs(diff)
  const past = diff < 0
  const label =
    abs < 60    ? `${Math.round(abs)}s`
    : abs < 3600  ? `${Math.round(abs / 60)}m`
    : abs < 86400 ? `${Math.round(abs / 3600)}h`
    :               `${Math.round(abs / 86400)}d`
  return past ? `${label} ago` : `in ${label}`
}

function StatusChip({ status }: { status: string | null }) {
  if (!status) return null
  const cfg = ({
    ok:      { label: "OK",      color: "var(--c-moss)",      bg: "var(--c-moss-soft)",  Icon: CheckCircle2 },
    error:   { label: "Error",   color: "var(--c-rose)",      bg: "var(--c-rose-soft)",  Icon: XCircle },
    running: { label: "Running", color: "var(--c-amber)",     bg: "var(--c-amber-soft)", Icon: Loader2 },
    pending: { label: "Pending", color: "var(--c-ink-faint)", bg: "var(--c-surface-2)",  Icon: Circle },
  } as Record<string, { label: string; color: string; bg: string; Icon: React.ElementType }>)[status]
    ?? { label: status, color: "var(--c-ink-faint)", bg: "var(--c-surface-2)", Icon: Circle }

  const { label, color, bg, Icon } = cfg
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ color, backgroundColor: bg }}>
      <Icon size={10} className={status === "running" ? "animate-spin" : ""} />
      {label}
    </span>
  )
}

// ─── Prompt Job Form ──────────────────────────────────────────────────────────

interface PromptFormState {
  name: string
  prompt_text: string
  frequency: ScheduleConfig["frequency"]
  time_hour: number
  time_minute: number
  day_of_week: number
}

const DEFAULT_FORM: PromptFormState = {
  name: "", prompt_text: "", frequency: "daily",
  time_hour: 8, time_minute: 0, day_of_week: 0,
}

function formToPayload(f: PromptFormState) {
  return {
    name: f.name,
    prompt_text: f.prompt_text,
    schedule_config: {
      frequency: f.frequency,
      time: `${String(f.time_hour).padStart(2, "0")}:${String(f.time_minute).padStart(2, "0")}`,
      day_of_week: f.day_of_week,
    },
    timezone: "Asia/Manila",
    enabled: true,
  }
}

function jobToForm(job: PromptJob): PromptFormState {
  const sc = job.schedule_config
  const [hStr, mStr] = (sc?.time ?? "08:00").split(":")
  return {
    name: job.name,
    prompt_text: job.prompt_text,
    frequency: sc?.frequency ?? "daily",
    time_hour: parseInt(hStr ?? "8"),
    time_minute: parseInt(mStr ?? "0"),
    day_of_week: sc?.day_of_week ?? 0,
  }
}

// ─── Time Picker ─────────────────────────────────────────────────────────────
// Segmented inline control: [ 08 ] : [ 30 ] [ AM | PM ]
// No dropdowns — narrow number inputs + toggle pill.

function TimePicker({
  hour, minute, onChange,
}: {
  hour: number
  minute: number
  onChange: (hour: number, minute: number) => void
}) {
  const isPM = hour >= 12
  const display12 = hour % 12 || 12

  function setHour12(val: number) {
    const clamped = Math.max(1, Math.min(12, val))
    onChange(isPM ? (clamped === 12 ? 12 : clamped + 12) : (clamped === 12 ? 0 : clamped), minute)
  }

  function setMinute(val: number) {
    onChange(hour, Math.max(0, Math.min(59, val)))
  }

  function toggleAmPm(pm: boolean) {
    if (pm && !isPM) onChange(hour === 0 ? 12 : hour + 12, minute)
    else if (!pm && isPM) onChange(hour === 12 ? 0 : hour - 12, minute)
  }

  const segmentBase = "w-10 text-center text-sm font-medium bg-transparent outline-none tabular-nums"
  const segmentStyle = { color: "var(--c-ink)" }

  return (
    <div
      className="inline-flex items-center gap-0 rounded-lg px-3 py-2"
      style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}
    >
      {/* Hour */}
      <input
        type="number"
        min={1} max={12}
        value={display12}
        onChange={e => setHour12(parseInt(e.target.value) || 12)}
        onFocus={e => e.target.select()}
        className={segmentBase}
        style={{ ...segmentStyle, MozAppearance: "textfield" } as React.CSSProperties}
      />
      <span className="text-sm font-medium select-none" style={{ color: "var(--c-ink-faint)" }}>:</span>
      {/* Minute */}
      <input
        type="number"
        min={0} max={59}
        value={String(minute).padStart(2, "0")}
        onChange={e => setMinute(parseInt(e.target.value) || 0)}
        onFocus={e => e.target.select()}
        className={segmentBase}
        style={{ ...segmentStyle, MozAppearance: "textfield" } as React.CSSProperties}
      />
      {/* AM / PM toggle */}
      <div
        className="flex items-center ml-2 rounded-md overflow-hidden text-xs font-semibold"
        style={{ border: "1px solid var(--c-border)" }}
      >
        {(["AM", "PM"] as const).map(period => {
          const active = (period === "PM") === isPM
          return (
            <button
              key={period}
              type="button"
              onClick={() => toggleAmPm(period === "PM")}
              className="px-2 py-0.5 transition-colors"
              style={{
                backgroundColor: active ? "var(--c-moss)" : "var(--c-surface-2)",
                color: active ? "#fff" : "var(--c-ink-faint)",
              }}
            >
              {period}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PromptForm({
  initial, onSave, onCancel,
}: {
  initial?: PromptJob | null
  onSave: (p: ReturnType<typeof formToPayload>) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<PromptFormState>(initial ? jobToForm(initial) : DEFAULT_FORM)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof PromptFormState>(k: K, v: PromptFormState[K]) =>
    setForm(prev => ({ ...prev, [k]: v }))
  const needsDay = form.frequency === "weekly" || form.frequency === "biweekly"

  const selectCls = "w-full px-3 py-2 rounded-lg text-sm appearance-none outline-none focus:ring-1"
  const selectStyle = { backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim() || !form.prompt_text.trim()) return
    setSaving(true)
    try { await onSave(formToPayload(form)) } finally { setSaving(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--c-ink-muted)" }}>Job Name</label>
        <input type="text" value={form.name} onChange={e => set("name", e.target.value)}
          placeholder="e.g. Weekly Summary, Morning Brief" required
          className={selectCls} style={selectStyle} />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--c-ink-muted)" }}>Prompt</label>
        <textarea value={form.prompt_text} onChange={e => set("prompt_text", e.target.value)}
          placeholder="What should TARS do when this cron fires?" rows={4} required
          className={`${selectCls} resize-none`} style={selectStyle} />
      </div>
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--c-ink-muted)" }}>Frequency</label>
        <div className="relative">
          <select value={form.frequency} onChange={e => set("frequency", e.target.value as PromptFormState["frequency"])}
            className={`${selectCls} pr-8`} style={selectStyle}>
            {FREQUENCY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--c-ink-faint)" }} />
        </div>
      </div>
      {needsDay && (
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--c-ink-muted)" }}>Day of Week</label>
          <div className="relative">
            <select value={form.day_of_week} onChange={e => set("day_of_week", parseInt(e.target.value))}
              className={`${selectCls} pr-8`} style={selectStyle}>
              {DAY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--c-ink-faint)" }} />
          </div>
        </div>
      )}
      <div>
        <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--c-ink-muted)" }}>
          Time <span style={{ color: "var(--c-ink-faint)" }}>(Asia/Manila)</span>
        </label>
        <TimePicker
          hour={form.time_hour}
          minute={form.time_minute}
          onChange={(h, m) => { set("time_hour", h); set("time_minute", m) }}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving}
          className="flex-1 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
          style={{ backgroundColor: "var(--c-moss)", color: "#fff" }}>
          {saving ? "Saving…" : initial ? "Save Changes" : "Create Job"}
        </button>
        <button type="button" onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm"
          style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}>
          Cancel
        </button>
      </div>
    </form>
  )
}

// ─── Connector Job Card ───────────────────────────────────────────────────────

function ConnectorJobCard({
  job, running, onRun, onChangeInterval,
}: {
  job: ConnectorJob; running: boolean
  onRun: () => void; onChangeInterval: (v: number) => void
}) {
  return (
    <div className="rounded-xl border p-4" style={{ backgroundColor: "var(--c-surface-raised)", borderColor: "var(--c-border)" }}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 p-2 rounded-lg shrink-0" style={{ backgroundColor: "var(--c-surface-2)" }}>
          <RefreshCw size={15} style={{ color: "var(--c-ink-muted)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>{job.name}</span>
            <StatusChip status={job.last_status} />
          </div>
          <p className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>{job.description}</p>
          <div className="flex items-center gap-4 mt-1.5 flex-wrap">
            <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>Last: {relativeTime(job.last_run_at)}</span>
            <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>Next: {relativeTime(job.next_run_at)}</span>
            <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>Runs: {job.run_count}</span>
          </div>
          {job.last_error && (
            <p className="text-[11px] mt-1 truncate" style={{ color: "var(--c-rose)" }}>{job.last_error}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <select value={job.interval_sec} onChange={e => onChangeInterval(parseInt(e.target.value))}
              className="text-xs pl-2 pr-6 py-1.5 rounded-lg appearance-none outline-none"
              style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)", color: "var(--c-ink-muted)" }}>
              {INTERVAL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown size={11} className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--c-ink-faint)" }} />
          </div>
          <button onClick={onRun} disabled={running || job.last_status === "running"}
            className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }} title="Run now">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Prompt Job Card ──────────────────────────────────────────────────────────

function PromptJobCard({
  job, running, onRun, onEdit, onToggle, onDelete,
}: {
  job: PromptJob; running: boolean
  onRun: () => void; onEdit: () => void
  onToggle: () => void; onDelete: () => void
}) {
  return (
    <div className="rounded-xl border" style={{ backgroundColor: "var(--c-surface-raised)", borderColor: "var(--c-border)", opacity: job.enabled ? 1 : 0.65 }}>
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 p-2 rounded-lg shrink-0" style={{ backgroundColor: job.enabled ? "var(--c-moss-soft)" : "var(--c-surface-2)" }}>
          <Clock size={15} style={{ color: job.enabled ? "var(--c-moss)" : "var(--c-ink-faint)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>{job.name}</span>
            {job.last_run_status && <StatusChip status={job.last_run_status} />}
            {!job.enabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-faint)" }}>Paused</span>
            )}
          </div>
          <p className="text-xs mt-0.5 font-medium" style={{ color: "var(--c-moss)" }}>{job.schedule_human}</p>
          <div className="flex items-center gap-4 mt-1 flex-wrap">
            <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>Last: {relativeTime(job.last_run_at)}</span>
            <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>Next: {relativeTime(job.next_run_at)}</span>
          </div>
          <p className="text-[11px] mt-1.5 line-clamp-2" style={{ color: "var(--c-ink-faint)" }}>{job.prompt_text}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={onToggle}
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: job.enabled ? "var(--c-moss-soft)" : "var(--c-surface-2)", color: job.enabled ? "var(--c-moss)" : "var(--c-ink-faint)" }}
            title={job.enabled ? "Pause" : "Resume"}>
            {job.enabled ? <CheckCircle2 size={14} /> : <Circle size={14} />}
          </button>
          <button onClick={onRun} disabled={running}
            className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }} title="Run now">
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          </button>
          <button onClick={onEdit}
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }} title="Edit">
            <Pencil size={14} />
          </button>
          <button onClick={onDelete}
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }} title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      {job.last_output && (
        <div className="px-4 pb-3">
          <div className="rounded-lg p-2.5" style={{ backgroundColor: "var(--c-surface-2)" }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--c-ink-faint)" }}>Last output</p>
            <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "var(--c-ink-muted)" }}>{job.last_output}</p>
            {job.output_conversation_id && (
              <a href={`/chat?conv=${job.output_conversation_id}`}
                className="text-[11px] mt-1 inline-block hover:underline" style={{ color: "var(--c-moss)" }}>
                Open in chat →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CronPage() {
  const [tab, setTab] = useState<"connector" | "prompt">("connector")
  const [connectorJobs, setConnectorJobs] = useState<ConnectorJob[]>([])
  const [connectorLoading, setConnectorLoading] = useState(true)
  const [runningConnector, setRunningConnector] = useState<string | null>(null)
  const [promptJobs, setPromptJobs] = useState<PromptJob[]>([])
  const [promptLoading, setPromptLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingJob, setEditingJob] = useState<PromptJob | null>(null)
  const [runningPrompt, setRunningPrompt] = useState<string | null>(null)

  const loadConnector = useCallback(async () => {
    try { const d = await apiGet<{ items: ConnectorJob[] }>("/cron/connector-jobs"); setConnectorJobs(d.items ?? []) }
    catch { /* ignore */ } finally { setConnectorLoading(false) }
  }, [])

  const loadPrompt = useCallback(async () => {
    try { const d = await apiGet<{ items: PromptJob[] }>("/cron/prompt-jobs"); setPromptJobs(d.items ?? []) }
    catch { /* ignore */ } finally { setPromptLoading(false) }
  }, [])

  useEffect(() => { loadConnector(); loadPrompt() }, [loadConnector, loadPrompt])
  useEffect(() => {
    const t = setInterval(() => { loadConnector(); loadPrompt() }, 30_000)
    return () => clearInterval(t)
  }, [loadConnector, loadPrompt])

  async function changeInterval(name: string, interval_sec: number) {
    await apiPatch(`/cron/connector-jobs/${name}`, { interval_sec })
    loadConnector()
  }

  async function runConnector(name: string) {
    setRunningConnector(name)
    try { await apiPost(`/cron/connector-jobs/${name}/run`, {}); setTimeout(loadConnector, 1500) }
    finally { setRunningConnector(null) }
  }

  async function createPrompt(payload: ReturnType<typeof formToPayload>) {
    await apiPost("/cron/prompt-jobs", payload)
    setShowForm(false); loadPrompt()
  }

  async function updatePrompt(id: string, payload: Partial<ReturnType<typeof formToPayload>>) {
    await apiPatch(`/cron/prompt-jobs/${id}`, payload)
    setEditingJob(null); loadPrompt()
  }

  async function deletePrompt(id: string) {
    await apiDelete(`/cron/prompt-jobs/${id}`); loadPrompt()
  }

  async function togglePrompt(job: PromptJob) {
    await apiPatch(`/cron/prompt-jobs/${job.id}`, { enabled: !job.enabled }); loadPrompt()
  }

  async function runPrompt(id: string) {
    setRunningPrompt(id)
    try { await apiPost(`/cron/prompt-jobs/${id}/run`, {}); setTimeout(loadPrompt, 2000) }
    finally { setRunningPrompt(null) }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: "var(--c-border)" }}>
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--c-ink)" }}>Cron Manager</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>Scheduled tasks and timed prompts</p>
        </div>
        {tab === "prompt" && (
          <button onClick={() => { setEditingJob(null); setShowForm(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: "var(--c-moss)", color: "#fff" }}>
            <Plus size={15} /> New Prompt
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 shrink-0">
        {(["connector", "prompt"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-1.5 text-sm font-medium rounded-lg transition-colors"
            style={tab === t
              ? { backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }
              : { color: "var(--c-ink-faint)" }}>
            {t === "connector" ? "Connector Jobs" : "Prompt Jobs"}
            {t === "prompt" && promptJobs.length > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}>
                {promptJobs.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">

        {/* CONNECTOR TAB */}
        {tab === "connector" && (
          connectorLoading
            ? <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} /></div>
            : connectorJobs.length === 0
              ? <EmptyState message="No connector jobs running." />
              : <div className="flex flex-col gap-3 max-w-2xl">
                  {connectorJobs.map(j => (
                    <ConnectorJobCard key={j.name} job={j}
                      running={runningConnector === j.name}
                      onRun={() => runConnector(j.name)}
                      onChangeInterval={v => changeInterval(j.name, v)} />
                  ))}
                </div>
        )}

        {/* PROMPT TAB */}
        {tab === "prompt" && (
          <div className="max-w-2xl">
            {showForm && !editingJob && (
              <div className="mb-4 p-4 rounded-xl border" style={{ backgroundColor: "var(--c-surface-raised)", borderColor: "var(--c-border)" }}>
                <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--c-ink)" }}>New Prompt Job</h3>
                <PromptForm onSave={createPrompt} onCancel={() => setShowForm(false)} />
              </div>
            )}
            {promptLoading
              ? <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} /></div>
              : promptJobs.length === 0 && !showForm
                ? <EmptyState message={'No prompt jobs yet. Hit "New Prompt" to schedule a recurring TARS prompt.'} />
                : <div className="flex flex-col gap-3">
                    {promptJobs.map(job =>
                      editingJob?.id === job.id
                        ? (
                          <div key={job.id} className="p-4 rounded-xl border" style={{ backgroundColor: "var(--c-surface-raised)", borderColor: "var(--c-border)" }}>
                            <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--c-ink)" }}>Edit — {job.name}</h3>
                            <PromptForm initial={editingJob}
                              onSave={p => updatePrompt(job.id, p)}
                              onCancel={() => setEditingJob(null)} />
                          </div>
                        )
                        : (
                          <PromptJobCard key={job.id} job={job}
                            running={runningPrompt === job.id}
                            onRun={() => runPrompt(job.id)}
                            onEdit={() => { setShowForm(false); setEditingJob(job) }}
                            onToggle={() => togglePrompt(job)}
                            onDelete={() => deletePrompt(job.id)} />
                        )
                    )}
                  </div>
            }
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Clock size={32} className="mb-3 opacity-20" style={{ color: "var(--c-ink)" }} />
      <p className="text-sm max-w-xs" style={{ color: "var(--c-ink-faint)" }}>{message}</p>
    </div>
  )
}
