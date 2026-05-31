"use client"

import { useCallback, useEffect, useState } from "react"
import { Mail, Phone, Calendar, MessageSquare, Check, X, Loader2, Users } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { apiGet, apiPost } from "@/lib/api-client"
import { useConfirm } from "@/components/ui/confirm-dialog"

interface PendingContact {
  id: string
  detected_name: string | null
  detected_email: string
  detected_phone: string | null
  source: "meeting" | "email" | "chat"
  source_id: string | null
  extracted_context: string | null
  status: string
  created_at: string
}

interface PendingContactsReviewProps {
  open: boolean
  onClose: () => void
  /** Called after any change so the parent can refresh its pending count badge */
  onChange?: () => void
}

const SOURCE_ICON: Record<PendingContact["source"], React.ElementType> = {
  meeting: Calendar,
  email:   Mail,
  chat:    MessageSquare,
}

const SOURCE_LABEL: Record<PendingContact["source"], string> = {
  meeting: "Meeting",
  email:   "Email",
  chat:    "Chat",
}

export function PendingContactsReview({ open, onClose, onChange }: PendingContactsReviewProps) {
  const confirm = useConfirm()
  const [pending,   setPending]   = useState<PendingContact[]>([])
  const [loading,   setLoading]   = useState(false)
  const [actingId,  setActingId]  = useState<string | null>(null)
  const [error,     setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiGet<PendingContact[]>("/contacts/pending")
      setPending(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending contacts")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  async function handleApprove(p: PendingContact) {
    const ok = await confirm({
      title: "Add to Google Contacts?",
      description: `"${p.detected_name ?? p.detected_email}" will be created in your Google Contacts.`,
      confirmLabel: "Add",
    })
    if (!ok) return
    setActingId(p.id)
    setError(null)
    try {
      await apiPost(`/contacts/pending/${p.id}/approve`)
      setPending(prev => prev.filter(x => x.id !== p.id))
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed")
    } finally {
      setActingId(null)
    }
  }

  async function handleReject(p: PendingContact) {
    setActingId(p.id)
    setError(null)
    try {
      await apiPost(`/contacts/pending/${p.id}/reject`)
      setPending(prev => prev.filter(x => x.id !== p.id))
      onChange?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed")
    } finally {
      setActingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-5 py-4 border-b" style={{ borderColor: "var(--c-border)" }}>
          <DialogTitle className="flex items-center gap-2">
            <Users size={18} style={{ color: "var(--c-moss)" }} />
            Pending contacts
          </DialogTitle>
          <DialogDescription>
            New people detected from meetings, emails, and chat. Approved entries are pushed to your Google Contacts.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
            </div>
          ) : error ? (
            <div className="rounded-md p-3 text-sm" style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}>
              {error}
            </div>
          ) : pending.length === 0 ? (
            <div className="text-center py-12 text-sm" style={{ color: "var(--c-ink-faint)" }}>
              No new people detected. As you take meetings or read emails, new contacts will appear here for review.
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {pending.map(p => {
                const Icon = SOURCE_ICON[p.source] ?? MessageSquare
                const acting = actingId === p.id
                return (
                  <li
                    key={p.id}
                    className="rounded-lg p-3 flex items-start gap-3"
                    style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-canvas)" }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                      style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}
                    >
                      <Icon size={14} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: "var(--c-ink)" }}>
                        {p.detected_name ?? p.detected_email}
                      </div>
                      <div className="text-xs mt-0.5 flex items-center gap-3 flex-wrap" style={{ color: "var(--c-ink-muted)" }}>
                        <span className="inline-flex items-center gap-1">
                          <Mail size={11} /> {p.detected_email}
                        </span>
                        {p.detected_phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone size={11} /> {p.detected_phone}
                          </span>
                        )}
                        <span style={{ color: "var(--c-ink-faint)" }}>
                          via {SOURCE_LABEL[p.source]}
                        </span>
                      </div>
                      {p.extracted_context && (
                        <div className="text-xs mt-1.5 italic" style={{ color: "var(--c-ink-faint)" }}>
                          {p.extracted_context}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleApprove(p)}
                        disabled={acting}
                        title="Add to Google Contacts"
                        className="p-1.5 rounded-md transition-colors disabled:opacity-40"
                        style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}
                      >
                        {acting ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                      </button>
                      <button
                        onClick={() => handleReject(p)}
                        disabled={acting}
                        title="Reject"
                        className="p-1.5 rounded-md transition-colors disabled:opacity-40"
                        style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
