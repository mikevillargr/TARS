"use client"

/**
 * EmailDraftCard — the send-approval gate for a generated email.
 *
 * Extracted from chat/page.tsx (v2.19.5) so /today's in-card draft resolution
 * (SignalCard → InlineDraftResolver) can render the exact same approval UI
 * instead of a second, divergent one. Self-contained: takes a draft and two
 * callbacks, calls the existing /email/confirm-send + /email/mark-sent gate
 * directly. Nothing here is chat-specific.
 */

import { useState } from "react"
import { Mail, X, Pencil, Send, Loader2 } from "lucide-react"
import { apiPost } from "@/lib/api-client"

export interface EmailDraft {
  draft_id: string
  to: string
  subject: string
  body: string
  cc?: string
  thread_id?: string
  account?: "work" | "personal"
}

export function EmailDraftCard({
  draft,
  onDismiss,
  onSent,
  initialSent = false,
}: {
  draft: EmailDraft
  onDismiss: () => void
  /** Fires once the send actually succeeds — distinct from onDismiss (which
   *  chat uses for "remove this card" and Today uses for "discard without
   *  sending"). Optional: chat's usage doesn't need it. */
  onSent?: () => void
  initialSent?: boolean
}) {
  const [sending, setSending]   = useState(false)
  const [sent, setSent]         = useState(initialSent)
  const [error, setError]       = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [editTo, setEditTo]         = useState(draft.to)
  const [editCc, setEditCc]         = useState(draft.cc ?? "")
  const [editSubject, setEditSubject] = useState(draft.subject)
  const [editBody, setEditBody]     = useState(draft.body)
  const [editAccount, setEditAccount] = useState<"work" | "personal">(draft.account ?? "work")

  async function confirmSend() {
    setSending(true)
    setError(null)
    try {
      await apiPost("/email/confirm-send", {
        to:        editTo,
        subject:   editSubject,
        body:      editBody,
        cc:        editCc || null,
        thread_id: draft.thread_id ?? null,
        account:   editAccount,
      })
      setSent(true)
      onSent?.()
      if (draft.draft_id) {
        apiPost("/email/mark-sent", { draft_id: draft.draft_id }).catch(() => {})
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed")
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <div className="rounded-xl max-w-lg overflow-hidden" style={{ border: "1px solid color-mix(in srgb, var(--c-moss) 30%, transparent)", backgroundColor: "var(--c-canvas)" }}>
        <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid color-mix(in srgb, var(--c-moss) 20%, transparent)", backgroundColor: "var(--c-moss-soft)" }}>
          <Mail size={12} style={{ color: "var(--c-moss)", flexShrink: 0 }} />
          <span className="text-xs font-semibold" style={{ color: "var(--c-moss)" }}>Sent</span>
          {editAccount === "personal" && (
            <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>PERSONAL</span>
          )}
          <button onClick={onDismiss} className="ml-auto" style={{ color: "var(--c-ink-faint)" }}><X size={11} /></button>
        </div>
        <div className="px-3 py-2.5 space-y-1.5 text-xs" style={{ color: "var(--c-ink)" }}>
          <div className="flex gap-2 items-start">
            <span className="w-12 shrink-0 font-medium pt-0.5" style={{ color: "var(--c-ink-faint)" }}>To</span>
            <span className="break-all">{editTo}</span>
          </div>
          {editCc && (
            <div className="flex gap-2 items-start">
              <span className="w-12 shrink-0 font-medium pt-0.5" style={{ color: "var(--c-ink-faint)" }}>CC</span>
              <span className="break-all">{editCc}</span>
            </div>
          )}
          <div className="flex gap-2 items-start">
            <span className="w-12 shrink-0 font-medium pt-0.5" style={{ color: "var(--c-ink-faint)" }}>Subject</span>
            <span className="font-medium">{editSubject}</span>
          </div>
          <div className="flex gap-2 items-start pt-1" style={{ borderTop: "1px solid var(--c-border-faint)" }}>
            <span className="w-12 shrink-0 font-medium pt-0.5" style={{ color: "var(--c-ink-faint)" }}>Body</span>
            <span className="whitespace-pre-wrap leading-relaxed" style={{ color: "var(--c-ink-muted)" }}>
              {expanded ? editBody : (editBody.length > 200 ? editBody.slice(0, 200).trimEnd() + "…" : editBody)}
            </span>
          </div>
          {editBody.length > 200 && (
            <button onClick={() => setExpanded(e => !e)} className="text-xs ml-14" style={{ color: "var(--c-moss)" }}>
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      </div>
    )
  }

  const bodyPreview = editBody.length > 160 && !expanded
    ? editBody.slice(0, 160).trimEnd() + "…"
    : editBody

  return (
    <div className="rounded-xl max-w-lg overflow-hidden" style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-canvas)" }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid var(--c-border-faint)", backgroundColor: "var(--c-surface)" }}>
        <Mail size={12} style={{ color: "var(--c-amber)", flexShrink: 0 }} />
        <span className="text-xs font-semibold" style={{ color: "var(--c-amber)" }}>Draft — waiting for approval</span>
        <button
          onClick={() => setEditAccount(a => (a === "personal" ? "work" : "personal"))}
          title="Switch which Gmail account this sends from"
          className="tars-label"
          style={{
            color: editAccount === "personal" ? "var(--c-moss)" : "var(--c-ink-faint)",
            border: "1px solid var(--c-border-faint)",
            borderRadius: "4px",
            padding: "1px 5px",
          }}
        >
          {editAccount === "personal" ? "PERSONAL" : "WORK"}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setEditing(e => !e)}
            title={editing ? "Done editing" : "Edit draft"}
            style={{ color: editing ? "var(--c-moss)" : "var(--c-ink-faint)" }}
          >
            <Pencil size={11} />
          </button>
          <button onClick={onDismiss} style={{ color: "var(--c-ink-faint)" }}><X size={11} /></button>
        </div>
      </div>

      {/* Fields */}
      <div className="px-3 py-2.5 space-y-1.5 text-xs" style={{ color: "var(--c-ink)" }}>
        <div className="flex gap-2 items-start">
          <span className="w-12 shrink-0 font-medium pt-0.5" style={{ color: "var(--c-ink-faint)" }}>To</span>
          {editing ? (
            <input
              value={editTo}
              onChange={e => setEditTo(e.target.value)}
              className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-xs"
              style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)", color: "var(--c-ink)", outline: "none" }}
            />
          ) : (
            <span className="break-all">{editTo}</span>
          )}
        </div>
        <div className="flex gap-2 items-start">
          <span className="w-12 shrink-0 font-medium pt-0.5" style={{ color: "var(--c-ink-faint)" }}>CC</span>
          {editing ? (
            <input
              value={editCc}
              onChange={e => setEditCc(e.target.value)}
              placeholder="optional"
              className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-xs"
              style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)", color: "var(--c-ink)", outline: "none" }}
            />
          ) : (
            editCc ? <span className="break-all">{editCc}</span> : <span style={{ color: "var(--c-ink-faint)" }}>—</span>
          )}
        </div>
        <div className="flex gap-2 items-start">
          <span className="w-12 shrink-0 font-medium pt-0.5" style={{ color: "var(--c-ink-faint)" }}>Subject</span>
          {editing ? (
            <input
              value={editSubject}
              onChange={e => setEditSubject(e.target.value)}
              className="flex-1 min-w-0 rounded px-1.5 py-0.5 text-xs font-medium"
              style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)", color: "var(--c-ink)", outline: "none" }}
            />
          ) : (
            <span className="font-medium">{editSubject}</span>
          )}
        </div>
        <div className="flex gap-2 items-start">
          <span className="w-12 shrink-0 font-medium pt-0.5" style={{ color: "var(--c-ink-faint)" }}>Body</span>
          <div className="flex-1 min-w-0">
            {editing ? (
              <textarea
                value={editBody}
                onChange={e => setEditBody(e.target.value)}
                rows={8}
                className="w-full rounded px-1.5 py-1 text-xs leading-relaxed resize-y"
                style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border)", color: "var(--c-ink)", outline: "none" }}
              />
            ) : (
              <>
                <p className="whitespace-pre-wrap leading-relaxed" style={{ color: "var(--c-ink-muted)" }}>{bodyPreview}</p>
                {editBody.length > 160 && (
                  <button
                    onClick={() => setExpanded(e => !e)}
                    className="text-[10px] mt-1"
                    style={{ color: "var(--c-moss)" }}
                  >
                    {expanded ? "Show less" : "Show full body"}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      {error && (
        <p className="px-3 pb-2 text-[11px]" style={{ color: "var(--c-rose)" }}>{error}</p>
      )}
      <div className="flex items-center gap-2 px-3 py-2" style={{ borderTop: "1px solid var(--c-border-faint)" }}>
        <button
          onClick={confirmSend}
          disabled={sending}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold disabled:opacity-50"
          style={{ backgroundColor: "var(--c-moss)", color: "#fff" }}
        >
          {sending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
          {sending ? "Sending…" : "Send"}
        </button>
        <button
          onClick={onDismiss}
          disabled={sending}
          className="px-3 py-1 rounded-lg text-xs font-medium disabled:opacity-50"
          style={{ color: "var(--c-ink-muted)", backgroundColor: "var(--c-surface-2)" }}
        >
          Discard
        </button>
      </div>
    </div>
  )
}
