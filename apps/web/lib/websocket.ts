type MessageHandler = (data: unknown) => void

export class TarsWebSocket {
  private ws: WebSocket | null = null
  private handlers = new Map<string, MessageHandler[]>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private url: string

  constructor(path: string) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
    this.url = `${protocol}//${window.location.host}/api/proxy/ws/${path}`
  }

  connect() {
    this.ws = new WebSocket(this.url)

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const handlers = this.handlers.get(msg.type) ?? []
        handlers.forEach((h) => h(msg.data))
      } catch {
        // ignore malformed messages
      }
    }

    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 3000)
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

  send(type: string, data: unknown) {
    this.ws?.send(JSON.stringify({ type, data }))
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
  }
}
