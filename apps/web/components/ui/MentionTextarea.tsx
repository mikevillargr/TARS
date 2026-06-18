"use client"

import React, { useState, useRef, useEffect, useCallback } from "react"
import { MentionDropdown } from "@/components/ui/MentionDropdown"
import type { MentionSuggestion } from "@/hooks/useMentionAutocomplete"
import { parseWireToDisplay, toWire, currentMentions, type MentionRef } from "@/lib/mentions"

interface Props {
  /** Stored wire text (may contain [[id|type|label]] markers). Source of truth. */
  value: string
  /** Emits the wire text after every edit. */
  onChange: (wire: string) => void
  /** Emits the mentions currently present in the text (for link sync). */
  onMentionsChange?: (mentions: MentionRef[]) => void
  /** Bump to force a re-parse of `value` (e.g. when a different entity is opened). */
  resetKey?: string
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  rows?: number
  disabled?: boolean
  autoFocus?: boolean
  /** Extra key handling from the parent (runs only when the dropdown isn't capturing). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  /** Auto-grow up to this many px (optional). */
  maxHeight?: number
}

/**
 * A drop-in <textarea> with universal @-mention autocomplete.
 *
 * Shows friendly `@Label` tokens while editing; persists the lossless
 * [[id|type|label]] wire format via onChange. Reuses MentionDropdown and the
 * same /api/proxy/links/search backend as the chat composer.
 */
export function MentionTextarea({
  value,
  onChange,
  onMentionsChange,
  resetKey,
  placeholder,
  className,
  style,
  rows = 3,
  disabled,
  autoFocus,
  onKeyDown,
  maxHeight,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [display, setDisplay] = useState("")
  const mapRef = useRef<Map<string, { id: string; type: string }>>(new Map())
  // Guard so our own onChange (which sends wire back as `value`) doesn't re-parse
  // and clobber the cursor mid-edit.
  const lastEmittedWire = useRef<string | null>(null)
  const prevResetKey = useRef(resetKey)

  // Parse incoming wire `value` → display + map, on mount / external change / reset.
  useEffect(() => {
    const resetChanged = resetKey !== prevResetKey.current
    if (resetChanged) prevResetKey.current = resetKey
    if (!resetChanged && value === lastEmittedWire.current) return // our own echo — skip
    const { display: d, mentions } = parseWireToDisplay(value)
    mapRef.current = new Map(mentions.map(m => [m.label, { id: m.id, type: m.type }]))
    setDisplay(d)
    lastEmittedWire.current = value
  }, [value, resetKey])

  // ── Mention dropdown state ────────────────────────────────────────────────
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<MentionSuggestion[]>([])
  const [index, setIndex] = useState(0)
  const [anchor, setAnchor] = useState<{ top: number; left: number; width: number } | null>(null)
  const triggerPos = useRef(-1)
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const emit = useCallback((nextDisplay: string) => {
    const wire = toWire(nextDisplay, mapRef.current)
    lastEmittedWire.current = wire
    onChange(wire)
    onMentionsChange?.(currentMentions(nextDisplay, mapRef.current))
  }, [onChange, onMentionsChange])

  function closeDropdown() {
    setOpen(false)
    setAnchor(null)
    setResults([])
    if (fetchTimer.current) clearTimeout(fetchTimer.current)
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const el = e.target
    const val = el.value
    setDisplay(val)
    emit(val)
    if (maxHeight) {
      el.style.height = "auto"
      el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
    }
    // Detect "@" at start-of-input or after whitespace (avoids email false-positives)
    const cursor = el.selectionStart ?? val.length
    const match = val.slice(0, cursor).match(/(^|\s)@([^\s@]*)$/)
    if (match) {
      const query = match[2]
      triggerPos.current = cursor - query.length - 1
      const rect = el.getBoundingClientRect()
      setAnchor({ top: rect.bottom + 4, left: rect.left, width: rect.width })
      setOpen(true)
      setIndex(0)
      if (fetchTimer.current) clearTimeout(fetchTimer.current)
      fetchTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/proxy/links/search?q=${encodeURIComponent(query)}`)
          if (res.ok) setResults(await res.json())
        } catch { /* silent */ }
      }, 150)
    } else {
      closeDropdown()
    }
  }

  function selectMention(item: MentionSuggestion) {
    const el = textareaRef.current
    if (!el) return
    const cursor = el.selectionStart ?? display.length
    const before = display.slice(0, triggerPos.current)
    const after = display.slice(cursor)
    const token = `@${item.title}`
    mapRef.current.set(item.title, { id: item.id, type: item.type })
    const next = before + token + " " + after
    setDisplay(next)
    emit(next)
    closeDropdown()
    requestAnimationFrame(() => {
      el.focus()
      const pos = before.length + token.length + 1
      el.setSelectionRange(pos, pos)
    })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open && results.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)); return }
      if (e.key === "ArrowUp") { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === "Enter") { e.preventDefault(); if (results[index]) selectMention(results[index]); return }
      if (e.key === "Escape") { e.preventDefault(); closeDropdown(); return }
    }
    onKeyDown?.(e)
  }

  return (
    <>
      {open && anchor && (
        <div
          style={{
            position: "fixed",
            top: anchor.top,
            left: anchor.left,
            width: anchor.width,
            zIndex: 9999,
          }}
        >
          <MentionDropdown open={open} results={results} selectedIndex={index} onSelect={selectMention} />
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={display}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={closeDropdown}
        placeholder={placeholder}
        className={className}
        style={style}
        rows={rows}
        disabled={disabled}
        autoFocus={autoFocus}
      />
    </>
  )
}
