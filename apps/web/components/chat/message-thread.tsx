"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import { ChevronRight, Download, FileCode, FileSpreadsheet, FileText, X } from "lucide-react"
import { ModelBadge } from "./model-badge"
import { cn } from "@/lib/utils"

// Strip [[id|type|label]] mention markers → `[[label]]` for display in message bubbles
function stripMentions(content: string): string {
  return content.replace(/\[\[[^\]|]+\|[^\]|]+\|([^\]]+)\]\]/g, "`[[$1]]`")
}

export interface Attachment {
  name: string
  url: string
  type: string
  size?: number
}

export interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  model_used?: string
  tokens_used?: number
  created_at: string
  _attachments?: Attachment[]
  tool_results?: Record<string, unknown>[]
}

interface StreamingMessage {
  role: "assistant"
  content: string
  streaming: true
  cards?: Record<string, unknown>[]
  thinking?: string
  thinkingDone?: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ""
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function fileTypeIcon(name: string, type: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  const ct = type.toLowerCase()
  if (ct === "application/pdf" || ext === "pdf")
    return <FileText className="size-4 text-red-400 shrink-0" />
  if (ct.includes("spreadsheet") || ["xlsx", "xls", "csv"].includes(ext))
    return <FileSpreadsheet className="size-4 text-green-400 shrink-0" />
  if (ct.includes("presentation") || ext === "pptx")
    return <FileText className="size-4 text-orange-400 shrink-0" />
  if (["json", "yaml", "yml", "xml"].includes(ext))
    return <FileCode className="size-4 text-purple-400 shrink-0" />
  return <FileText className="size-4 text-muted-foreground shrink-0" />
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 cursor-zoom-out"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
        type="button"
      >
        <X className="size-6" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

function proxyImageUrl(url: string): string {
  return `/api/proxy/image-proxy?url=${encodeURIComponent(url)}`
}

function SearchImagesCard({ images, query }: { images: string[]; query?: string }) {
  const [lightbox, setLightbox] = useState<string | null>(null)

  if (images.length === 0) return null

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1 mb-2" style={{ scrollbarWidth: "thin" }}>
        {images.map((url, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setLightbox(proxyImageUrl(url))}
            className="shrink-0 focus:outline-none cursor-zoom-in rounded-lg overflow-hidden"
            style={{ border: "1px solid rgba(255,255,255,0.08)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={proxyImageUrl(url)}
              alt={query ? `Image for: ${query}` : "Search result"}
              className="h-28 w-auto max-w-[200px] object-cover hover:opacity-90 transition-opacity"
              onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none" }}
            />
          </button>
        ))}
      </div>
      {lightbox && (
        <ImageLightbox src={lightbox} alt={query ?? "Search result"} onClose={() => setLightbox(null)} />
      )}
    </>
  )
}

function AttachmentList({ attachments, isUser }: { attachments: Attachment[]; isUser: boolean }) {
  const [lightbox, setLightbox] = useState<Attachment | null>(null)

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-2">
        {attachments.map((att, i) =>
          att.type.startsWith("image/") ? (
            <button
              key={i}
              type="button"
              onClick={() => setLightbox(att)}
              className="focus:outline-none cursor-zoom-in"
              title="View full size"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={att.url}
                alt={att.name}
                className="max-w-[240px] max-h-[180px] rounded-lg object-cover hover:opacity-90 transition-opacity"
              />
            </button>
          ) : (
            <div
              key={i}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-xs",
                isUser ? "bg-white/15" : "bg-black/10 dark:bg-white/10"
              )}
            >
              {fileTypeIcon(att.name, att.type)}
              <div className="flex flex-col min-w-0">
                <span className="max-w-[160px] truncate font-medium leading-tight">{att.name}</span>
                {att.size !== undefined && (
                  <span className="text-[10px] opacity-60 leading-tight">{formatSize(att.size)}</span>
                )}
              </div>
              <a
                href={att.url}
                download={att.name}
                onClick={(e) => e.stopPropagation()}
                title="Download"
                className="ml-1 opacity-60 hover:opacity-100 transition-opacity shrink-0"
              >
                <Download className="size-3.5" />
              </a>
            </div>
          )
        )}
      </div>

      {lightbox && (
        <ImageLightbox
          src={lightbox.url}
          alt={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  )
}

export function ThinkingBlock({ text, done }: { text: string; done: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!done && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [text, done])

  if (!done) {
    return (
      <div
        className="mb-2.5 rounded-r-md"
        style={{ borderLeft: "2px solid var(--c-moss)", backgroundColor: "color-mix(in srgb, var(--c-moss) 6%, transparent)" }}
      >
        <div className="px-3 pt-2 pb-0.5 flex items-center gap-2">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              backgroundColor: "var(--c-moss)",
              animation: "tars-think-pulse 1.2s ease-in-out infinite",
            }}
          />
          <span
            className="font-mono text-[10px] tracking-[0.12em] uppercase font-medium"
            style={{ color: "var(--c-moss)" }}
          >
            reasoning
          </span>
        </div>
        <div
          ref={scrollRef}
          className="px-3 pb-2 overflow-y-auto"
          style={{ maxHeight: 112, scrollbarWidth: "none" }}
        >
          <p
            className="font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap"
            style={{ color: "var(--c-ink-faint)" }}
          >
            {text}
            <span
              className="inline-block w-1.5 h-3.5 ml-0.5 align-[-3px]"
              style={{
                backgroundColor: "var(--c-moss)",
                animation: "tars-think-blink 0.9s step-end infinite",
              }}
            />
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-2.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 transition-colors"
        style={{
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 10,
          letterSpacing: "0.10em",
          textTransform: "uppercase",
          color: "var(--c-ink-faint)",
          border: "0.5px solid var(--c-border-faint)",
          background: "var(--c-surface)",
        }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: "var(--c-moss)" }}
        />
        [reasoned]
        <ChevronRight
          size={10}
          style={{
            transition: "transform 0.15s",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        />
      </button>
      {expanded && (
        <div
          className="mt-1 rounded-r-sm px-3 py-2"
          style={{
            borderLeft: "1.5px solid var(--c-border-faint)",
            fontFamily: "var(--font-mono, monospace)",
            fontSize: 11.5,
            lineHeight: 1.7,
            color: "var(--c-ink-faint)",
            whiteSpace: "pre-wrap",
          }}
        >
          {text}
        </div>
      )}
    </div>
  )
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
        <div className="text-center space-y-3">
          <p className="font-mono text-2xl tracking-[0.35em] text-foreground pl-[0.35em]">TARS</p>
          <p className="tars-label tars-label--muted">Standby — what do you need?</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-4 md:px-4 md:py-6">
      <div className="max-w-3xl mx-auto space-y-6">
        {all.map((msg, i) => (
          <MessageBubble key={"id" in msg ? msg.id : `stream-${i}`} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function ChartImageCard({ card }: { card: Record<string, unknown> }) {
  const title = typeof card.title === "string" ? card.title : "chart"
  const b64   = card.image_base64 as string
  const src   = `data:image/png;base64,${b64}`

  const download = () => {
    const a = document.createElement("a")
    a.href = src
    a.download = title + ".png"
    a.click()
  }

  return (
    <div
      className="my-3 rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--c-border)" }}
    >
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ backgroundColor: "var(--c-surface-2)", borderBottom: "1px solid var(--c-border)" }}
      >
        <span className="text-[11px] font-mono" style={{ color: "var(--c-ink-faint)" }}>{title}</span>
        <button
          onClick={download}
          className="text-[10px] px-2 py-0.5 rounded transition-colors"
          style={{ color: "var(--c-ink-faint)" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--c-ink)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--c-ink-faint)")}
        >
          download
        </button>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={title} style={{ display: "block", maxWidth: "100%", width: "100%" }} />
    </div>
  )
}

function ToolResultCards({ cards }: { cards: Record<string, unknown>[] }) {
  return (
    <>
      {cards.map((card, i) => {
        if (card.type === "chart_image" && typeof card.image_base64 === "string") {
          return <ChartImageCard key={i} card={card} />
        }
        if (card.type === "search_images" && Array.isArray(card.images)) {
          return (
            <SearchImagesCard
              key={i}
              images={card.images as string[]}
              query={typeof card.query === "string" ? card.query : undefined}
            />
          )
        }
        return null
      })}
    </>
  )
}

function MessageBubble({ msg }: { msg: Message | StreamingMessage }) {
  const isUser = msg.role === "user"
  const isStreaming = "streaming" in msg
  const cards = isStreaming
    ? (msg.cards ?? [])
    : ("tool_results" in msg ? (msg.tool_results ?? []) : [])

  return (
    <div className={cn("flex flex-col min-w-0 gap-1", isUser ? "items-end" : "items-start")}>
      {/* Speaker + time eyebrow — instrument log marker (prose stays Inter) */}
      <div className={cn("flex items-center gap-2 px-1", isUser ? "flex-row-reverse" : "flex-row")}>
        <span className={cn("tars-label", isUser ? "tars-label--muted" : "tars-label--moss")}>
          {isUser ? "Mike" : "TARS"}
        </span>
        {!isStreaming && "created_at" in msg && msg.created_at && (
          <span className="tars-label tars-label--muted" style={{ opacity: 0.65 }}>
            {formatTime(msg.created_at)}
          </span>
        )}
      </div>

      <div
        className="min-w-0 max-w-[93%] md:max-w-[80%] rounded-lg border px-3 py-2.5 md:px-4 md:py-3 overflow-hidden"
        style={{
          backgroundColor: isUser ? "var(--c-surface-2)" : "var(--c-surface)",
          borderColor: "var(--c-border-faint)",
          color: "var(--c-ink)",
        }}
      >
        {"_attachments" in msg && msg._attachments && msg._attachments.length > 0 && (
          <AttachmentList attachments={msg._attachments} isUser={false} />
        )}

        {!isUser && isStreaming && msg.thinking && (
          <ThinkingBlock text={msg.thinking} done={!!msg.thinkingDone} />
        )}

        {!isUser && cards.length > 0 && <ToolResultCards cards={cards} />}

        {msg.content && (
          <div className={cn("prose md:prose-sm max-w-none dark:prose-invert")}>
            <ReactMarkdown
              urlTransform={(url: string) => url}
              components={{
                pre: ({ children }) => <>{children}</>,
                code({ className, children }) {
                  if (className) {
                    return (
                      <pre
                        className="overflow-x-auto rounded-md my-2 p-3 text-xs font-mono"
                        style={{ maxWidth: "100%", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                      >
                        <code className={className}>{children}</code>
                      </pre>
                    )
                  }
                  return (
                    <code className="px-1 py-0.5 rounded text-xs font-mono" style={{ backgroundColor: "rgba(0,0,0,0.08)" }}>
                      {children}
                    </code>
                  )
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                img: (props: any) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={props.src}
                    alt={props.alt || ""}
                    className="rounded-lg my-2"
                    style={{ maxWidth: "100%" }}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }}
                  />
                ),
              }}
            >
              {isUser ? stripMentions(msg.content) : msg.content}
            </ReactMarkdown>
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
