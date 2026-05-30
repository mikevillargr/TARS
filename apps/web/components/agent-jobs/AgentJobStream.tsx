"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertCircle, Check, ChevronDown, ChevronRight, ExternalLink,
  FileText, Terminal, Loader2, CheckCircle, XCircle, GitPullRequest,
  Cpu,
} from "lucide-react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: "text_chunk"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; tool: string; input: Record<string, unknown>; sub_agent_type?: string }
  | { type: "tool_end"; tool: string; output: string }
  | { type: "approval_required"; command: string; reason: string }
  | { type: "approval_granted"; command: string }
  | { type: "approval_rejected" }
  | { type: "release_approval"; version: string; notes: string[]; commits: string; diff_stat: string }
  | { type: "completed"; summary: string; pr_url?: string; version?: string }
  | { type: "error"; message: string }
  | { type: "agent_stopped"; reason: string }
  | { type: "unknown" }

interface Props {
  jobId: string
  harnessUrl?: string  // default "http://localhost:8000"
  /** Called when an approval_required / release_approval event fires */
  onApprovalNeeded?: () => void
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AgentJobStream({ jobId, harnessUrl = "http://localhost:8000", onApprovalNeeded }: Props) {
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<AgentEvent | null>(null)
  const [collapsedTools, setCollapsedTools] = useState<Set<number>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<TarsWebSocket | null>(null)

  useEffect(() => {
    let cancelled = false

    async function connect() {
      try {
        const token = await getWsToken()
        if (cancelled) return

        const ws = new TarsWebSocket(
          `agent-jobs/${jobId}/stream?token=${encodeURIComponent(token)}`,
          harnessUrl,
        )
        wsRef.current = ws

        const addEvent = (e: AgentEvent) => {
          if (cancelled) return
          setEvents(prev => [...prev, e])
          if (e.type === "approval_required" || e.type === "release_approval") {
            setPendingApproval(e)
            onApprovalNeeded?.()
          }
          if (e.type === "approval_granted" || e.type === "approval_rejected" || e.type === "completed" || e.type === "error") {
            setPendingApproval(null)
          }
        }

        const eventTypes = [
          "text_chunk", "thinking", "tool_start", "tool_end",
          "approval_required", "approval_granted", "approval_rejected",
          "release_approval", "completed", "error", "agent_stopped",
        ]
        // The WS class dispatches msg.data if present, else the whole msg.
        // For agent events the server sends the full event object (no nesting).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventTypes.forEach(t => ws.on(t, (data) => addEvent(data as any)))

        ws.connect()
        setConnected(true)
      } catch {
        // token fetch failed — will retry
      }
    }

    connect()

    return () => {
      cancelled = true
      wsRef.current?.disconnect()
      wsRef.current = null
      setConnected(false)
    }
  }, [jobId, harnessUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [events])

  function sendApproval(approved: boolean, modifiedCommand?: string) {
    wsRef.current?.sendRaw({ type: "approval_response", approved, modified_command: modifiedCommand ?? null })
    setPendingApproval(null)
  }

  function sendCancel() {
    wsRef.current?.sendRaw({ type: "stop" })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Connection indicator */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0"
        style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface-2)" }}>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-400" : "bg-gray-400"}`} />
        <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
          {connected ? "Live" : "Connecting…"}
        </span>
      </div>

      {/* Event feed */}
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-1.5 font-mono text-[12px]"
        style={{ backgroundColor: "#1a1714", color: "#e3ede9" }}>
        {events.length === 0 && (
          <div className="flex items-center gap-2 opacity-50">
            <Loader2 size={12} className="animate-spin" />
            <span>Waiting for agent…</span>
          </div>
        )}

        {events.map((ev, i) => (
          <EventRow
            key={i}
            index={i}
            event={ev}
            collapsed={collapsedTools.has(i)}
            onToggleCollapse={() => setCollapsedTools(prev => {
              const next = new Set(prev)
              next.has(i) ? next.delete(i) : next.add(i)
              return next
            })}
            onApprove={() => sendApproval(true)}
            onReject={() => sendApproval(false)}
            onRelApprove={(v) => wsRef.current && wsRef.current.sendRaw({ type: "approval_response", approved: true })}
            onRelCancel={() => sendApproval(false)}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Cancel button when running */}
      {connected && !pendingApproval && (
        <div className="px-3 py-2 border-t shrink-0" style={{ borderColor: "var(--c-border)" }}>
          <button
            onClick={sendCancel}
            className="text-[11px] px-2 py-1 rounded"
            style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}
          >
            Stop agent
          </button>
        </div>
      )}
    </div>
  )
}

// ── Event row renderer ─────────────────────────────────────────────────────────

function EventRow({
  event, index, collapsed, onToggleCollapse, onApprove, onReject, onRelApprove, onRelCancel,
}: {
  event: AgentEvent
  index: number
  collapsed: boolean
  onToggleCollapse: () => void
  onApprove: () => void
  onReject: () => void
  onRelApprove: (version: string) => void
  onRelCancel: () => void
}) {
  switch (event.type) {
    case "text_chunk":
      return (
        <span style={{ color: "#e3ede9", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
          {event.text}
        </span>
      )

    case "thinking":
      return (
        <span className="italic opacity-50" style={{ whiteSpace: "pre-wrap" }}>
          {event.text}
        </span>
      )

    case "tool_start": {
      const label = formatToolLabel(event.tool, event.input)
      const icon = event.tool.toLowerCase().includes("bash")
        ? <Terminal size={11} />
        : <FileText size={11} />
      return (
        <div className="flex flex-col gap-0.5">
          <button
            onClick={onToggleCollapse}
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-left"
            style={{ color: "#a3b899" }}
          >
            {icon}
            <span className="truncate">{label}</span>
            {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          </button>
          {!collapsed && event.input && (
            <pre className="pl-4 text-[11px] opacity-60" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {JSON.stringify(event.input, null, 2)}
            </pre>
          )}
        </div>
      )
    }

    case "tool_end":
      return (
        <div className="pl-3 border-l opacity-50 text-[11px]" style={{ borderColor: "#3a3530" }}>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {event.output?.slice(0, 500)}{event.output?.length > 500 ? "…" : ""}
          </pre>
        </div>
      )

    case "approval_required":
      return (
        <ApprovalCard
          title="Approval required"
          body={<>
            <div className="font-mono text-[11px] px-2 py-1 rounded" style={{ backgroundColor: "rgba(0,0,0,0.3)" }}>
              {event.command}
            </div>
            <div className="text-[11px] opacity-70">{event.reason}</div>
          </>}
          onApprove={onApprove}
          onReject={onReject}
        />
      )

    case "release_approval":
      return (
        <ReleaseApprovalCard
          version={event.version}
          notes={event.notes}
          commits={event.commits}
          onApprove={() => onRelApprove(event.version)}
          onCancel={onRelCancel}
        />
      )

    case "approval_granted":
      return (
        <div className="flex items-center gap-1.5" style={{ color: "#6db890" }}>
          <Check size={11} />
          <span>Approved — continuing</span>
        </div>
      )

    case "approval_rejected":
      return (
        <div className="flex items-center gap-1.5" style={{ color: "#e07070" }}>
          <XCircle size={11} />
          <span>Rejected — agent stopped</span>
        </div>
      )

    case "completed":
      return (
        <div className="flex flex-col gap-1 mt-1 pt-2 border-t" style={{ borderColor: "#3a3530" }}>
          <div className="flex items-center gap-1.5" style={{ color: "#6db890" }}>
            <CheckCircle size={12} />
            <span className="font-semibold">
              {event.version ? `v${event.version} released` : "Completed"}
            </span>
          </div>
          {event.summary && (
            <div className="text-[11px] opacity-70" style={{ whiteSpace: "pre-wrap" }}>
              {event.summary.slice(0, 300)}
            </div>
          )}
          {event.pr_url && (
            <a
              href={event.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] hover:underline"
              style={{ color: "#6db890" }}
            >
              <GitPullRequest size={11} />
              View PR
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      )

    case "error":
    case "agent_stopped":
      return (
        <div className="flex items-start gap-1.5 mt-1" style={{ color: "#e07070" }}>
          <AlertCircle size={11} style={{ marginTop: 1, flexShrink: 0 }} />
          <span style={{ whiteSpace: "pre-wrap" }}>
            {event.type === "error" ? (event as { message: string }).message : (event as { reason: string }).reason}
          </span>
        </div>
      )

    default:
      return null
  }
}

// ── Approval card ──────────────────────────────────────────────────────────────

function ApprovalCard({ title, body, onApprove, onReject }: {
  title: string
  body: React.ReactNode
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="rounded-lg p-3 flex flex-col gap-2 my-1 font-sans"
      style={{ backgroundColor: "rgba(200,140,50,0.15)", border: "1px solid rgba(200,140,50,0.3)" }}>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "#d4a050" }}>
        <AlertCircle size={12} />
        {title}
      </div>
      <div className="flex flex-col gap-1">{body}</div>
      <div className="flex gap-2 mt-1">
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-1 rounded py-1.5 text-[12px] font-medium"
          style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
        >
          <Check size={11} /> Approve
        </button>
        <button
          onClick={onReject}
          className="flex-1 rounded py-1.5 text-[12px] font-medium"
          style={{ backgroundColor: "rgba(200,70,70,0.2)", color: "#e07070" }}
        >
          Reject
        </button>
      </div>
    </div>
  )
}

// ── Release approval card ──────────────────────────────────────────────────────

function ReleaseApprovalCard({ version, notes, commits, onApprove, onCancel }: {
  version: string
  notes: string[]
  commits: string
  onApprove: () => void
  onCancel: () => void
}) {
  const [showCommits, setShowCommits] = useState(false)
  return (
    <div className="rounded-lg p-4 flex flex-col gap-3 my-2 font-sans"
      style={{ backgroundColor: "rgba(100,160,220,0.12)", border: "1px solid rgba(100,160,220,0.3)" }}>
      <div className="flex items-center gap-2">
        <Cpu size={14} style={{ color: "#7aade0" }} />
        <span className="text-[13px] font-semibold" style={{ color: "#7aade0" }}>
          Release v{version}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {notes.map((note, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[12px]" style={{ color: "#e3ede9" }}>
            <span style={{ color: "#7aade0", marginTop: 1 }}>•</span>
            {note}
          </li>
        ))}
      </ul>
      {commits && (
        <button
          onClick={() => setShowCommits(v => !v)}
          className="flex items-center gap-1 text-[11px] opacity-60 hover:opacity-100"
          style={{ color: "#e3ede9" }}
        >
          {showCommits ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          {showCommits ? "Hide commits" : "Show commits"}
        </button>
      )}
      {showCommits && (
        <pre className="text-[10px] opacity-50 overflow-x-auto" style={{ whiteSpace: "pre-wrap" }}>
          {commits}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-1.5 rounded py-2 text-[13px] font-semibold"
          style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
        >
          <Check size={13} /> Approve &amp; Deploy
        </button>
        <button
          onClick={onCancel}
          className="px-4 rounded py-2 text-[12px]"
          style={{ backgroundColor: "rgba(200,70,70,0.15)", color: "#e07070" }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatToolLabel(tool: string, input: Record<string, unknown>): string {
  const t = tool.toLowerCase()
  if (t === "bash") return `$ ${String(input.command ?? "").slice(0, 80)}`
  if (t === "read") return `Read ${input.file_path ?? input.path ?? ""}`
  if (t === "write") return `Write ${input.file_path ?? input.path ?? ""}`
  if (t === "edit") return `Edit ${input.file_path ?? input.path ?? ""}`
  if (t === "glob") return `Glob ${input.pattern ?? ""}`
  if (t === "grep") return `Grep "${input.pattern ?? ""}"`
  return tool
}
