"use client"

import type { Contact } from "@tars/types"

interface Props {
  contacts: Contact[]
  selectedId: string | null
  onSelect: (id: string) => void
}

function avatarInitials(name?: string | null) {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const COLORS = ["#2d5a4f","#a16207","#7c3aed","#1d4ed8","#b45309","#be185d"]
function avatarColor(name?: string | null) {
  if (!name) return COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

export function ContactList({ contacts, selectedId, onSelect }: Props) {
  if (contacts.length === 0) {
    return (
      <div style={{ padding: "2rem", textAlign: "center", color: "var(--c-ink-faint)", fontSize: 13 }}>
        No contacts
      </div>
    )
  }

  return (
    <div>
      {contacts.map(c => {
        const isSelected = c.id === selectedId
        const color = avatarColor(c.display_name)
        const subtitle = [c.job_title, c.organization].filter(Boolean).join(" · ")
        return (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              width: "100%",
              padding: "0.625rem 1rem",
              background: isSelected ? "var(--c-surface-2)" : "transparent",
              border: "none",
              borderLeft: isSelected ? "2px solid var(--c-moss)" : "2px solid transparent",
              cursor: "pointer",
              textAlign: "left",
              transition: "background 100ms",
            }}
            onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "var(--c-surface)" }}
            onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "transparent" }}
          >
            {/* Avatar */}
            <div style={{
              width: 32, height: 32, borderRadius: "50%",
              background: color, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 600, flexShrink: 0,
              fontFamily: "var(--font-mono)",
            }}>
              {avatarInitials(c.display_name)}
            </div>

            {/* Name + subtitle */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.display_name ?? c.primary_email ?? "Unknown"}
              </div>
              {subtitle && (
                <div style={{ fontSize: 11, color: "var(--c-ink-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {subtitle}
                </div>
              )}
            </div>

            {/* Email chip */}
            {c.primary_email && (
              <span className="tars-label" style={{ background: "var(--c-surface-2)", padding: "0.1rem 0.4rem", borderRadius: 4, flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.primary_email}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
