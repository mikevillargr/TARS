"use client"

import { Mic, Users, FileText, X, ExternalLink } from "lucide-react"
import Link from "next/link"

export interface MeetingCardData {
  id: string
  title: string
  date?: string
  attendees?: string[]
  summary_excerpt?: string
  status?: string
  action_item_count?: number
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "")
    .join("")
}

function AvatarStack({ attendees }: { attendees: string[] }) {
  const show = attendees.slice(0, 4)
  const rest = attendees.length - show.length
  return (
    <div className="flex items-center" style={{ gap: -4 }}>
      {show.map((a, i) => (
        <div
          key={i}
          className="flex items-center justify-center rounded-full"
          style={{
            width: 20,
            height: 20,
            background: "color-mix(in srgb, var(--c-moss) 12%, var(--c-surface-2))",
            border: "1.5px solid var(--c-canvas)",
            marginLeft: i > 0 ? -6 : 0,
            fontSize: "8px",
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontWeight: 700,
            color: "var(--c-moss)",
            letterSpacing: "0.02em",
            flexShrink: 0,
          }}
          title={a}
        >
          {initials(a)}
        </div>
      ))}
      {rest > 0 && (
        <div
          className="flex items-center justify-center rounded-full"
          style={{
            width: 20,
            height: 20,
            background: "var(--c-surface-2)",
            border: "1.5px solid var(--c-canvas)",
            marginLeft: -6,
            fontSize: "8px",
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            color: "var(--c-ink-faint)",
          }}
        >
          +{rest}
        </div>
      )}
    </div>
  )
}

export function MeetingCard({
  meeting,
  onDismiss,
}: {
  meeting: MeetingCardData
  onDismiss: () => void
}) {
  const dateStr = (() => {
    if (!meeting.date) return null
    try {
      return new Date(meeting.date).toLocaleDateString([], {
        weekday: "short", month: "short", day: "numeric",
      })
    } catch { return meeting.date }
  })()

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--c-surface)",
        border: "1px solid var(--c-border-faint)",
        maxWidth: 480,
      }}
    >
      {/* Header */}
      <div className="flex items-start gap-2.5 px-3 pt-3 pb-2">
        {/* Icon */}
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "color-mix(in srgb, var(--c-moss) 10%, var(--c-surface-2))",
            border: "1px solid color-mix(in srgb, var(--c-moss) 20%, transparent)",
          }}
        >
          <Mic size={13} style={{ color: "var(--c-moss)" }} />
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0">
          <p
            className="truncate"
            style={{ fontSize: "13px", fontWeight: 600, color: "var(--c-ink)", lineHeight: 1.3 }}
          >
            {meeting.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {dateStr && (
              <span
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: "9.5px",
                  color: "var(--c-ink-faint)",
                  letterSpacing: "0.04em",
                }}
              >
                {dateStr}
              </span>
            )}
            {meeting.status && (
              <span
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: "9px",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: meeting.status === "ready" ? "var(--c-moss)" : "var(--c-ink-faint)",
                }}
              >
                {meeting.status}
              </span>
            )}
            {meeting.action_item_count != null && meeting.action_item_count > 0 && (
              <span style={{ fontSize: "11px", color: "var(--c-ink-faint)" }}>
                {meeting.action_item_count} action item{meeting.action_item_count !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <button
          onClick={onDismiss}
          style={{ color: "var(--c-ink-faint)", background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Summary excerpt */}
      {meeting.summary_excerpt && (
        <p
          className="px-3 pb-2 line-clamp-2"
          style={{ fontSize: "11.5px", color: "var(--c-ink-muted)", lineHeight: 1.5 }}
        >
          {meeting.summary_excerpt}
        </p>
      )}

      {/* Footer */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderTop: "1px solid var(--c-border-faint)" }}
      >
        {meeting.attendees && meeting.attendees.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Users size={10} style={{ color: "var(--c-ink-faint)" }} />
            <AvatarStack attendees={meeting.attendees} />
          </div>
        )}
        <div className="flex-1" />
        <Link
          href={`/meetings?id=${meeting.id}`}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] no-underline font-medium transition-colors"
          style={{
            background: "var(--c-surface-2)",
            border: "1px solid var(--c-border-faint)",
            color: "var(--c-ink-muted)",
          }}
        >
          <FileText size={10} />
          View transcript
        </Link>
      </div>
    </div>
  )
}
