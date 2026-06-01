"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2, CheckCircle, XCircle, ExternalLink } from "lucide-react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

interface Props {
  jobId: string
  agentType?: string
}

type Phase = "working" | "done" | "failed"

// Ticker: cycles through recent status lines while working
function Ticker({ lines }: { lines: string[] }) {
  const [idx, setIdx] = useState(0)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (lines.length <= 1) return
    // Crossfade every 2.5 s
    const t = setInterval(() => {
      setVisible(false)
      setTimeout(() => {
        setIdx(i => (i + 1) % lines.length)
        setVisible(true)
      }, 200)
    }, 2500)
    return () => clearInterval(t)
  }, [lines.length])

  const text = lines[Math.min(idx, lines.length - 1)] ?? ""

  return (
    <span
      style={{
        color: "var(--c-ink-faint)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.2s ease",
        display: "inline-block",
      }}
    >
      {text}
    </span>
  )
}

export default function AgentStatusChip({ jobId, agentType }: Props) {
  const [phase, setPhase] = useState<Phase>("working")
  const [tickerLines, setTickerLines] = useState<string[]>(["Working on it…"])
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const wsRef = useRef<TarsWebSocket | null>(null)

  useEffect(() => {
    let mounted = true

    // Meaningful status lines — filters noise, keeps actions
    function addLine(raw: string) {
      const text = raw.replace(/\n+/g, " ").replace(/\*\*/g, "").trim()
      if (!text || text.length < 12) return
      // Skip tool call noise
      if (/^(Running|Executing|bash|```|→|Tool|read_file|write_file)/i.test(text)) return
      const line = text.length > 80 ? text.slice(0, 79) + "…" : text
      setTickerLines(prev => {
        const next = [...prev.filter(l => l !== line), line]
        return next.slice(-6) // keep last 6 unique lines
      })
    }

    async function init() {
      try {
        const token = await getWsToken()
        const ws = new TarsWebSocket(`agent-jobs/${jobId}/stream?token=${token}`)
        wsRef.current = ws

        ws.on("text_chunk", (msg: unknown) => {
          if (!mounted) return
          addLine((msg as { text?: string }).text ?? "")
        })

        ws.on("deploy_started", () => {
          if (mounted) addLine("Deploying…")
        })

        ws.on("deploy_completed", (msg: unknown) => {
          const m = msg as { success?: boolean; target?: string }
          if (mounted) addLine(m.success ? `Deployed (${m.target ?? "server"})` : "Deploy failed")
        })

        ws.on("completed", (msg: unknown) => {
          if (!mounted) return
          const m = msg as { pr_url?: string; summary?: string }
          if (m.pr_url) setPrUrl(m.pr_url)
          setPhase("done")
        })

        ws.on("error", () => {
          if (mounted) setPhase("failed")
        })

        ws.on("agent_stopped", () => {
          if (mounted) setPhase("failed")
        })

        ws.connect()
      } catch {
        // silent — chip just stays in working state
      }
    }

    init()
    return () => {
      mounted = false
      wsRef.current?.disconnect()
    }
  }, [jobId])

  const typeLabel =
    agentType === "evolutionarist" ? "Agent" :
    agentType ? agentType.charAt(0).toUpperCase() + agentType.slice(1) :
    "Agent"

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs"
      style={{
        backgroundColor: phase === "done"
          ? "color-mix(in srgb, var(--c-moss) 12%, transparent)"
          : phase === "failed"
          ? "color-mix(in srgb, var(--c-rose) 12%, transparent)"
          : "color-mix(in srgb, var(--c-ink) 6%, transparent)",
        border: "1px solid var(--c-border-faint)",
        maxWidth: "420px",
      }}
    >
      {/* Status icon */}
      {phase === "working" && (
        <Loader2 size={11} className="animate-spin shrink-0" style={{ color: "var(--c-ink-faint)" }} />
      )}
      {phase === "done" && (
        <CheckCircle size={11} className="shrink-0" style={{ color: "var(--c-moss)" }} />
      )}
      {phase === "failed" && (
        <XCircle size={11} className="shrink-0" style={{ color: "var(--c-rose)" }} />
      )}

      {/* Label */}
      <span className="font-medium shrink-0" style={{ color: "var(--c-ink-faint)", fontSize: "11px" }}>
        {typeLabel}
      </span>

      <span style={{ color: "var(--c-border)", fontSize: "11px" }}>·</span>

      {/* Ticker */}
      <span className="overflow-hidden" style={{ fontSize: "11px" }}>
        {phase === "working" ? (
          <Ticker lines={tickerLines} />
        ) : phase === "done" ? (
          <span style={{ color: "var(--c-moss)" }}>
            {prUrl ? (
              <a href={prUrl} target="_blank" rel="noopener noreferrer"
                className="hover:underline">
                Done · PR merged
              </a>
            ) : "Done"}
          </span>
        ) : (
          <span style={{ color: "var(--c-rose)" }}>Failed</span>
        )}
      </span>

      {/* Details link */}
      <a
        href={`/agent-jobs?id=${jobId}`}
        className="shrink-0 ml-auto opacity-30 hover:opacity-70 transition-opacity"
        style={{ color: "var(--c-ink-faint)" }}
        title="View details"
      >
        <ExternalLink size={10} />
      </a>
    </div>
  )
}
