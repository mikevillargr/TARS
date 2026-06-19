"use client"

import { useState } from "react"
import { Brain, BookOpen, ChevronDown } from "lucide-react"
import Link from "next/link"

export interface ContextSource {
  id: string
  type: "memory" | "knowledge"
  title: string
}

export function ContextSources({ sources }: { sources: ContextSource[] }) {
  const [expanded, setExpanded] = useState(false)

  if (!sources || sources.length === 0) return null

  const memCount = sources.filter(s => s.type === "memory").length
  const kbCount  = sources.filter(s => s.type === "knowledge").length

  const summary = [
    memCount > 0 && `${memCount} memor${memCount === 1 ? "y" : "ies"}`,
    kbCount  > 0 && `${kbCount} knowledge item${kbCount === 1 ? "" : "s"}`,
  ].filter(Boolean).join(", ")

  return (
    <div
      className="max-w-3xl mx-auto pl-0 sm:pl-11 mt-1"
    >
      {/* Disclosure toggle */}
      <button
        onClick={() => setExpanded(p => !p)}
        className="flex items-center gap-1.5 group"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
      >
        <Brain size={10} style={{ color: "var(--c-ink-faint)" }} />
        <span
          style={{
            fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
            fontSize: "10px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "var(--c-ink-faint)",
          }}
        >
          Context · {summary}
        </span>
        <ChevronDown
          size={10}
          style={{
            color: "var(--c-ink-faint)",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s",
          }}
        />
      </button>

      {/* Expanded source list */}
      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1">
          {sources.map(src => {
            const href = src.type === "memory"
              ? `/memory?id=${src.id}`
              : `/second-brain?id=${src.id}`
            const Icon = src.type === "memory" ? Brain : BookOpen
            return (
              <Link
                key={src.id}
                href={href}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg transition-colors no-underline"
                style={{
                  background: "var(--c-surface)",
                  border: "1px solid var(--c-border-faint)",
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "color-mix(in srgb, var(--c-moss) 35%, transparent)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--c-border-faint)")}
              >
                <Icon size={10} style={{ color: "var(--c-moss)", flexShrink: 0 }} />
                <span
                  style={{
                    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                    fontSize: "9px",
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--c-moss)",
                    flexShrink: 0,
                  }}
                >
                  {src.type === "memory" ? "MNEMON" : "SECOND BRAIN"}
                </span>
                <span
                  className="truncate"
                  style={{ fontSize: "11px", color: "var(--c-ink-muted)" }}
                >
                  {src.title}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
