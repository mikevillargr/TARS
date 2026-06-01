"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, CheckCircle, XCircle, ExternalLink } from "lucide-react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

interface Props {
  jobId: string
  instruction: string
  agentType?: string
}

type Phase = "working" | "done" | "failed"

export default function AgentStatusChip({ jobId, instruction, agentType }: Props) {
  const [phase, setPhase] = useState<Phase>("working")
  const [statusText, setStatusText] = useState<string>("Working on it…")
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const wsRef = useRef<TarsWebSocket | null>(null)

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        const token = await getWsToken()
        const ws = new TarsWebSocket(`agent-jobs/${jobId}/stream?token=${token}`)
        wsRef.current = ws

        ws.on("text_chunk", (msg: unknown) => {
          if (!mounted) return
          const text = (msg as { text?: string }).text ?? ""
          // Only surface high-level commentary, skip short/noisy chunks
          if (text.length > 20 && !text.startsWith("```") && !text.startsWith("Running")) {
            setStatusText(text.slice(0, 120).replace(/\n/g, " ").trim())
          }
        })

        ws.on("deploy_started", () => {
          if (mounted) setStatusText("Deploying…")
        })

        ws.on("completed", (msg: unknown) => {
          if (!mounted) return
          const m = msg as { pr_url?: string; summary?: string }
          if (m.pr_url) setPrUrl(m.pr_url)
          setPhase("done")
          setStatusText("Done")
        })

        ws.on("error", () => {
          if (mounted) { setPhase("failed"); setStatusText("Failed") }
        })

        ws.on("agent_stopped", () => {
          if (mounted) { setPhase("failed"); setStatusText("Stopped") }
        })

        ws.connect()
      } catch {
        if (mounted) setStatusText("Could not connect to job stream")
      }
    }

    init()
    return () => {
      mounted = false
      wsRef.current?.disconnect()
    }
  }, [jobId])

  const label = agentType
    ? `${agentType.charAt(0).toUpperCase()}${agentType.slice(1)} agent`
    : "Agent"

  return (
    <div
      className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs max-w-sm"
      style={{
        backgroundColor: phase === "done"
          ? "color-mix(in srgb, var(--c-moss) 10%, transparent)"
          : phase === "failed"
          ? "color-mix(in srgb, var(--c-rose) 10%, transparent)"
          : "var(--c-surface)",
        border: "1px solid var(--c-border-faint)",
      }}
    >
      <div className="mt-0.5 shrink-0">
        {phase === "working" && (
          <Loader2 size={13} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
        )}
        {phase === "done" && (
          <CheckCircle size={13} style={{ color: "var(--c-moss)" }} />
        )}
        {phase === "failed" && (
          <XCircle size={13} style={{ color: "var(--c-rose)" }} />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <span className="font-medium" style={{ color: "var(--c-ink)" }}>
          {label}
        </span>
        <span style={{ color: "var(--c-ink-faint)" }}> · </span>
        <span style={{ color: "var(--c-ink-faint)" }} className="truncate">
          {phase === "working" ? statusText : instruction.slice(0, 60)}
        </span>
      </div>

      <a
        href={prUrl ?? `/agent-jobs?id=${jobId}`}
        target={prUrl ? "_blank" : undefined}
        rel={prUrl ? "noopener noreferrer" : undefined}
        className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
        style={{ color: "var(--c-ink-faint)" }}
        title={prUrl ? "View PR" : "View job details"}
      >
        <ExternalLink size={12} />
      </a>
    </div>
  )
}
