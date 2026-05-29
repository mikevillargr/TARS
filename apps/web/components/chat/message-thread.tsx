"use client"

import { useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"
import { ModelBadge } from "./model-badge"
import { cn } from "@/lib/utils"

export interface Attachment {
  name: string
  url: string
  type: string
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  model_used?: string
  tokens_used?: number
  created_at: string
  _attachments?: Attachment[]
}

interface StreamingMessage {
  role: "assistant"
  content: string
  streaming: true
}

export function MessageThread({
  messages,
  streaming,
}: {
  messages: Message[]
  streaming: StreamingMessage | null
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streaming?.content])

  const all = streaming
    ? [...messages, streaming]
    : messages

  if (all.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-2xl font-bold text-foreground">TARS</p>
          <p className="text-sm text-muted-foreground">What do you need?</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {all.map((msg, i) => (
          <MessageBubble key={"id" in msg ? msg.id : `stream-${i}`} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message | StreamingMessage }) {
  const isUser = msg.role === "user"
  const isStreaming = "streaming" in msg

  return (
    <div className={cn("flex min-w-0", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[80%] rounded-2xl px-4 py-3 text-sm overflow-hidden",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        )}
      >
        {"_attachments" in msg && msg._attachments && msg._attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {msg._attachments.map((att, i) =>
              att.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={i}
                  src={att.url}
                  alt={att.name}
                  className="max-w-[240px] max-h-[180px] rounded-lg object-cover"
                />
              ) : (
                <div key={i} className="flex items-center gap-1.5 bg-white/10 rounded-lg px-2 py-1 text-xs">
                  <span>📎</span>
                  <span className="max-w-[140px] truncate">{att.name}</span>
                </div>
              )
            )}
          </div>
        )}
        {msg.content && (
          <div className={cn("prose prose-sm max-w-none", isUser ? "prose-invert" : "dark:prose-invert")}>
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        )}

        {!isUser && !isStreaming && "model_used" in msg && msg.model_used && (
          <div className="mt-2 flex items-center gap-2">
            <ModelBadge model={msg.model_used} />
            {msg.tokens_used ? (
              <span className="text-[10px] text-muted-foreground font-mono">
                {msg.tokens_used} tok
              </span>
            ) : null}
          </div>
        )}

        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 bg-foreground/40 ml-0.5 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  )
}
