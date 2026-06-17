"use client"

import { useRef, useState } from "react"
import { Star, Link as LinkIcon, FileText, File, Mic, BookOpen } from "lucide-react"

interface KnowledgeItem {
  id: string
  type: string
  source_title: string | null
  summary: string | null
  domain: string | null
  tags: string[]
  starred: boolean
  saved_at: string
  properties: { status?: string; type?: string; priority?: string }
}

interface Props {
  items: KnowledgeItem[]
  onStatusChange: (id: string, status: string) => void
  onItemClick: (id: string) => void
  onToggleStar: (id: string, current: boolean) => void
}

const COLUMNS = [
  { key: "raw",        label: "Raw",        dot: "var(--c-amber)" },
  { key: "developing", label: "Developing", dot: "var(--c-moss)" },
  { key: "actionable", label: "Actionable", dot: "var(--c-moss)" },
  { key: "archived",   label: "Archived",   dot: "var(--c-ink-faint)" },
] as const

function TypeIcon({ type }: { type: string }) {
  if (type === "url")      return <LinkIcon size={11} />
  if (type === "note")     return <FileText size={11} />
  if (type === "meeting")  return <Mic size={11} />
  if (type === "document") return <BookOpen size={11} />
  return <File size={11} />
}

export function KanbanView({ items, onStatusChange, onItemClick, onToggleStar }: Props) {
  const dragId = useRef<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  function getColItems(status: string) {
    return items.filter(i => (i.properties?.status ?? "raw") === status)
  }

  return (
    <div style={{ display: "flex", gap: "1rem", overflowX: "auto", alignItems: "flex-start", padding: "0.5rem" }}>
      {COLUMNS.map(col => {
        const colItems = getColItems(col.key)
        const isOver = overCol === col.key
        return (
          <div
            key={col.key}
            onDragOver={e => { e.preventDefault(); setOverCol(col.key) }}
            onDragLeave={() => setOverCol(null)}
            onDrop={() => {
              if (dragId.current) { onStatusChange(dragId.current, col.key); dragId.current = null }
              setOverCol(null)
            }}
            style={{
              width: 240,
              minWidth: 240,
              background: isOver ? "var(--c-surface-2)" : "var(--c-surface)",
              borderRadius: 10,
              border: "1px solid var(--c-border-faint)",
              padding: "0.75rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
              transition: "background 150ms",
            }}
          >
            {/* Column header */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.dot, flexShrink: 0, display: "inline-block" }} />
              <span className="tars-label">{col.label}</span>
              <span className="tars-label" style={{ marginLeft: "auto", color: "var(--c-ink-faint)" }}>{colItems.length}</span>
            </div>

            {colItems.map(item => (
              <div
                key={item.id}
                draggable
                onDragStart={() => { dragId.current = item.id }}
                onClick={() => onItemClick(item.id)}
                style={{
                  background: "var(--c-canvas)",
                  border: "1px solid var(--c-border-faint)",
                  borderRadius: 8,
                  padding: "0.625rem 0.75rem",
                  cursor: "pointer",
                  borderLeft: "3px solid transparent",
                  transition: "border-color 150ms, box-shadow 150ms",
                  position: "relative",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "var(--c-moss)" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent" }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "0.375rem", marginBottom: "0.25rem" }}>
                  <span style={{ color: "var(--c-ink-faint)", marginTop: 1, flexShrink: 0 }}>
                    <TypeIcon type={item.type} />
                  </span>
                  <span style={{
                    fontSize: "0.8125rem",
                    fontWeight: 500,
                    color: "var(--c-ink)",
                    lineHeight: 1.3,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    flex: 1,
                  }}>
                    {item.source_title ?? "Untitled"}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); onToggleStar(item.id, item.starred) }}
                    style={{ color: "var(--c-amber)", opacity: item.starred ? 1 : 0, transition: "opacity 150ms", flexShrink: 0, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                    className="group-hover:opacity-100"
                  >
                    <Star size={11} fill={item.starred ? "var(--c-amber)" : "none"} />
                  </button>
                </div>
                {item.domain && (
                  <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>{item.domain}</span>
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
