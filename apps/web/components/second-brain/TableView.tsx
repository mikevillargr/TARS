"use client"

import { useMemo, useState } from "react"
import { ChevronUp, ChevronDown } from "lucide-react"

interface KnowledgeItem {
  id: string
  type: string
  source_title: string | null
  domain: string | null
  tags: string[]
  starred: boolean
  saved_at: string
  properties: { status?: string; type?: string; priority?: string }
}

type SortKey = "source_title" | "type" | "domain" | "status" | "priority" | "saved_at"
type SortDir = "asc" | "desc"

interface Props {
  items: KnowledgeItem[]
  onItemClick: (id: string) => void
}

const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
  raw:        { bg: "color-mix(in srgb, var(--c-amber) 15%, transparent)", color: "var(--c-amber)" },
  developing: { bg: "transparent", color: "var(--c-moss)" },
  actionable: { bg: "var(--c-moss)", color: "white" },
  archived:   { bg: "var(--c-surface-2)", color: "var(--c-ink-faint)" },
}

export function TableView({ items, onItemClick }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("saved_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("asc") }
  }

  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      let va: string, vb: string
      switch (sortKey) {
        case "source_title": va = a.source_title ?? ""; vb = b.source_title ?? ""; break
        case "type":         va = a.type ?? "";          vb = b.type ?? "";         break
        case "domain":       va = a.domain ?? "";        vb = b.domain ?? "";       break
        case "status":       va = a.properties?.status ?? ""; vb = b.properties?.status ?? ""; break
        case "priority":     va = a.properties?.priority ?? ""; vb = b.properties?.priority ?? ""; break
        case "saved_at":     va = a.saved_at; vb = b.saved_at; break
        default:             va = ""; vb = ""
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [items, sortKey, sortDir])

  function Th({ label, colKey }: { label: string; colKey: SortKey }) {
    const active = sortKey === colKey
    return (
      <th
        onClick={() => handleSort(colKey)}
        style={{
          padding: "0.5rem 0.75rem",
          textAlign: "left",
          cursor: "pointer",
          userSelect: "none",
          whiteSpace: "nowrap",
          borderBottom: "1px solid var(--c-border)",
          position: "sticky",
          top: 0,
          background: "var(--c-surface)",
          zIndex: 1,
        }}
      >
        <span className="tars-label" style={{ color: active ? "var(--c-moss)" : undefined, display: "inline-flex", alignItems: "center", gap: 4 }}>
          {label}
          {active ? (sortDir === "asc" ? <ChevronUp size={9} /> : <ChevronDown size={9} />) : null}
        </span>
      </th>
    )
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8125rem" }}>
        <thead>
          <tr>
            <Th label="Title" colKey="source_title" />
            <Th label="Type" colKey="type" />
            <Th label="Domain" colKey="domain" />
            <Th label="Status" colKey="status" />
            <Th label="Priority" colKey="priority" />
            <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", borderBottom: "1px solid var(--c-border)", position: "sticky", top: 0, background: "var(--c-surface)" }}>
              <span className="tars-label">Tags</span>
            </th>
            <Th label="Saved" colKey="saved_at" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(item => {
            const status = item.properties?.status
            const ss = status ? STATUS_STYLE[status] : null
            return (
              <tr
                key={item.id}
                onClick={() => onItemClick(item.id)}
                style={{ cursor: "pointer", borderBottom: "1px solid var(--c-border-faint)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--c-surface-2)" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "" }}
              >
                <td style={{ padding: "0.5rem 0.75rem", color: "var(--c-ink)", fontWeight: 500, maxWidth: 280 }}>
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.source_title ?? "Untitled"}
                  </span>
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span className="tars-label">{item.type}</span>
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span style={{ color: "var(--c-ink-muted)", fontSize: "0.75rem" }}>{item.domain ?? "—"}</span>
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  {ss ? (
                    <span style={{ ...ss, padding: "0.1rem 0.5rem", borderRadius: 999, fontFamily: "var(--font-mono)", fontSize: "0.65rem", fontWeight: 600, textTransform: "uppercase" }}>
                      {status}
                    </span>
                  ) : <span style={{ color: "var(--c-ink-faint)" }}>—</span>}
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span className="tars-label">{item.properties?.priority ?? "—"}</span>
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(item.tags ?? []).slice(0, 3).map(t => (
                      <span key={t} className="tars-label" style={{ background: "var(--c-surface-2)", padding: "0.1rem 0.4rem", borderRadius: 4 }}>#{t}</span>
                    ))}
                  </div>
                </td>
                <td style={{ padding: "0.5rem 0.75rem" }}>
                  <span className="tars-label">
                    {new Date(item.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
