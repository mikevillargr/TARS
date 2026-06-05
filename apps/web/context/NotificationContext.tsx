"use client"

import {
  createContext, useContext, useState, useCallback, useRef, useEffect,
} from "react"
import { useNotifications, type TarsNotification } from "@/hooks/useNotifications"

export type { TarsNotification }

interface NotificationCtx {
  hasUnread: boolean
  clearUnread: () => void
  // Subscribe to raw notification events (returns an unsubscribe fn).
  // Used by the chat page so it doesn't need its own WebSocket.
  subscribe: (fn: (n: TarsNotification) => void) => () => void
}

const Ctx = createContext<NotificationCtx>({
  hasUnread: false,
  clearUnread: () => {},
  subscribe: () => () => {},
})

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const [hasUnread, setHasUnread] = useState(false)
  const listeners = useRef<Set<(n: TarsNotification) => void>>(new Set())
  // Session-level dedup — prevents replayed or duplicate WS events from
  // re-firing the chime or re-showing the dot for already-seen messages.
  const seenIds = useRef(new Set<string>())

  const subscribe = useCallback((fn: (n: TarsNotification) => void) => {
    listeners.current.add(fn)
    return () => { listeners.current.delete(fn) }
  }, [])

  const clearUnread = useCallback(() => setHasUnread(false), [])

  useNotifications((notif) => {
    if (notif.type === "new_message") {
      if (seenIds.current.has(notif.message_id)) return
      seenIds.current.add(notif.message_id)
      setHasUnread(true)
    }
    listeners.current.forEach(fn => fn(notif))
  })

  return (
    <Ctx.Provider value={{ hasUnread, clearUnread, subscribe }}>
      {children}
    </Ctx.Provider>
  )
}

export const useNotificationContext = () => useContext(Ctx)
