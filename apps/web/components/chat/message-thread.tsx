"use client"

import { useEffect, useRef } from "react"
import ReactMarkdown from "react-markdown"
import { ModelBadge } from "./model-badge"
import { cn } from "@/lib/utils"

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  model_used?: string
  tokens_used?: number
  created_at: string
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
    <div className="flex-1 overflow-y-auto px-4 py-6">
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
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted text-foreground rounded-bl-sm"
        )}
      >
        <div className={cn("prose prose-sm max-w-none", isUser ? "prose-invert" : "dark:prose-invert")}>
          <ReactMarkdown>{msg.content}</ReactMarkdown>
        </div>

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
