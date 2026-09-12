"use client"

/**
 * ComposeStrip — the intermediate step for signal actions that hand off to
 * chat: draft_reply, move_event, save_brain, discuss. Nothing here is
 * created or committed directly (that's InlineActionForm's job, for the
 * create_* kinds) — this only collects a freeform steering note before the
 * handoff, so the seeded prompt carries what Mike actually wants done
 * instead of TARS's own inference alone.
 *
 * The note field is a MentionTextarea (since v2.19.7) — @-mentioning a
 * contact works here the same as everywhere else in the app. What that
 * mention DOES depends on where the note ends up: for email-sourced
 * draft_reply (DraftReplyResolver's in-card path), a mentioned contact
 * becomes a real CC on the generated draft (_cc_from_mentions,
 * api/routes/signals.py) — not just prose the model might notice. For
 * every other kind, the note is handed to chat with markers stripped to
 * plain labels; TARS reads "loop in Jane Doe" but doesn't act on it as a
 * structured recipient the way the in-card path does.
 *
 * Shares FormShell/fieldStyle with InlineActionForm so the two intermediate
 * steps read as one system, not two different UIs bolted together.
 */

import { useState } from "react"
import type { SignalAction, SignalActionKind } from "@/lib/signals"
import { FormShell, fieldStyle } from "@/components/today/InlineActionForm"
import { MentionTextarea } from "@/components/ui/MentionTextarea"

const PLACEHOLDER: Partial<Record<SignalActionKind, string>> = {
  draft_reply: 'Anything you want in it? Try "yes to Thursday". @mention anyone to CC.',
  move_event: 'Anything you want said? Try "propose next Tuesday afternoon".',
  save_brain: "Why you're keeping this (optional)",
  discuss: "What do you want to ask?",
}

interface ComposeStripProps {
  action: SignalAction
  onCancel: () => void
  /** Wire-format text ([[id|type|label]] markers intact) — the harness
   *  resolves mentions from this before use; see the module doc above. */
  onConfirm: (note: string) => void
}

export function ComposeStrip({ action, onCancel, onConfirm }: ComposeStripProps) {
  const [note, setNote] = useState("")

  return (
    <FormShell onCancel={onCancel} confirmLabel={action.label} onConfirm={() => onConfirm(note.trim())}>
      <MentionTextarea
        autoFocus
        value={note}
        onChange={setNote}
        placeholder={PLACEHOLDER[action.kind] ?? "Anything you want to add? (optional)"}
        rows={2}
        className="w-full text-[0.8125rem] rounded-md px-2.5 py-1.5 outline-none resize-none"
        style={fieldStyle}
      />
    </FormShell>
  )
}
