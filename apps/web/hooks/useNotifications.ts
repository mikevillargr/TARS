"use client"

import { useEffect, useRef, useCallback } from "react"
import { TarsWebSocket, getWsToken } from "@/lib/websocket"

export type TarsNotification =
  | {
      type: "new_message"
      conversation_id: string
      message_id: string
      preview: string
      created_at: string
    }
  | {
      type: "attachment_saved"
      artifact_id: string
      filename: string
      category: string
    }

type Handler = (n: TarsNotification) => void

/**
 * Subscribe to real-time TARS notifications.
 *
 * Event types:
 *   new_message       — agent job completions (chat unread dot, chime)
 *   attachment_saved  — gmail_attachment_sync saved an email attachment
 *                       as an Artifact (subtle toast with an Open link)
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

      ws.on("attachment_saved", (msg: unknown) => {
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
