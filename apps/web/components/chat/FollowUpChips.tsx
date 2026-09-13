"use client"

import { useState } from "react"
import { Check, ChevronRight, Loader2 } from "lucide-react"

export interface Suggestion {
  kind: "action" | "ask"
  label: string
  /** action only */
  tool?: string
  value?: string
  field?: string
}

/**
 * What to do next, not what to ask next.
 *
 * These used to be three generated questions whose only behaviour was typing
 * themselves into the composer — so even a good one cost a full model round
 * trip to do something a button could do. An action chip now carries a tool and
 * a prefilled value and writes directly.
 *
 * Every action still expands an editable confirm first, the same intermediate
 * step Today's InlineActionForm uses. A suggestion is a guess about intent; a
 * one-click write on a guess is how you end up with a To-Do you did not mean.
 */
export function FollowUpChips({
  suggestions,
  onAsk,
}: {
  suggestions: (Suggestion | string)[]
  onAsk: (q: string) => void
}) {
  // Older messages persisted plain strings before chips carried actions.
  const items: Suggestion[] = (suggestions ?? []).map(s =>
    typeof s === "string" ? { kind: "ask", label: s } : s,
  )

  const [openIdx, setOpenIdx] = useState<number | null>(null)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Record<number, string>>({})

  if (items.length === 0) return null

  const open = (i: number, s: Suggestion) => {
    setOpenIdx(i)
    setDraft(s.value ?? "")
  }

  const confirm = async (i: number, s: Suggestion) => {
    if (!draft.trim()) return
    setBusy(true)
    try {
      const res = await fetch("/api/proxy/chat/chip-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: s.tool, value: draft }),
      })
      const data = await res.json().catch(() => ({}))
      setDone(d => ({ ...d, [i]: res.ok ? (data.message ?? "Done.") : (data.detail ?? "Failed.") }))
      setOpenIdx(null)
    } catch {
      setDone(d => ({ ...d, [i]: "Failed." }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto pl-0 sm:pl-11 flex flex-col gap-1.5 mt-1">
      {items.map((s, i) => {
        if (done[i]) {
          return (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2 rounded-lg"
              style={{ background: "var(--c-moss-soft)", fontSize: 12, color: "var(--c-moss)" }}
            >
              <Check size={12} />
              <span>{done[i]}</span>
            </div>
          )
        }

        const isAction = s.kind === "action" && s.tool
        const expanded = openIdx === i

        if (expanded && isAction) {
          return (
            <div
              key={i}
              className="flex flex-col gap-2 px-3 py-2.5 rounded-lg"
              style={{ background: "var(--c-surface)", border: "1px solid var(--c-moss)" }}
            >
              <span className="tars-label" style={{ color: "var(--c-moss)" }}>{s.label}</span>
              {/* Editable, because the suggestion is a guess and the wording is
                  yours to fix before it lands anywhere. */}
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                rows={Math.min(5, Math.max(1, Math.ceil(draft.length / 60)))}
                autoFocus
                className="w-full bg-transparent outline-none resize-none"
                style={{ fontSize: 13, color: "var(--c-ink)" }}
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={() => confirm(i, s)}
                  disabled={busy || !draft.trim()}
                  className="tars-label px-2.5 py-1.5 rounded-md"
                  style={{ background: "var(--c-moss)", color: "var(--c-canvas)", opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? <Loader2 size={11} className="animate-spin" /> : "CONFIRM"}
                </button>
                <button
                  onClick={() => setOpenIdx(null)}
                  className="tars-label px-2.5 py-1.5 rounded-md"
                  style={{ color: "var(--c-ink-faint)" }}
                >
                  CANCEL
                </button>
              </div>
            </div>
          )
        }

        return (
          <button
            key={i}
            onClick={() => (isAction ? open(i, s) : onAsk(s.label))}
            className="follow-up-chip flex items-center justify-between gap-2 text-left px-3 py-2 rounded-lg"
            style={{
              background: "var(--c-surface)",
              border: `1px solid ${isAction ? "var(--c-border)" : "var(--c-border-faint)"}`,
              fontSize: 12,
              color: isAction ? "var(--c-ink)" : "var(--c-ink-muted)",
              cursor: "pointer",
              transition: "border-color 150ms, color 150ms",
              animation: "tars-chip-in 240ms var(--ease-out-quart) both",
              animationDelay: `${i * 55}ms`,
            }}
          >
            <span>{s.label}</span>
            <ChevronRight
              size={12}
              style={{ color: "var(--c-moss)", flexShrink: 0, opacity: isAction ? 0.9 : 0.6 }}
            />
          </button>
        )
      })}
    </div>
  )
}
