"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

interface Props {
  jobId: string
  agentType?: string
  /** Called when the job completes successfully — chat removes the chip after a delay */
  onComplete?: () => void
  /** Called when the job fails/errors */
  onFail?: () => void
  /** Called when this agent spawns a sub-agent — chat renders a sibling chip */
  onSubJobSpawned?: (subJobId: string, agentType: string) => void
}

export default function AgentStatusChip({ jobId, agentType, onComplete, onFail, onSubJobSpawned }: Props) {
  const [statusText, setStatusText] = useState<string>("Working…")
  const wsRef = useRef<TarsWebSocket | null>(null)
  const lastUpdateRef = useRef<number>(Date.now())

  useEffect(() => {
    let mounted = true

    // Filter and clean a single line of status text
    function tryUpdate(raw: string) {
      const text = raw
        .replace(/\n+/g, " ")
        .replace(/\*\*/g, "")
        .replace(/```[a-z]*/g, "")
        .replace(/^[→•\-\s]+/, "")
        .trim()
      if (!text || text.length < 8) return
      if (/^(Running|Executing|bash|read_file|write_file|edit_file)/i.test(text)) return
      const now = Date.now()
      // Throttle: at most one update per 800 ms so it feels like a smooth ticker, not a strobe
      if (now - lastUpdateRef.current < 800) return
      lastUpdateRef.current = now
      const trimmed = text.length > 90 ? text.slice(0, 89) + "…" : text
      if (mounted) setStatusText(trimmed)
    }

    async function init() {
      try {
        const token = await getWsToken()
        const ws = new TarsWebSocket(`agent-jobs/${jobId}/stream?token=${token}`)
        wsRef.current = ws

        ws.on("text_chunk", (msg: unknown) => {
          tryUpdate((msg as { text?: string }).text ?? "")
        })

        ws.on("deploy_started", () => {
          if (mounted) setStatusText("Deploying…")
        })

        ws.on("completed", () => {
          if (!mounted) return
          setStatusText("Done")
          // Fade out + remove from chat after a moment
          setTimeout(() => onComplete?.(), 1500)
        })

        ws.on("error", () => {
          if (!mounted) return
          setStatusText("Failed")
          setTimeout(() => onFail?.(), 1500)
        })

        ws.on("agent_stopped", () => {
          if (!mounted) return
          setStatusText("Stopped")
          setTimeout(() => onFail?.(), 1500)
        })

        ws.on("sub_job_started", (msg: unknown) => {
          if (!mounted) return
          const m = msg as { sub_job_id?: string; agent_type?: string }
          if (m.sub_job_id && m.agent_type) {
            onSubJobSpawned?.(m.sub_job_id, m.agent_type)
          }
        })

        ws.connect()
      } catch {
        // silent
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
    agentType === "evolutionarist" ? "Agent" :
    agentType === "sa" ? "Researching" :
    agentType === "frontend" ? "Frontend" :
    agentType === "backend" ? "Backend" :
    "Agent"

  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 text-xs select-none"
      style={{
        color: "var(--c-ink-faint)",
        opacity: 0.85,
      }}
    >
      <Loader2 size={11} className="animate-spin shrink-0" />
      <Sparkles size={10} className="shrink-0" style={{ color: "var(--c-moss)" }} />
      <span className="font-medium shrink-0" style={{ fontSize: "11px" }}>{typeLabel}</span>
      <span style={{ color: "var(--c-border)", fontSize: "11px" }}>·</span>
      <span
        key={statusText}
        className="overflow-hidden"
        style={{
          fontSize: "11px",
          animation: "tars-ticker-fade 400ms ease-out",
          display: "inline-block",
        }}
      >
        {statusText}
      </span>
      <style jsx>{`
        @keyframes tars-ticker-fade {
          from { opacity: 0; transform: translateY(2px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
