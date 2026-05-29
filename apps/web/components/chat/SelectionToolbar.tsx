"use client"

/**
 * SelectionToolbar — floating action bar on text selection inside chat messages.
 *
 * Mounts once in the chat page. Listens for mouseup globally, checks if the
 * selection is inside a [data-message-content] element, then shows a pill of
 * contextual actions above the selection.
 *
 * Actions shown:
 *   - Copy         always
 *   - Task         always (selected text → task title)
 *   - Second Brain always
 *   - Calendar     when selection contains calendar keywords
 */

import { useEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { Copy, Check, CheckSquare, BookOpen, Calendar, Loader2 } from "lucide-react"
import { apiPost } from "@/lib/api-client"

// ─── Calendar keyword detection (lightweight, no import from contentAnalysis) ─

const CAL_RE = /\b(meeting|call|appointment|lunch|dinner|event|sync|standup|interview|demo|webinar|catch.?up|check.?in|tomorrow|monday|tuesday|wednesday|thursday|friday|next week|this week)\b/i

// ─── Toolbar position ─────────────────────────────────────────────────────────

interface Pos { x: number; y: number }

function getSelectionPos(range: Range): Pos {
  const rect = range.getBoundingClientRect()
  return {
    x: rect.left + rect.width / 2 + window.scrollX,
    y: rect.top + window.scrollY - 8, // 8px gap above selection
  }
}

// ─── Individual action button ─────────────────────────────────────────────────

function Action({
  icon: Icon,
  label,
  onClick,
  accent,
}: {
  icon: React.ElementType
  label: string
  onClick: () => Promise<void>
  accent?: boolean
}) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle")

  const handle = async () => {
    if (state !== "idle") return
    setState("loading")
    try {
      await onClick()
      setState("done")
    } catch {
      setState("idle")
    }
  }

  return (
    <button
      onMouseDown={(e) => e.preventDefault()} // don't collapse selection
      onClick={handle}
      disabled={state === "loading"}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all"
      style={{
        color: state === "done"
          ? "#4ade80"
          : accent
            ? "#a7f3d0"
            : "#e5e0d8",
        opacity: state === "loading" ? 0.6 : 1,
      }}
    >
      {state === "loading" ? (
        <Loader2 size={11} className="animate-spin" />
      ) : state === "done" ? (
        <Check size={11} />
      ) : (
        <Icon size={11} />
      )}
      {state === "done" ? "Done" : label}
    </button>
  )
}

// ─── Toolbar pill ─────────────────────────────────────────────────────────────

function Toolbar({
  text,
  pos,
  onDismiss,
}: {
  text: string
  pos: Pos
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const hasCalendar = CAL_RE.test(text)

  // Keep within viewport horizontally
  useEffect(() => {
    if (!ref.current) return
    const el = ref.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    if (rect.right > vw - 12) {
      el.style.transform = `translateX(${vw - 12 - rect.right}px)`
    }
    if (rect.left < 12) {
      el.style.transform = `translateX(${12 - rect.left}px)`
    }
  }, [pos])

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setTimeout(onDismiss, 800)
  }, [text, onDismiss])

  const createTask = useCallback(async () => {
    const title = text.length > 120 ? text.slice(0, 117) + "…" : text
    await apiPost("/tasks", { title, priority: "normal", source: "chat" })
    setTimeout(onDismiss, 800)
  }, [text, onDismiss])

  const saveKnowledge = useCallback(async () => {
    await apiPost("/second-brain/ingest/text", {
      content: text,
      title: text.split(/\s+/).slice(0, 8).join(" "),
      tags: ["chat", "highlight"],
      domain: "work",
    })
    setTimeout(onDismiss, 800)
  }, [text, onDismiss])

  const addToCalendar = useCallback(async () => {
    // Just create a task with calendar intent for now — calendar chip needs date/time
    await apiPost("/tasks", {
      title: text.length > 120 ? text.slice(0, 117) + "…" : text,
      priority: "normal",
      source: "chat",
    })
    setTimeout(onDismiss, 800)
  }, [text, onDismiss])

  return createPortal(
    <div
      ref={ref}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "absolute",
        left: pos.x,
        top: pos.y,
        transform: "translate(-50%, -100%)",
        zIndex: 9999,
      }}
    >
      <div
        className="flex items-center rounded-xl shadow-xl"
        style={{
          backgroundColor: "#1a1a1a",
          border: "1px solid #2a2a2a",
          padding: "3px 4px",
          gap: "1px",
        }}
      >
        {/* Copy */}
        <Action icon={Copy} label="Copy" onClick={copy} />

        {/* Divider */}
        <div style={{ width: 1, height: 16, backgroundColor: "#333", margin: "0 2px" }} />

        {/* Task */}
        <Action icon={CheckSquare} label="Task" onClick={createTask} />

        {/* Second Brain */}
        <Action icon={BookOpen} label="Second Brain" onClick={saveKnowledge} />

        {/* Calendar — only when relevant */}
        {hasCalendar && (
          <Action icon={Calendar} label="Calendar" onClick={addToCalendar} accent />
        )}
      </div>

      {/* Arrow */}
      <div
        style={{
          position: "absolute",
          bottom: -5,
          left: "50%",
          transform: "translateX(-50%)",
          width: 0,
          height: 0,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "5px solid #2a2a2a",
        }}
      />
    </div>,
    document.body
  )
}

// ─── Main hook / mount component ─────────────────────────────────────────────

export function SelectionToolbar() {
  const [selection, setSelection] = useState<{ text: string; pos: Pos } | null>(null)
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dismiss = useCallback(() => setSelection(null), [])

  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      // Small delay so selection is finalized
      setTimeout(() => {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed || !sel.toString().trim()) {
          return
        }

        const text = sel.toString().trim()
        if (text.length < 2) return

        // Only trigger inside [data-message-content]
        const range = sel.getRangeAt(0)
        const container = range.commonAncestorContainer
        const el = container.nodeType === 1
          ? (container as Element)
          : container.parentElement

        if (!el?.closest("[data-message-content]")) return

        const pos = getSelectionPos(range)
        setSelection({ text, pos })
      }, 10)
    }

    function onMouseDown(e: MouseEvent) {
      // Dismiss if clicking outside the toolbar
      const target = e.target as Element
      if (!target.closest("[data-selection-toolbar]")) {
        dismiss()
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss()
    }

    function onScroll() {
      dismiss()
    }

    document.addEventListener("mouseup", onMouseUp)
    document.addEventListener("mousedown", onMouseDown)
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("scroll", onScroll, { capture: true })

    return () => {
      document.removeEventListener("mouseup", onMouseUp)
      document.removeEventListener("mousedown", onMouseDown)
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("scroll", onScroll, { capture: true })
    }
  }, [dismiss])

  if (!selection) return null

  return (
    <div data-selection-toolbar>
      <Toolbar text={selection.text} pos={selection.pos} onDismiss={dismiss} />
    </div>
  )
}
