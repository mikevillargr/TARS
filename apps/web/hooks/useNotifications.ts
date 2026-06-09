"use client"

import { useEffect, useRef, useCallback } from "react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

export interface TarsNotification {
  type: "new_message"
  conversation_id: string
  message_id: string
  preview: string
  created_at: string
}

type Handler = (n: TarsNotification) => void

/**
 * Subscribe to real-time TARS notifications.
 *
 * Phase 1 (now): new_message events from agent job completions.
 * Phase 2: extend with calendar reminders, task due alerts, meeting
 *          starting events — the backend publishes to the same channel.
 *
 * Reconnects automatically on disconnect and on tab focus (mobile/desktop).
 */
export function useNotifications(onNotification: Handler) {
  const wsRef = useRef<TarsWebSocket | null>(null)
  const handlerRef = useRef(onNotification)
  useEffect(() => { handlerRef.current = onNotification })

  const connect = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.disconnect()
      wsRef.current = null
    }
    try {
      const token = await getWsToken()
      // baseUrl="" → nginx-direct path (wss://<host>/api/notifications/stream)
      // Required because the Next.js proxy route is HTTP-only and silently
      // drops WebSocket upgrade requests.
      const ws = new TarsWebSocket(`notifications/stream?token=${token}`, "")
      wsRef.current = ws

      ws.on("new_message", (msg: unknown) => {
        handlerRef.current(msg as TarsNotification)
      })

      ws.connect()
    } catch {
      // retry on next focus
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.disconnect()
      wsRef.current = null
    }
  }, [connect])
}
