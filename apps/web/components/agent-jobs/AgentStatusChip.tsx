"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

interface Props {
  jobId: string
  agentType?: string
  onComplete?: () => void
  onFail?: () => void
  onSubJobSpawned?: (subJobId: string, agentType: string) => void
}

// Human-readable labels for tool events from Claude Code
function toolLabel(tool: string, input: Record<string, unknown>): string | null {
  switch (tool) {
    case "Read": {
      const p = String(input.file_path ?? "").split("/").slice(-2).join("/")
      return p ? `Reading ${p}` : null
    }
    case "Write":
    case "Edit": {
      const p = String(input.file_path ?? "").split("/").slice(-2).join("/")
      return p ? `${tool === "Write" ? "Writing" : "Editing"} ${p}` : null
    }
    case "Bash": {
      const cmd = String(input.command ?? "").split(" ").slice(0, 3).join(" ").slice(0, 40)
      if (!cmd || /^(echo|true|false|pwd|ls\b)/i.test(cmd)) return null
      return cmd
    }
    case "Glob":
    case "Grep":
      return `Searching codebase`
    default:
      return null
  }
}

export default function AgentStatusChip({
  jobId, agentType, onComplete, onFail, onSubJobSpawned,
}: Props) {
  const [status, setStatus] = useState<string>("Working…")
  const wsRef = useRef<TarsWebSocket | null>(null)
  const lastTs = useRef<number>(0)

  // Throttled setter — max one visible update per 600 ms
  function push(text: string) {
    if (!text) return
    const now = Date.now()
    if (now - lastTs.current < 600) return
    lastTs.current = now
    setStatus(text.length > 72 ? text.slice(0, 71) + "…" : text)
  }

  useEffect(() => {
    let mounted = true

    async function init() {
      try {
        const token = await getWsToken()
        const ws = new TarsWebSocket(`agent-jobs/${jobId}/stream?token=${token}`)
        wsRef.current = ws

        // Model commentary (filtered for noise)
        ws.on("text_chunk", (msg: unknown) => {
          if (!mounted) return
          const text = ((msg as { text?: string }).text ?? "")
            .replace(/\n+/g, " ").replace(/\*\*/g, "").trim()
          if (text.length < 10) return
          if (/^(→|Working|Analyzing|Commit|Merging|Deploy)/i.test(text)) return
          push(text)
        })

        // Tool events — most informative for "what is it doing right now"
        ws.on("tool_start", (msg: unknown) => {
          if (!mounted) return
          const m = msg as { tool?: string; input?: Record<string, unknown> }
          const label = toolLabel(m.tool ?? "", m.input ?? {})
          if (label) push(label)
        })

        ws.on("deploy_started", () => {
          if (mounted) push("Deploying to production…")
        })

        ws.on("completed", () => {
          if (!mounted) return
          setStatus("Done")
          setTimeout(() => onComplete?.(), 1200)
        })

        ws.on("error", () => {
          if (!mounted) return
          setStatus("Failed")
          setTimeout(() => onFail?.(), 1200)
        })

        ws.on("agent_stopped", () => {
          if (!mounted) return
          setStatus("Stopped")
          setTimeout(() => onFail?.(), 1200)
        })

        ws.on("sub_job_started", (msg: unknown) => {
          if (!mounted) return
          const m = msg as { sub_job_id?: string; agent_type?: string }
          if (m.sub_job_id && m.agent_type) onSubJobSpawned?.(m.sub_job_id, m.agent_type)
        })

        ws.connect()
      } catch {
        // silent — chip stays in working state
      }
    }

    init()
    return () => {
      mounted = false
      wsRef.current?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId])

  const typeLabel =
    agentType === "evolutionarist" ? "Orchestrating" :
    agentType === "sa"             ? "Researching" :
    agentType === "frontend"       ? "Frontend" :
    agentType === "backend"        ? "Backend" :
    "Agent"

  return (
    <div
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs select-none"
      style={{ color: "var(--c-ink-faint)", opacity: 0.85 }}
    >
      <Loader2 size={11} className="animate-spin shrink-0" />
      <Sparkles size={9} className="shrink-0" style={{ color: "var(--c-moss)" }} />
      <span className="font-medium shrink-0" style={{ fontSize: "11px", color: "var(--c-ink-faint)" }}>
        {typeLabel}
      </span>
      <span style={{ color: "var(--c-border-faint)", fontSize: "11px" }}>·</span>
      <span
        key={status}
        style={{
          fontSize: "11px",
          animation: "notif-fade-in 350ms ease-out",
          display: "inline-block",
          maxWidth: "280px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {status}
      </span>
      <style jsx>{`
        @keyframes notif-fade-in {
          from { opacity: 0; transform: translateY(2px); }
          to   { opacity: 1; transform: translateY(0);   }
        }
      `}</style>
    </div>
  )
}
