"use client"

import { Star } from "lucide-react"

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
  onItemClick: (id: string) => void
  onToggleStar: (id: string, current: boolean) => void
}

const DOMAIN_COLORS: Record<string, string> = {
  work:       "#2d5a4f",
  personal:   "#a16207",
  health:     "#b45309",
  cycling:    "#15803d",
  client:     "#1d4ed8",
  research:   "#7c3aed",
  default:    "#6b7280",
}

function domainColor(domain: string | null) {
  return domain ? (DOMAIN_COLORS[domain.toLowerCase()] ?? DOMAIN_COLORS.default) : DOMAIN_COLORS.default
}

export function GalleryView({ items, onItemClick, onToggleStar }: Props) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "1rem" }}>
      {items.map(item => (
        <div
          key={item.id}
          onClick={() => onItemClick(item.id)}
          className="group"
          style={{
            background: "var(--c-surface)",
            border: "1px solid var(--c-border-faint)",
            borderRadius: 10,
            overflow: "hidden",
            cursor: "pointer",
            transition: "border-color 150ms",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border)" }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "var(--c-border-faint)" }}
        >
          {/* Color header block */}
          <div
            style={{
              height: 72,
              background: `linear-gradient(135deg, ${domainColor(item.domain)}22 0%, ${domainColor(item.domain)}44 100%)`,
              borderBottom: `2px solid ${domainColor(item.domain)}33`,
              display: "flex",
              alignItems: "flex-end",
              padding: "0.5rem 0.75rem",
            }}
          >
            {item.domain && (
              <span className="tars-label" style={{ color: domainColor(item.domain) }}>{item.domain}</span>
            )}
          </div>

          <div style={{ padding: "0.75rem" }}>
            <h3 style={{
              fontSize: "0.8125rem",
              fontWeight: 500,
              color: "var(--c-ink)",
              lineHeight: 1.35,
              marginBottom: "0.375rem",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}>
              {item.source_title ?? "Untitled"}
            </h3>
            {item.summary && (
              <p style={{
                fontSize: "0.75rem",
                color: "var(--c-ink-faint)",
                lineHeight: 1.4,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                marginBottom: "0.5rem",
              }}>
                {item.summary}
              </p>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span className="tars-label">
                {new Date(item.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
              <button
                onClick={e => { e.stopPropagation(); onToggleStar(item.id, item.starred) }}
                style={{
                  color: "var(--c-amber)",
                  opacity: item.starred ? 1 : 0,
                  background: "none", border: "none", cursor: "pointer", padding: 0,
                  transition: "opacity 150ms",
                }}
              >
                <Star size={12} fill={item.starred ? "var(--c-amber)" : "none"} />
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
