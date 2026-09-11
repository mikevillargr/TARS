"use client"

/**
 * ComposeStrip — the intermediate step for signal actions that hand off to
 * chat: draft_reply, move_event, save_brain, discuss. Nothing here is
 * created or committed directly (that's InlineActionForm's job, for the
 * create_* kinds) — this only collects a freeform steering note before the
 * handoff, so the seeded prompt carries what Mike actually wants done
 * instead of TARS's own inference alone.
 *
 * Shares FormShell/fieldStyle with InlineActionForm so the two intermediate
 * steps read as one system, not two different UIs bolted together.
 */

import { useState } from "react"
import type { SignalAction, SignalActionKind } from "@/lib/signals"
import { FormShell, fieldStyle } from "@/components/today/InlineActionForm"

const PLACEHOLDER: Partial<Record<SignalActionKind, string>> = {
  draft_reply: 'Anything to add? e.g. "yes to Thursday, push scope to next week"',
  move_event: 'Anything to add? e.g. "propose next Tuesday afternoon instead"',
  save_brain: "Add a note (optional)",
  discuss: "What do you want to ask?",
}

interface ComposeStripProps {
  action: SignalAction
  onCancel: () => void
  onConfirm: (note: string) => void
}

export function ComposeStrip({ action, onCancel, onConfirm }: ComposeStripProps) {
  const [note, setNote] = useState("")

  return (
    <FormShell onCancel={onCancel} confirmLabel={action.label} onConfirm={() => onConfirm(note.trim())}>
      <textarea
        autoFocus
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={PLACEHOLDER[action.kind] ?? "Anything to add? (optional)"}
        rows={2}
        className="w-full text-[0.8125rem] rounded-md px-2.5 py-1.5 outline-none resize-none"
        style={fieldStyle}
      />
    </FormShell>
  )
}
