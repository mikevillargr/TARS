"use client"

import { useState, useEffect, useCallback, useRef, RefObject } from "react"

export interface MentionSuggestion {
  id: string
  type: "knowledge_item" | "contact" | "task"
  title: string
  subtitle?: string
}

export function useMentionAutocomplete(
  value: string,
  onChange: (value: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>
) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<MentionSuggestion[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const triggerPosRef = useRef(-1)
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Detect [[ trigger behind the cursor
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    const cursor = el.selectionStart ?? value.length
    const textBeforeCursor = value.slice(0, cursor)
    const match = textBeforeCursor.match(/\[\[([^\]\n]*)$/)
    if (match) {
      triggerPosRef.current = cursor - match[0].length
      setQuery(match[1])
      setOpen(true)
      setSelectedIndex(0)
    } else {
      setOpen(false)
    }
  }, [value, textareaRef])

  // Debounced search — empty query shows recent items
  useEffect(() => {
    if (!open) { setResults([]); return }
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    fetchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/proxy/links/search?q=${encodeURIComponent(query)}`)
        if (res.ok) setResults(await res.json())
      } catch { /* silent */ }
    }, 200)
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current) }
  }, [query, open])

  const select = useCallback((item: MentionSuggestion) => {
    const el = textareaRef.current
    if (!el) return
    const cursor = el.selectionStart ?? value.length
    const before = value.slice(0, triggerPosRef.current)
    const after = value.slice(cursor)
    const chip = `[[${item.id}|${item.type}|${item.title}]]`
    onChange(before + chip + " " + after)
    setOpen(false)
    setResults([])
    requestAnimationFrame(() => {
      el.focus()
      const pos = before.length + chip.length + 1
      el.setSelectionRange(pos, pos)
    })
  }, [value, onChange, textareaRef])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) return false
    if (results.length === 0) return false
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex(i => Math.min(i + 1, results.length - 1))
      return true
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex(i => Math.max(i - 1, 0))
      return true
    }
    if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault()
      select(results[selectedIndex])
      return true
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setOpen(false)
      return true
    }
    return false
  }, [open, results, selectedIndex, select])

  const dismiss = useCallback(() => setOpen(false), [])

  return { open, results, selectedIndex, select, handleKeyDown, dismiss }
}
