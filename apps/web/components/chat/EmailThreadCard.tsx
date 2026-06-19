"use client"

import { useState } from "react"
import { Mail, ExternalLink, Reply, X } from "lucide-react"

export interface EmailThread {
  subject: string
  sender_name: string
  sender_email: string
  date: string
  snippet: string
  thread_id?: string
  account?: "work" | "personal"
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("")
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / 86_400_000)
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    if (diffDays === 1) return "Yesterday"
    if (diffDays < 7)  return d.toLocaleDateString([], { weekday: "short" })
    return d.toLocaleDateString([], { month: "short", day: "numeric" })
  } catch { return iso }
}

export function EmailThreadCard({
  thread,
  onDismiss,
  onAsk,
}: {
  thread: EmailThread
  onDismiss: () => void
  onAsk?: (q: string) => void
}) {
  const [replying, setReplying] = useState(false)
  const [replied, setReplied] = useState(false)

  const gmailUrl = thread.thread_id
    ? `https://mail.google.com/mail/u/0/#inbox/${thread.thread_id}`
    : `https://mail.google.com/mail/u/0/#inbox`

  const handleReply = () => {
    if (onAsk && thread.thread_id) {
      onAsk(`Reply to the email "${thread.subject}" (thread ${thread.thread_id}): `)
      setReplied(true)
    }
  }

  const ini = initials(thread.sender_name || thread.sender_email)

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--c-surface)",
        border: "1px solid var(--c-border-faint)",
        maxWidth: 480,
      }}
    >
      {/* Header row */}
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        {/* Avatar */}
        <div
          className="w-8 h-8 rounded-full shrink-0 flex items-center justify-center"
          style={{
            background: "color-mix(in srgb, var(--c-moss) 15%, var(--c-surface-2))",
            border: "1px solid color-mix(in srgb, var(--c-moss) 20%, transparent)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: "10px",
              fontWeight: 700,
              color: "var(--c-moss)",
              letterSpacing: "0.04em",
            }}
          >
            {ini}
          </span>
        </div>

        {/* Sender + subject */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span
              className="truncate"
              style={{ fontSize: "12px", fontWeight: 600, color: "var(--c-ink)" }}
            >
              {thread.sender_name || thread.sender_email}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: "9.5px",
                color: "var(--c-ink-faint)",
                flexShrink: 0,
                letterSpacing: "0.04em",
              }}
            >
              {fmtDate(thread.date)}
            </span>
          </div>
          <p
            className="truncate mt-0.5"
            style={{ fontSize: "11.5px", fontWeight: 600, color: "var(--c-ink)" }}
          >
            {thread.subject}
          </p>
        </div>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          style={{ color: "var(--c-ink-faint)", background: "none", border: "none", cursor: "pointer", padding: "0 0 0 4px", flexShrink: 0 }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Snippet */}
      {thread.snippet && (
        <p
          className="px-3 pb-2 line-clamp-2"
          style={{ fontSize: "11.5px", color: "var(--c-ink-muted)", lineHeight: 1.5 }}
        >
          {thread.snippet}
        </p>
      )}

      {/* Divider + actions */}
      <div
        className="flex items-center gap-1 px-2.5 py-2"
        style={{ borderTop: "1px solid var(--c-border-faint)" }}
      >
        {/* Account badge */}
        {thread.account && (
          <span
            style={{
              fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
              fontSize: "9px",
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--c-ink-faint)",
              marginRight: 4,
            }}
          >
            {thread.account}
          </span>
        )}

        <div className="flex-1" />

        {onAsk && thread.thread_id && (
          <button
            onClick={handleReply}
            disabled={replied}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors"
            style={{
              background: replied ? "color-mix(in srgb, var(--c-moss) 12%, transparent)" : "var(--c-surface-2)",
              border: "1px solid var(--c-border-faint)",
              color: replied ? "var(--c-moss)" : "var(--c-ink-muted)",
              cursor: replied ? "default" : "pointer",
            }}
          >
            <Reply size={10} />
            {replied ? "Composing…" : "Reply"}
          </button>
        )}

        <a
          href={gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] transition-colors no-underline"
          style={{
            background: "var(--c-surface-2)",
            border: "1px solid var(--c-border-faint)",
            color: "var(--c-ink-muted)",
          }}
        >
          <ExternalLink size={10} />
          Open
        </a>
      </div>
    </div>
  )
}
