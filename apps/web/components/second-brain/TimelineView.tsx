"use client"

import { useMemo } from "react"
import { Star, Link as LinkIcon, FileText, File, Mic, BookOpen } from "lucide-react"

interface KnowledgeItem {
  id: string
  type: string
  source_title: string | null
  summary: string | null
  domain: string | null
  starred: boolean
  saved_at: string
  properties: { status?: string; type?: string; priority?: string }
}

interface Props {
  items: KnowledgeItem[]
  onItemClick: (id: string) => void
  onToggleStar: (id: string, current: boolean) => void
}

function TypeIcon({ type }: { type: string }) {
  if (type === "url")      return <LinkIcon size={11} />
  if (type === "note")     return <FileText size={11} />
  if (type === "meeting")  return <Mic size={11} />
  if (type === "document") return <BookOpen size={11} />
  return <File size={11} />
}

export function TimelineView({ items, onItemClick, onToggleStar }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, KnowledgeItem[]>()
    const sorted = [...items].sort((a, b) => new Date(b.saved_at).getTime() - new Date(a.saved_at).getTime())
    for (const item of sorted) {
      const d = new Date(item.saved_at)
      const key = d.toLocaleDateString(undefined, { month: "short", year: "numeric" })
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(item)
    }
    return [...map.entries()]
  }, [items])

  return (
    <div style={{ maxWidth: 640, display: "flex", flexDirection: "column", gap: "2rem" }}>
      {grouped.map(([month, monthItems]) => (
        <div key={month}>
          <div style={{ marginBottom: "0.75rem", paddingBottom: "0.5rem", borderBottom: "1px solid var(--c-border-faint)" }}>
            <span className="tars-label">{month}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {monthItems.map(item => (
              <div
                key={item.id}
                onClick={() => onItemClick(item.id)}
                className="group"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: 8,
                  cursor: "pointer",
                  border: "1px solid transparent",
                  transition: "background 100ms",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface)" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "" }}
              >
                <span style={{ color: "var(--c-ink-faint)", flexShrink: 0 }}>
                  <TypeIcon type={item.type} />
                </span>
                <span style={{ fontSize: "0.8125rem", fontWeight: 500, color: "var(--c-ink)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.source_title ?? "Untitled"}
                </span>
                {item.domain && (
                  <span className="tars-label" style={{ color: "var(--c-ink-faint)", flexShrink: 0 }}>{item.domain}</span>
                )}
                <span className="tars-label" style={{ color: "var(--c-ink-faint)", flexShrink: 0 }}>
                  {new Date(item.saved_at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onToggleStar(item.id, item.starred) }}
                  style={{
                    color: "var(--c-amber)",
                    opacity: item.starred ? 1 : 0,
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                    transition: "opacity 150ms", flexShrink: 0,
                  }}
                >
                  <Star size={12} fill={item.starred ? "var(--c-amber)" : "none"} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
