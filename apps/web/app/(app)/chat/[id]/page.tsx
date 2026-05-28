"use client"

import { useEffect, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import { MessageThread, type Message, type Attachment } from "@/components/chat/message-thread"
import { MessageInput } from "@/components/chat/message-input"
import { apiGet } from "@/lib/api-client"

interface ConversationDetail {
  id: string
  title: string | null
  messages: Message[]
}

interface StreamingMsg {
  role: "assistant"
  content: string
  streaming: true
}

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>()
  const [messages, setMessages] = useState<Message[]>([])
  const [streaming, setStreaming] = useState<StreamingMsg | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    apiGet<ConversationDetail>(`/chat/conversations/${id}`)
      .then((d) => setMessages(d.messages))
      .catch(console.error)
  }, [id])

  const handleSend = useCallback(
    async (content: string, attachments: File[]) => {
      if (busy || !id) return
      setBusy(true)

      const _attachments: Attachment[] = attachments.map((f) => ({
        name: f.name,
        url: URL.createObjectURL(f),
        type: f.type,
      }))

      const tempUser: Message = {
        id: `temp-${Date.now()}`,
        role: "user",
        content,
        created_at: new Date().toISOString(),
        _attachments,
      }
      setMessages((prev) => [...prev, tempUser])
      setStreaming({ role: "assistant", content: "", streaming: true })

      try {
        const fd = new FormData()
        fd.append("content", content)
        for (const f of attachments) fd.append("files", f)

        const res = await fetch(`/api/proxy/chat/conversations/${id}/messages`, {
          method: "POST",
          body: fd,
        })

        if (!res.ok || !res.body) throw new Error("Stream failed")

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let accumulated = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? ""

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const raw = line.slice(6).trim()
            if (raw === "[DONE]") break
            try {
              const evt = JSON.parse(raw)
              if (evt.type === "chunk") {
                accumulated += evt.text
                setStreaming({ role: "assistant", content: accumulated, streaming: true })
              } else if (evt.type === "done") {
                const finalMsg: Message = {
                  id: `done-${Date.now()}`,
                  role: "assistant",
                  content: accumulated,
                  model_used: evt.model,
                  tokens_used: evt.tokens,
                  created_at: new Date().toISOString(),
                }
                setMessages((prev) => [...prev.filter((m) => m.id !== tempUser.id), tempUser, finalMsg])
                setStreaming(null)
              }
            } catch {
              // ignore parse errors
            }
          }
        }
      } catch (err) {
        console.error(err)
        setStreaming(null)
      } finally {
        setBusy(false)
      }
    },
    [id, busy]
  )

  return (
    <div className="flex flex-col h-full">
      <MessageThread messages={messages} streaming={streaming} />
      <MessageInput onSend={handleSend} disabled={busy} />
    </div>
  )
}
