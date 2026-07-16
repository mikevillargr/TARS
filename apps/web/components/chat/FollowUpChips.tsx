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
          className="follow-up-chip flex items-center justify-between gap-2 text-left px-3 py-2 rounded-lg"
          style={{
            background: "var(--c-surface)",
            border: "1px solid var(--c-border-faint)",
            fontSize: "12px",
            color: "var(--c-ink-muted)",
            cursor: "pointer",
            transition: "border-color 150ms, color 150ms",
            animation: "tars-chip-in 240ms var(--ease-out-quart) both",
            animationDelay: `${i * 55}ms`,
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
