"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

export interface BrowserAction {
  type: "action"
  name: string
  input: Record<string, unknown>
  turn: number
  at?: number
  url?: string
  label?: string | null
  box?: { x: number; y: number; width: number; height: number }
}

export interface FeedRow {
  kind: "action" | "error" | "escalated" | "say" | "paused" | "resumed"
  at: number
  name?: string
  label?: string | null
  detail?: string
  model?: string
  input?: Record<string, unknown>
  text?: string
  box?: BrowserAction["box"]
  url?: string
}

interface Frame {
  jpeg: string
  width: number
  height: number
}

/**
 * Subscribes to one browser job's live stream.
 *
 * Two kinds of message arrive on the same socket: `frame` (screencast, live
 * only, never replayed) and everything else (the action feed, replayed from
 * the start so a panel opened mid-run still sees the whole story).
 */
export function useBrowserJob(jobId: string | null) {
  const [frame, setFrame] = useState<Frame | null>(null)
  const [rows, setRows] = useState<FeedRow[]>([])
  const [status, setStatus] = useState<string>("running")
  const [paused, setPaused] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<TarsWebSocket | null>(null)

  useEffect(() => {
    if (!jobId) return
    let cancelled = false

    const push = (row: FeedRow) => setRows((prev) => [...prev, row])

    ;(async () => {
      const token = await getWsToken()
      if (cancelled) return
      const ws = new TarsWebSocket(`browser/ws/${jobId}?token=${token}`, "")

      ws.on("frame", (d) => {
        const f = d as Frame
        if (f?.jpeg) setFrame({ jpeg: f.jpeg, width: f.width, height: f.height })
      })
      ws.on("snapshot", (d) => {
        const s = d as { status: string; paused?: boolean; result?: string | null }
        setStatus(s.status)
        setPaused(!!s.paused)
        if (s.result) setResult(s.result)
      })
      ws.on("action", (d) => {
        const a = d as BrowserAction
        push({
          kind: "action",
          at: a.at ?? Date.now() / 1000,
          name: a.name,
          label: a.label ?? null,
          input: a.input,
          box: a.box,
          url: a.url,
        })
      })
      ws.on("action_error", (d) =>
        push({ kind: "error", at: Date.now() / 1000, detail: (d as { detail: string }).detail }),
      )
      ws.on("escalated", (d) =>
        push({ kind: "escalated", at: Date.now() / 1000, model: (d as { model: string }).model }),
      )
      ws.on("say", (d) =>
        push({ kind: "say", at: Date.now() / 1000, text: (d as { text: string }).text }),
      )
      ws.on("paused", () => {
        setPaused(true)
        push({ kind: "paused", at: Date.now() / 1000 })
      })
      ws.on("resumed", () => {
        setPaused(false)
        push({ kind: "resumed", at: Date.now() / 1000 })
      })
      ws.on("done", (d) => {
        setStatus("done")
        setResult((d as { text: string }).text)
      })
      ws.on("exhausted", () => setStatus("done"))
      ws.on("refusal", () => setStatus("failed"))

      ws.connect()
      wsRef.current = ws
      setConnected(true)
    })()

    return () => {
      cancelled = true
      wsRef.current?.disconnect()
      wsRef.current = null
      setConnected(false)
      setFrame(null)
      setRows([])
      setResult(null)
      setStatus("running")
      setPaused(false)
    }
  }, [jobId])

  const control = useCallback(
    async (action: "pause" | "resume") => {
      if (!jobId) return
      // Optimistic: the run only checks the gate between turns, so the button
      // must reflect intent immediately or it reads as broken.
      setPaused(action === "pause")
      try {
        await fetch(`/api/proxy/browser/jobs/${jobId}/${action}`, { method: "POST" })
      } catch {
        setPaused(action !== "pause")
      }
    },
    [jobId],
  )

  /** The most recent action that resolved to an element, for the highlight. */
  const activeBox = (() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].kind === "action" && rows[i].box) return rows[i]
    }
    return null
  })()

  return { frame, rows, status, paused, result, connected, control, activeBox }
}
