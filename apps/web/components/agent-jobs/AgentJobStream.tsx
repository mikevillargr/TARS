"use client"

import { useEffect, useRef, useState } from "react"
import {
  AlertCircle, Check, ChevronDown, ChevronRight, ExternalLink,
  FileText, Terminal, Loader2, CheckCircle, XCircle, GitPullRequest,
  Cpu, MessageSquare,
} from "lucide-react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: "text_chunk"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; tool: string; input: Record<string, unknown>; sub_agent_type?: string }
  | { type: "tool_end"; tool: string; output: string; is_error?: boolean }
  | { type: "approval_required"; command: string; reason: string }
  | { type: "approval_granted"; command: string }
  | { type: "approval_rejected" }
  | { type: "release_approval"; version: string; notes: string[]; commits: string; diff_stat: string }
  | { type: "deploy_started"; target: string }
  | { type: "deploy_completed"; target: string; success: boolean; output: string }
  | { type: "question"; id: string; text: string }
  | { type: "question_answered"; id: string }
  | { type: "completed"; summary: string; pr_url?: string; version?: string }
  | { type: "error"; message: string }
  | { type: "agent_stopped"; reason: string }
  | { type: "unknown" }

interface ToolReceipt {
  id: number
  tool: string
  label: string
  input: Record<string, unknown>
  output?: string
  status: "running" | "done" | "error"
  expanded: boolean
}

interface HistoryEntry {
  text: string
  detail?: string
}

type ActiveGate =
  | { type: "approval"; command: string; reason: string }
  | { type: "question"; id: string; text: string }
  | { type: "release"; version: string; notes: string[]; commits: string; diffStat: string }
  | null

interface StreamState {
  currentThought: string | null
  toolReceipts: ToolReceipt[]
  outputText: string
  activeGate: ActiveGate
  history: HistoryEntry[]
  terminal:
    | { type: "completed"; summary: string; prUrl?: string; version?: string }
    | { type: "error"; message: string }
    | { type: "stopped"; reason: string }
    | null
}

interface Props {
  jobId: string
  /** Override harness base URL. Defaults to current window origin (prod) or
   *  http://localhost:8000 when running on localhost. */
  harnessUrl?: string
  /** Called when an approval_required / release_approval / question event fires */
  onApprovalNeeded?: () => void
}

function resolveHarnessUrl(override?: string): string {
  if (override) return override
  if (typeof window === "undefined") return "http://localhost:8000"
  return window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : window.location.origin
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function AgentJobStream({ jobId, harnessUrl: harnessUrlProp, onApprovalNeeded }: Props) {
  const harnessUrl = resolveHarnessUrl(harnessUrlProp)

  const [stream, setStream] = useState<StreamState>({
    currentThought: null,
    toolReceipts: [],
    outputText: "",
    activeGate: null,
    history: [],
    terminal: null,
  })
  const [connected, setConnected] = useState(false)
  const [questionAnswer, setQuestionAnswer] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<TarsWebSocket | null>(null)

  useEffect(() => {
    let cancelled = false
    let receiptCounter = 0

    async function connect() {
      try {
        const token = await getWsToken()
        if (cancelled) return

        const ws = new TarsWebSocket(
          `agent-jobs/${jobId}/stream?token=${encodeURIComponent(token)}`,
          harnessUrl,
        )
        wsRef.current = ws

        function handle(e: AgentEvent) {
          if (cancelled) return

          if (e.type === "approval_required" || e.type === "release_approval" || e.type === "question") {
            onApprovalNeeded?.()
          }

          setStream(prev => {
            switch (e.type) {
              case "thinking":
                return { ...prev, currentThought: e.text }

              case "tool_start": {
                const id = receiptCounter++
                return {
                  ...prev,
                  toolReceipts: [...prev.toolReceipts, {
                    id,
                    tool: e.tool,
                    label: formatToolLabel(e.tool, e.input),
                    input: e.input,
                    status: "running" as const,
                    expanded: false,
                  }],
                }
              }

              case "tool_end": {
                const receipts = [...prev.toolReceipts]
                for (let i = receipts.length - 1; i >= 0; i--) {
                  if (receipts[i].status === "running") {
                    receipts[i] = {
                      ...receipts[i],
                      status: e.is_error ? "error" as const : "done" as const,
                      output: e.output,
                    }
                    break
                  }
                }
                return { ...prev, toolReceipts: receipts }
              }

              case "text_chunk":
                return { ...prev, outputText: prev.outputText + e.text }

              case "approval_required":
                return { ...prev, activeGate: { type: "approval", command: e.command, reason: e.reason } }

              case "approval_granted":
                return { ...prev, activeGate: null, history: [...prev.history, { text: "✓ Command approved" }] }

              case "approval_rejected":
                return { ...prev, activeGate: null }

              case "release_approval":
                return {
                  ...prev,
                  activeGate: { type: "release", version: e.version, notes: e.notes, commits: e.commits, diffStat: e.diff_stat },
                }

              case "question":
                return { ...prev, activeGate: { type: "question", id: e.id, text: e.text } }

              case "question_answered":
                return { ...prev, activeGate: null, history: [...prev.history, { text: "✓ Question answered" }] }

              case "deploy_started":
                return { ...prev, history: [...prev.history, { text: `⟳ Deploying ${e.target}…` }] }

              case "deploy_completed": {
                const history = [...prev.history]
                const last = history.length - 1
                if (last >= 0) {
                  history[last] = e.success
                    ? { text: `✓ Deployed ${e.target}` }
                    : { text: `✗ Deploy failed (${e.target})`, detail: e.output }
                }
                return { ...prev, history }
              }

              case "completed":
                return {
                  ...prev,
                  currentThought: null,
                  activeGate: null,
                  terminal: { type: "completed", summary: e.summary, prUrl: e.pr_url, version: e.version },
                }

              case "error":
                return { ...prev, currentThought: null, terminal: { type: "error", message: e.message } }

              case "agent_stopped":
                return { ...prev, currentThought: null, terminal: { type: "stopped", reason: e.reason } }

              default:
                return prev
            }
          })
        }

        const eventTypes = [
          "text_chunk", "thinking", "tool_start", "tool_end",
          "approval_required", "approval_granted", "approval_rejected",
          "release_approval", "deploy_started", "deploy_completed",
          "question", "question_answered",
          "completed", "error", "agent_stopped",
        ]
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        eventTypes.forEach(t => ws.on(t, (data) => handle(data as any)))

        ws.connect()
        setConnected(true)
      } catch {
        // token fetch failed — WS auto-retries
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [stream.toolReceipts.length, stream.outputText, stream.terminal])

  function sendApproval(approved: boolean, modifiedCommand?: string) {
    wsRef.current?.sendRaw({ type: "approval_response", approved, modified_command: modifiedCommand ?? null })
  }

  function sendQuestionResponse() {
    const answer = questionAnswer.trim()
    if (!answer || stream.activeGate?.type !== "question") return
    wsRef.current?.sendRaw({ type: "question_response", id: stream.activeGate.id, answer })
    setStream(s => ({ ...s, activeGate: null }))
    setQuestionAnswer("")
  }

  function sendCancel() {
    wsRef.current?.sendRaw({ type: "stop" })
  }

  function toggleReceipt(idx: number) {
    setStream(prev => {
      const receipts = [...prev.toolReceipts]
      receipts[idx] = { ...receipts[idx], expanded: !receipts[idx].expanded }
      return { ...prev, toolReceipts: receipts }
    })
  }

  const isRunning = connected && !stream.terminal
  const hasContent = stream.toolReceipts.length > 0 || stream.outputText || stream.history.length > 0 || stream.terminal

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: "var(--c-surface)" }}>

      {/* ── Ephemeral thought zone ── */}
      {isRunning && (
        <div className="flex items-center gap-2.5 px-4 py-3 border-b shrink-0"
          style={{ borderColor: "var(--c-border)" }}>
          <Loader2 size={13} className="animate-spin shrink-0" style={{ color: "var(--c-moss)" }} />
          <span className="text-sm truncate flex-1" style={{ color: "var(--c-ink-faint)" }}>
            {stream.currentThought ?? (connected ? "Agent running…" : "Connecting…")}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${connected ? "bg-green-400" : "bg-gray-400"}`} />
        </div>
      )}

      {/* ── Receipt + output zone ── */}
      <div className="flex-1 overflow-y-auto">

        {!hasContent && (
          <div className="flex items-center justify-center h-full">
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--c-ink-faint)" }}>
              <Loader2 size={14} className="animate-spin" />
              Waiting for agent…
            </div>
          </div>
        )}

        {stream.toolReceipts.length > 0 && (
          <div className="px-4 pt-4 pb-2 flex flex-col gap-0.5">
            {stream.toolReceipts.map((receipt, i) => (
              <ToolReceiptRow key={receipt.id} receipt={receipt} onToggle={() => toggleReceipt(i)} />
            ))}
          </div>
        )}

        {stream.outputText && (
          <div
            className="px-4 py-3 text-sm leading-relaxed"
            style={{
              color: "var(--c-ink)",
              whiteSpace: "pre-wrap",
              borderTop: stream.toolReceipts.length > 0 ? "1px solid var(--c-border)" : undefined,
            }}
          >
            {stream.outputText}
          </div>
        )}

        {stream.history.length > 0 && (
          <div className="px-4 py-2 flex flex-col gap-1.5">
            {stream.history.map((entry, i) => (
              <HistoryRow key={i} entry={entry} />
            ))}
          </div>
        )}

        {stream.terminal && (
          <div className="px-4 py-3">
            <TerminalCard terminal={stream.terminal} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* ── Gate zone + stop button (always at bottom) ── */}
      <div className="shrink-0">
        {stream.activeGate && (
          <div className="border-t p-3" style={{ borderColor: "var(--c-border)" }}>
            {stream.activeGate.type === "approval" && (
              <ApprovalGateCard
                gate={stream.activeGate}
                onApprove={() => sendApproval(true)}
                onReject={() => sendApproval(false)}
              />
            )}
            {stream.activeGate.type === "question" && (
              <QuestionGateCard
                gate={stream.activeGate}
                answer={questionAnswer}
                onAnswerChange={setQuestionAnswer}
                onSend={sendQuestionResponse}
              />
            )}
            {stream.activeGate.type === "release" && (
              <ReleaseGateCard
                gate={stream.activeGate}
                onApprove={() => wsRef.current?.sendRaw({ type: "approval_response", approved: true })}
                onCancel={() => sendApproval(false)}
              />
            )}
          </div>
        )}

        {isRunning && !stream.activeGate && (
          <div className="px-4 py-2 border-t flex justify-end" style={{ borderColor: "var(--c-border)" }}>
            <button
              onClick={sendCancel}
              className="text-xs px-3 py-1 rounded"
              style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}
            >
              Stop agent
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tool receipt row ───────────────────────────────────────────────────────────

function ToolReceiptRow({ receipt, onToggle }: { receipt: ToolReceipt; onToggle: () => void }) {
  const isBash = receipt.tool.toLowerCase() === "bash"
  const isRunning = receipt.status === "running"

  const statusIcon = isRunning
    ? <Loader2 size={11} className="animate-spin" style={{ color: "var(--c-moss)" }} />
    : receipt.status === "done"
      ? <Check size={11} style={{ color: "var(--c-moss)" }} />
      : <XCircle size={11} style={{ color: "var(--c-rose)" }} />

  const toolIcon = isBash
    ? <Terminal size={11} style={{ color: "var(--c-ink-faint)" }} />
    : <FileText size={11} style={{ color: "var(--c-ink-faint)" }} />

  return (
    <div>
      <button
        onClick={isRunning ? undefined : onToggle}
        className="w-full flex items-center gap-2 py-0.5 text-left hover:opacity-80 transition-opacity"
        style={{ cursor: isRunning ? "default" : "pointer" }}
      >
        <span className="shrink-0 w-3 flex items-center">{statusIcon}</span>
        <span className="shrink-0">{toolIcon}</span>
        <span className="font-mono text-xs truncate flex-1 min-w-0" style={{ color: "var(--c-ink-2)" }}>
          {receipt.label}
        </span>
        {!isRunning && (
          <span className="shrink-0" style={{ color: "var(--c-ink-faint)" }}>
            {receipt.expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        )}
      </button>

      {receipt.expanded && (
        <div className="ml-8 mb-1 mt-0.5">
          <pre
            className="text-xs p-2 rounded overflow-x-auto"
            style={{
              backgroundColor: "var(--c-surface-2)",
              color: "var(--c-ink-faint)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: "12rem",
              overflowY: "auto",
            }}
          >
            {receipt.output
              ? receipt.output.slice(0, 1000) + (receipt.output.length > 1000 ? "\n…" : "")
              : JSON.stringify(receipt.input, null, 2).slice(0, 500)
            }
          </pre>
        </div>
      )}
    </div>
  )
}

// ── History row ────────────────────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-xs" style={{ color: "var(--c-ink-faint)" }}>{entry.text}</span>
        {entry.detail && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs hover:underline shrink-0"
            style={{ color: "var(--c-ink-faint)" }}
          >
            {expanded ? "hide" : "details"}
          </button>
        )}
      </div>
      {expanded && entry.detail && (
        <pre
          className="mt-1 ml-2 text-xs p-2 rounded overflow-x-auto"
          style={{
            backgroundColor: "var(--c-surface-2)",
            color: "var(--c-rose)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-all",
            maxHeight: "8rem",
            overflowY: "auto",
          }}
        >
          {entry.detail.slice(0, 1000)}
        </pre>
      )}
    </div>
  )
}

// ── Terminal card ──────────────────────────────────────────────────────────────

function TerminalCard({ terminal }: { terminal: NonNullable<StreamState["terminal"]> }) {
  if (terminal.type === "completed") {
    return (
      <div className="flex flex-col gap-2 pt-3 border-t" style={{ borderColor: "var(--c-border)" }}>
        <div className="flex items-center gap-2" style={{ color: "var(--c-moss)" }}>
          <CheckCircle size={14} />
          <span className="text-sm font-semibold">
            {terminal.version ? `v${terminal.version} released` : "Completed"}
          </span>
        </div>
        {terminal.summary && (
          <p className="text-xs leading-relaxed" style={{ color: "var(--c-ink-faint)", whiteSpace: "pre-wrap" }}>
            {terminal.summary.slice(0, 300)}
          </p>
        )}
        {terminal.prUrl && (
          <a
            href={terminal.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs hover:underline"
            style={{ color: "var(--c-moss)" }}
          >
            <GitPullRequest size={12} />
            View PR
            <ExternalLink size={10} />
          </a>
        )}
      </div>
    )
  }

  if (terminal.type === "error") {
    return (
      <div className="flex items-start gap-2 pt-3 border-t" style={{ borderColor: "var(--c-border)" }}>
        <AlertCircle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--c-rose)" }} />
        <span className="text-sm" style={{ color: "var(--c-rose)", whiteSpace: "pre-wrap" }}>
          {terminal.message}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 pt-3 border-t" style={{ borderColor: "var(--c-border)" }}>
      <XCircle size={14} style={{ color: "var(--c-ink-faint)" }} />
      <span className="text-sm" style={{ color: "var(--c-ink-faint)" }}>{terminal.reason}</span>
    </div>
  )
}

// ── Gate cards ─────────────────────────────────────────────────────────────────

function ApprovalGateCard({ gate, onApprove, onReject }: {
  gate: { command: string; reason: string }
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{ backgroundColor: "rgba(200,140,50,0.12)", border: "1px solid rgba(200,140,50,0.3)" }}
    >
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#d4a050" }}>
        <AlertCircle size={13} />
        Approval required
      </div>
      <pre
        className="text-xs px-2 py-1.5 rounded font-mono"
        style={{ backgroundColor: "rgba(0,0,0,0.2)", color: "var(--c-ink-2)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
      >
        {gate.command}
      </pre>
      <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>{gate.reason}</p>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm font-medium"
          style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
        >
          <Check size={12} /> Approve
        </button>
        <button
          onClick={onReject}
          className="flex-1 rounded-lg py-2 text-sm font-medium"
          style={{ backgroundColor: "rgba(200,70,70,0.15)", color: "var(--c-rose)" }}
        >
          Reject
        </button>
      </div>
    </div>
  )
}

function QuestionGateCard({ gate, answer, onAnswerChange, onSend }: {
  gate: { id: string; text: string }
  answer: string
  onAnswerChange: (v: string) => void
  onSend: () => void
}) {
  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2"
      style={{ backgroundColor: "rgba(100,160,220,0.1)", border: "1px solid rgba(100,160,220,0.25)" }}
    >
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: "#7aade0" }}>
        <MessageSquare size={13} />
        Agent needs your input
      </div>
      <p className="text-sm" style={{ color: "var(--c-ink)" }}>{gate.text}</p>
      <textarea
        className="w-full text-sm rounded-lg px-3 py-2 resize-none outline-none"
        style={{
          backgroundColor: "var(--c-surface-2)",
          color: "var(--c-ink)",
          border: "1px solid var(--c-border)",
          minHeight: "3.5rem",
        }}
        placeholder="Type your answer… (Enter to send, Shift+Enter for newline)"
        value={answer}
        onChange={e => onAnswerChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && answer.trim()) {
            e.preventDefault()
            onSend()
          }
        }}
        autoFocus
      />
      <div className="flex justify-end">
        <button
          disabled={!answer.trim()}
          onClick={onSend}
          className="px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 transition-opacity"
          style={{ backgroundColor: "#7aade0", color: "var(--c-surface)" }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

function ReleaseGateCard({ gate, onApprove, onCancel }: {
  gate: { version: string; notes: string[]; commits: string; diffStat: string }
  onApprove: () => void
  onCancel: () => void
}) {
  const [showCommits, setShowCommits] = useState(false)

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-3"
      style={{ backgroundColor: "rgba(100,160,220,0.1)", border: "1px solid rgba(100,160,220,0.3)" }}
    >
      <div className="flex items-center gap-2">
        <Cpu size={14} style={{ color: "#7aade0" }} />
        <span className="text-sm font-semibold" style={{ color: "#7aade0" }}>
          Release v{gate.version}
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {gate.notes.map((note, i) => (
          <li key={i} className="flex items-start gap-2 text-sm" style={{ color: "var(--c-ink)" }}>
            <span style={{ color: "#7aade0" }}>•</span>
            {note}
          </li>
        ))}
      </ul>
      {gate.commits && (
        <>
          <button
            onClick={() => setShowCommits(v => !v)}
            className="flex items-center gap-1 text-xs hover:underline self-start"
            style={{ color: "var(--c-ink-faint)" }}
          >
            {showCommits ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            {showCommits ? "Hide commits" : "Show commits"}
          </button>
          {showCommits && (
            <pre
              className="text-xs overflow-x-auto"
              style={{ color: "var(--c-ink-faint)", whiteSpace: "pre-wrap", maxHeight: "8rem", overflowY: "auto" }}
            >
              {gate.commits}
            </pre>
          )}
        </>
      )}
      <div className="flex gap-2 pt-1">
        <button
          onClick={onApprove}
          className="flex-1 flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold"
          style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
        >
          <Check size={13} /> Approve &amp; Deploy
        </button>
        <button
          onClick={onCancel}
          className="px-4 rounded-lg py-2 text-sm"
          style={{ backgroundColor: "rgba(200,70,70,0.15)", color: "var(--c-rose)" }}
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
  if (t === "bash")  return `$ ${String(input.command ?? "").slice(0, 80)}`
  if (t === "read")  return `Read  ${input.file_path ?? input.path ?? ""}`
  if (t === "write") return `Write ${input.file_path ?? input.path ?? ""}`
  if (t === "edit")  return `Edit  ${input.file_path ?? input.path ?? ""}`
  if (t === "glob")  return `Glob  ${input.pattern ?? ""}`
  if (t === "grep")  return `Grep  "${input.pattern ?? ""}"`
  return tool
}
