"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Mail, Phone, MessageCircle, Calendar, CheckSquare, Clock, ExternalLink, Loader2 } from "lucide-react"
import { apiGet } from "@/lib/api-client"
import type { Contact } from "@tars/types"

interface Props {
  contactId: string
  anchorRect: DOMRect
  onClose: () => void
}

function avatarInitials(name?: string | null) {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = ["#2d5a4f","#a16207","#7c3aed","#1d4ed8","#b45309","#be185d"]
function avatarColor(name?: string | null) {
  if (!name) return AVATAR_COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

const ACTIONS = [
  { label: "Email",    Icon: Mail,          href: (c: Contact) => c.primary_email ? `mailto:${c.primary_email}` : null },
  { label: "Call",     Icon: Phone,         href: (c: Contact) => c.primary_phone ? `tel:${c.primary_phone}` : null },
  { label: "WhatsApp", Icon: MessageCircle, href: (c: Contact) => c.primary_phone ? `https://wa.me/${c.primary_phone.replace(/\D/g,"")}` : null },
  { label: "Schedule", Icon: Calendar,      href: () => "/calendar" },
  { label: "Task",     Icon: CheckSquare,   href: () => null, isTask: true },
  { label: "History",  Icon: Clock,         href: (_c: Contact, id: string) => `/contacts?id=${id}` },
] as const

export function ContactPopup({ contactId, anchorRect, onClose }: Props) {
  const [contact, setContact] = useState<Contact | null>(null)
  const [loading, setLoading] = useState(true)
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    apiGet<Contact>(`/contacts/${contactId}`)
      .then(setContact)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [contactId])

  // Compute position (clamped to viewport)
  const POPUP_W = 280
  const POPUP_H = 260
  const OFFSET = 8
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200
  const vh = typeof window !== "undefined" ? window.innerHeight : 800

  let left = anchorRect.left
  let top = anchorRect.bottom + OFFSET

  if (left + POPUP_W > vw - 8) left = vw - POPUP_W - 8
  if (left < 8) left = 8
  if (top + POPUP_H > vh - 8) top = anchorRect.top - POPUP_H - OFFSET

  const color = avatarColor(contact?.display_name)

  const popup = (
    <div
      id="contact-popup-root"
      ref={popupRef}
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9999,
        width: POPUP_W,
        background: "var(--c-surface)",
        border: "1px solid var(--c-border)",
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
        overflow: "hidden",
        fontFamily: "var(--font-sans)",
      }}
    >
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80 }}>
          <Loader2 size={18} style={{ color: "var(--c-ink-faint)", animation: "spin 1s linear infinite" }} />
        </div>
      ) : contact ? (
        <>
          {/* Header */}
          <div style={{ padding: "0.875rem 1rem 0.75rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%",
              background: color, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 600, flexShrink: 0,
              fontFamily: "var(--font-mono)",
            }}>
              {avatarInitials(contact.display_name)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--c-ink)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {contact.display_name ?? "Unknown"}
              </div>
              {(contact.job_title || contact.organization) && (
                <div style={{ fontSize: 11, color: "var(--c-ink-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[contact.job_title, contact.organization].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>
            <a href={`/contacts?id=${contact.id}`} style={{ color: "var(--c-moss)", flexShrink: 0 }} onClick={onClose}>
              <ExternalLink size={13} />
            </a>
          </div>

          {/* Divider */}
          <div style={{ height: 1, background: "var(--c-border-faint)" }} />

          {/* Action grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", padding: "0.5rem" }}>
            {ACTIONS.map(({ label, Icon, href }) => {
              const url = href(contact, contact.id)
              const El = url ? "a" : "button"
              return (
                <El
                  key={label}
                  href={url ?? undefined}
                  target={url?.startsWith("http") ? "_blank" : undefined}
                  rel={url?.startsWith("http") ? "noreferrer" : undefined}
                  onClick={onClose}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                    gap: 4, padding: "0.625rem 0", borderRadius: 6, cursor: url ? "pointer" : "default",
                    background: "none", border: "none", color: url ? "var(--c-ink-muted)" : "var(--c-ink-faint)",
                    textDecoration: "none",
                    opacity: url ? 1 : 0.4,
                    transition: "background 100ms",
                  }}
                  onMouseEnter={(e: React.MouseEvent) => { if (url) (e.currentTarget as HTMLElement).style.background = "var(--c-surface-2)" }}
                  onMouseLeave={(e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = "" }}
                >
                  <Icon size={18} />
                  <span className="tars-label" style={{ fontSize: 9 }}>{label}</span>
                </El>
              )
            })}
          </div>
        </>
      ) : (
        <div style={{ padding: "1rem", color: "var(--c-ink-faint)", fontSize: 13 }}>Contact not found</div>
      )}
    </div>
  )

  if (typeof document === "undefined") return null
  return createPortal(popup, document.body)
}
