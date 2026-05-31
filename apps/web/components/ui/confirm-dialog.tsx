"use client"

import { createContext, useCallback, useContext, useRef, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"

// ─── Public API ────────────────────────────────────────────────────────────────
export interface ConfirmOptions {
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Visual style of the confirm button. "danger" tints it rose for destructive actions. */
  tone?: "danger" | "default"
}

type ConfirmFn = (opts?: ConfirmOptions) => Promise<boolean>

const ConfirmCtx = createContext<ConfirmFn | null>(null)

/**
 * useConfirm — hook that returns a function which opens the global confirm dialog
 * and resolves to true/false.
 *
 * Example:
 *   const confirm = useConfirm()
 *   if (await confirm({ title: "Delete this?", tone: "danger" })) doDelete()
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) throw new Error("useConfirm must be used inside <ConfirmProvider>")
  return ctx
}

// ─── Provider ──────────────────────────────────────────────────────────────────
interface InternalState {
  open: boolean
  opts: ConfirmOptions
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<InternalState>({ open: false, opts: {} })
  // resolver for the in-flight confirm() call
  const resolverRef = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((opts = {}) => {
    return new Promise<boolean>((resolve) => {
      // If a previous prompt is still open, resolve it as cancelled before opening a new one
      if (resolverRef.current) resolverRef.current(false)
      resolverRef.current = resolve
      setState({ open: true, opts })
    })
  }, [])

  const handle = useCallback((value: boolean) => {
    const resolve = resolverRef.current
    resolverRef.current = null
    setState((prev) => ({ ...prev, open: false }))
    resolve?.(value)
  }, [])

  const {
    title       = "Are you sure?",
    description = "This action cannot be undone.",
    confirmLabel = "Confirm",
    cancelLabel  = "Cancel",
    tone         = "default",
  } = state.opts

  const confirmBg = tone === "danger" ? "var(--c-rose)"   : "var(--c-ink)"
  const confirmFg = tone === "danger" ? "var(--c-surface)" : "var(--c-canvas)"

  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Dialog
        open={state.open}
        onOpenChange={(open) => { if (!open) handle(false) }}
      >
        <DialogContent className="max-w-sm w-[92vw]">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button
              onClick={() => handle(false)}
              className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--c-surface-2)",
                color: "var(--c-ink)",
                border: "1px solid var(--c-border)",
              }}
            >
              {cancelLabel}
            </button>
            <button
              onClick={() => handle(true)}
              autoFocus
              className="px-4 py-2 rounded-md text-sm font-medium transition-opacity hover:opacity-85"
              style={{ backgroundColor: confirmBg, color: confirmFg }}
            >
              {confirmLabel}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmCtx.Provider>
  )
}
