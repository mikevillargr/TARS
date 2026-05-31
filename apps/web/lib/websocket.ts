type MessageHandler = (data: unknown) => void

export class TarsWebSocket {
  private ws: WebSocket | null = null
  private handlers = new Map<string, MessageHandler[]>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private url: string
  private _shouldReconnect = true

  /**
   * @param path    WebSocket path, e.g. "agent-jobs/abc123/stream?token=xxx"
   * @param baseUrl Optional base URL override, e.g. "http://localhost:8000".
   *                Defaults to current window origin. Used for agent job streams
   *                that connect directly to the FastAPI harness.
   */
  constructor(path: string, baseUrl?: string) {
    if (baseUrl) {
      const wsBase = baseUrl.replace(/^http/, "ws")
      this.url = `${wsBase}/api/${path}`
    } else {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      this.url = `${protocol}//${window.location.host}/api/proxy/ws/${path}`
    }
  }

  connect() {
    this._shouldReconnect = true
    this.ws = new WebSocket(this.url)

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === "ping") return
        const handlers = this.handlers.get(msg.type) ?? []
        handlers.forEach((h) => h(msg.data !== undefined ? msg.data : msg))
      } catch {
        // ignore malformed messages
      }
    }

    this.ws.onclose = () => {
      if (this._shouldReconnect) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000)
      }
    }

    this.ws.onerror = () => {
      // onclose will fire after onerror — let reconnect handle it
    }
  }

  on(type: string, handler: MessageHandler) {
    const existing = this.handlers.get(type) ?? []
    this.handlers.set(type, [...existing, handler])
  }

  off(type: string, handler: MessageHandler) {
    const existing = this.handlers.get(type) ?? []
    this.handlers.set(type, existing.filter((h) => h !== handler))
  }

  send(type: string, data?: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data !== undefined ? { type, ...data as object } : { type }))
    }
  }

  sendRaw(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  disconnect() {
    this._shouldReconnect = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }
}

/** Fetch a fresh JWT from the harness for use in WebSocket query params. */
export async function getWsToken(): Promise<string> {
  const res = await fetch("/api/proxy/auth/token", { credentials: "include" })
  if (!res.ok) throw new Error("Failed to get WS token")
  const data = await res.json()
  return data.token as string
}
