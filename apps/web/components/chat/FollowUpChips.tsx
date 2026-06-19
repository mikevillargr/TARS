"use client"

import { ChevronRight } from "lucide-react"

export function FollowUpChips({
  suggestions,
  onAsk,
}: {
  suggestions: string[]
  onAsk: (q: string) => void
}) {
  if (!suggestions || suggestions.length === 0) return null

  return (
    <div className="max-w-3xl mx-auto pl-0 sm:pl-11 flex flex-col gap-1.5 mt-1">
      {suggestions.map((s, i) => (
        <button
          key={i}
          onClick={() => onAsk(s)}
          className="group flex items-center justify-between gap-2 text-left px-3 py-2 rounded-lg transition-all"
          style={{
            background: "var(--c-surface)",
            border: "1px solid var(--c-border-faint)",
            fontSize: "12px",
            color: "var(--c-ink-muted)",
            cursor: "pointer",
          }}
          onMouseEnter={e => {
            const el = e.currentTarget
            el.style.borderColor = "color-mix(in srgb, var(--c-moss) 40%, transparent)"
            el.style.color = "var(--c-ink)"
          }}
          onMouseLeave={e => {
            const el = e.currentTarget
            el.style.borderColor = "var(--c-border-faint)"
            el.style.color = "var(--c-ink-muted)"
          }}
        >
          <span>{s}</span>
          <ChevronRight
            size={12}
            style={{ color: "var(--c-moss)", flexShrink: 0, opacity: 0.6 }}
          />
        </button>
      ))}
    </div>
  )
}
