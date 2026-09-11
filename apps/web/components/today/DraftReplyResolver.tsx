"use client"

/**
 * DraftReplyResolver — draft_reply's in-card resolution for email-sourced
 * signals (signal.source === "gmail"). Three phases in one component so
 * SignalCard doesn't need to know which one is active:
 *
 *   compose → loading → ready (or error, with a way back to compose)
 *
 * "compose" reuses ComposeStrip verbatim (same steering-note UI as every
 * other chat-handoff kind) — the difference is what Confirm does with it:
 * instead of posting to /act and opening a conversation, it posts to
 * /signals/{id}/draft and swaps to the real EmailDraftCard, right in the
 * card, once the draft comes back. Sending goes through EmailDraftCard's own
 * existing /email/confirm-send gate — this component never sends anything.
 */

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { EmailDraftCard, type EmailDraft } from "@/components/chat/EmailDraftCard"
import { ComposeStrip } from "@/components/today/ComposeStrip"
import { generateReplyDraft } from "@/lib/signals"
import type { Signal, SignalAction } from "@/lib/signals"

type Phase = "compose" | "loading" | "error"

interface DraftReplyResolverProps {
  signal: Signal
  action: SignalAction
  /** Compose step cancelled before generating anything — no side effect. */
  onCancel: () => void
  /** Fires the moment a draft is successfully generated — before onDiscard
   *  or onSent, both of which are still ahead of the user. This is when the
   *  signal actually became done server-side, so SignalCard uses it to stop
   *  the action row from being able to swap or close this panel out from
   *  under the review — see draftCommitted there. */
  onDrafted: () => void
  /** Draft was generated but discarded without sending — still fully
   *  undoable (nothing external happened), so Today treats it like any
   *  other undoable action. */
  onDiscard: () => void
  /** The draft was actually sent. Not undoable — Today should just clear it. */
  onSent: () => void
}

export function DraftReplyResolver({ signal, action, onCancel, onDrafted, onDiscard, onSent }: DraftReplyResolverProps) {
  const [phase, setPhase] = useState<Phase>("compose")
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<EmailDraft | null>(null)

  async function generate(note: string) {
    setPhase("loading")
    setError(null)
    try {
      const res = await generateReplyDraft(signal.id, note || undefined)
      setDraft(res.draft)
      onDrafted()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't draft a reply")
      setPhase("error")
    }
  }

  if (draft) {
    return (
      <div className="mt-3">
        <EmailDraftCard draft={draft} onDismiss={onDiscard} onSent={onSent} />
      </div>
    )
  }

  if (phase === "loading") {
    return (
      <div
        className="mt-3 p-3 rounded-lg flex items-center gap-2"
        style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border-faint)" }}
      >
        <Loader2 size={13} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
        <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>drafting reply…</span>
      </div>
    )
  }

  if (phase === "error") {
    return (
      <div
        className="mt-3 p-3 rounded-lg space-y-2"
        style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border-faint)" }}
      >
        <p className="text-[0.8125rem]" style={{ color: "var(--c-rose)" }}>{error}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="tars-label px-2.5 py-1.5 rounded-md transition-opacity hover:opacity-100 opacity-60"
            style={{ color: "var(--c-ink-muted)" }}
          >
            cancel
          </button>
          <button
            onClick={() => setPhase("compose")}
            className="px-3 py-1.5 rounded-md text-[0.8125rem] font-medium transition-opacity hover:opacity-85"
            style={{ backgroundColor: "var(--c-moss)", color: "var(--c-canvas)" }}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return <ComposeStrip action={action} onCancel={onCancel} onConfirm={generate} />
}
