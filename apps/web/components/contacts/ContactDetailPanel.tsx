"use client"

import { useEffect, useRef, useState } from "react"
import { Mail, Phone, MessageCircle, Calendar, ListTodo, Loader2, FileText, CheckSquare, Clock } from "lucide-react"
import { apiGet, apiPatch } from "@/lib/api-client"
import type { Contact, ContactContext } from "@tars/types"

interface Props {
  contactId: string
}

const TABS = ["Overview", "Meetings", "Tasks", "Knowledge"] as const
type Tab = typeof TABS[number]

function avatarInitials(name?: string | null) {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/)
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = ["#2d5a4f","#a16207","#7c3aed","#1d4ed8","#b45309","#be185d"]
function avatarColor(name?: string | null) {
  if (!name) return AVATAR_COLORS[0]
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
}

export function ContactDetailPanel({ contactId }: Props) {
  const [contact, setContact] = useState<Contact | null>(null)
  const [context, setContext] = useState<ContactContext | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<Tab>("Overview")
  const [notes, setNotes] = useState("")
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLoading(true)
    setContact(null)
    setContext(null)
    Promise.all([
      apiGet<Contact>(`/contacts/${contactId}`),
      apiGet<ContactContext>(`/contacts/${contactId}/context`).catch(() => null),
    ]).then(([c, ctx]) => {
      setContact(c)
      setNotes(c.tars_context ?? "")
      setContext(ctx)
    }).catch(console.error)
    .finally(() => setLoading(false))
  }, [contactId])

  function handleNotesChange(value: string) {
    setNotes(value)
    if (notesTimer.current) clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(async () => {
      try {
        const updated = await apiPatch<Contact>(`/contacts/${contactId}`, { tars_context: value })
        setContact(updated)
      } catch { /* silent */ }
    }, 1500)
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
        <Loader2 size={20} style={{ color: "var(--c-ink-faint)", animation: "spin 1s linear infinite" }} />
      </div>
    )
  }

  if (!contact) return null

  const color = avatarColor(contact.display_name)

  const actionButtons = [
    { label: "Email",    Icon: Mail,         href: contact.primary_email ? `mailto:${contact.primary_email}` : null },
    { label: "Call",     Icon: Phone,        href: contact.primary_phone ? `tel:${contact.primary_phone}` : null },
    { label: "WhatsApp", Icon: MessageCircle, href: contact.primary_phone ? `https://wa.me/${contact.primary_phone.replace(/\D/g,"")}` : null },
    { label: "Calendar", Icon: Calendar,     href: "/calendar" },
    { label: "New Task", Icon: ListTodo,     href: null },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "1.25rem 1.25rem 1rem", borderBottom: "1px solid var(--c-border-faint)", background: "var(--c-surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1rem" }}>
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            background: color, color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 600, flexShrink: 0,
            fontFamily: "var(--font-mono)",
          }}>
            {avatarInitials(contact.display_name)}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--c-ink)" }}>
              {contact.display_name ?? "Unknown"}
            </div>
            {(contact.job_title || contact.organization) && (
              <div style={{ fontSize: 12, color: "var(--c-ink-muted)", marginTop: 2 }}>
                {[contact.job_title, contact.organization].filter(Boolean).join(" · ")}
              </div>
            )}
            {contact.primary_email && (
              <div style={{ fontSize: 11, color: "var(--c-ink-faint)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                {contact.primary_email}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {actionButtons.map(({ label, Icon, href }) => {
            const El = href ? "a" : "button"
            return (
              <El
                key={label}
                href={href ?? undefined}
                target={href?.startsWith("http") ? "_blank" : undefined}
                rel={href?.startsWith("http") ? "noreferrer" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "0.375rem 0.75rem",
                  borderRadius: 6,
                  fontSize: 12,
                  background: "var(--c-canvas)",
                  border: "1px solid var(--c-border)",
                  color: href ? "var(--c-ink-muted)" : "var(--c-ink-faint)",
                  cursor: href ? "pointer" : "default",
                  textDecoration: "none",
                  opacity: href ? 1 : 0.5,
                }}
              >
                <Icon size={13} />
                {label}
              </El>
            )
          })}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--c-border-faint)", background: "var(--c-surface)", padding: "0 1rem" }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="tars-label"
            style={{
              padding: "0.625rem 0.75rem",
              color: activeTab === tab ? "var(--c-moss)" : "var(--c-ink-faint)",
              borderBottom: activeTab === tab ? "2px solid var(--c-moss)" : "2px solid transparent",
              background: "none", border: "none", cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "1rem 1.25rem" }}>
        {activeTab === "Overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            {context && (
              <div>
                <div className="tars-label" style={{ marginBottom: "0.5rem" }}>Activity</div>
                <div style={{ display: "flex", gap: "1rem" }}>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: "var(--c-ink)", fontFamily: "var(--font-mono)" }}>{context.link_count}</div>
                    <div className="tars-label">Links</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: "var(--c-ink)", fontFamily: "var(--font-mono)" }}>{context.recent_meetings.length}</div>
                    <div className="tars-label">Meetings</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 600, color: "var(--c-ink)", fontFamily: "var(--font-mono)" }}>{context.linked_tasks.length}</div>
                    <div className="tars-label">Tasks</div>
                  </div>
                </div>
              </div>
            )}
            <div>
              <div className="tars-label" style={{ marginBottom: "0.5rem" }}>Notes</div>
              <textarea
                value={notes}
                onChange={e => handleNotesChange(e.target.value)}
                placeholder="Add context about this contact…"
                rows={5}
                style={{
                  width: "100%", resize: "vertical",
                  background: "var(--c-canvas)",
                  border: "1px solid var(--c-border)",
                  borderRadius: 8, padding: "0.625rem",
                  fontSize: 13, color: "var(--c-ink)",
                  outline: "none",
                }}
              />
            </div>
          </div>
        )}

        {activeTab === "Meetings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {(context?.recent_meetings ?? []).length === 0 ? (
              <p style={{ color: "var(--c-ink-faint)", fontSize: 13 }}>No meetings found</p>
            ) : context?.recent_meetings.map(m => (
              <div key={m.id} style={{ padding: "0.5rem 0", borderBottom: "1px solid var(--c-border-faint)" }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--c-ink)" }}>{m.title}</div>
                {m.started_at && <div className="tars-label" style={{ marginTop: 2 }}>{new Date(m.started_at).toLocaleDateString()}</div>}
              </div>
            ))}
          </div>
        )}

        {activeTab === "Tasks" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {(context?.linked_tasks ?? []).length === 0 ? (
              <p style={{ color: "var(--c-ink-faint)", fontSize: 13 }}>No linked tasks</p>
            ) : context?.linked_tasks.map(t => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0", borderBottom: "1px solid var(--c-border-faint)" }}>
                <CheckSquare size={13} style={{ color: "var(--c-ink-faint)", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "var(--c-ink)", flex: 1 }}>{t.title}</span>
                <span className="tars-label">{t.status}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === "Knowledge" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {(context?.linked_knowledge ?? []).length === 0 ? (
              <p style={{ color: "var(--c-ink-faint)", fontSize: 13 }}>No linked knowledge</p>
            ) : context?.linked_knowledge.map(k => (
              <div key={k.id} style={{ display: "flex", alignItems: "center", gap: "0.625rem", padding: "0.5rem 0", borderBottom: "1px solid var(--c-border-faint)" }}>
                <FileText size={13} style={{ color: "var(--c-ink-faint)", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "var(--c-ink)", flex: 1 }}>{k.title}</span>
                <span className="tars-label">{k.type}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
