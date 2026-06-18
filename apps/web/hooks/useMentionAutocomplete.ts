"use client"

import { useState, useEffect, useCallback, useRef, RefObject } from "react"

export interface MentionSuggestion {
  id: string
  type: "knowledge_item" | "contact" | "task"
  title: string
  subtitle?: string
}

export interface MentionAnchor {
  top: number
  left: number
  width: number
}

export function useMentionAutocomplete(
  onChange: (value: string) => void,
  textareaRef: RefObject<HTMLTextAreaElement | null>
) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<MentionSuggestion[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [anchor, setAnchor] = useState<MentionAnchor | null>(null)
  const triggerPosRef = useRef(-1)
  const valueRef = useRef("")
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Called synchronously from the textarea's onChange — cursor position is correct here
  const onInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target
    const val = el.value
    valueRef.current = val
    const cursor = el.selectionStart ?? val.length
    const textBeforeCursor = val.slice(0, cursor)
    const match = textBeforeCursor.match(/\[\[([^\]\n]*)$/)
    if (match) {
      const newQuery = match[1]
      triggerPosRef.current = cursor - match[0].length
      const rect = el.getBoundingClientRect()
      setAnchor({ top: rect.top, left: rect.left, width: rect.width })
      setQuery(newQuery)
      setOpen(true)
      setSelectedIndex(0)
    } else {
      setOpen(false)
      setAnchor(null)
    }
  }, [])

  // Fetch suggestions when query/open changes
  useEffect(() => {
    if (!open) { setResults([]); return }
    if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current)
    fetchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/proxy/links/search?q=${encodeURIComponent(query)}`)
        if (res.ok) {
          const data = await res.json()
          setResults(data)
        }
      } catch { /* silent */ }
    }, 150)
    return () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current) }
  }, [query, open])

  const select = useCallback((item: MentionSuggestion) => {
    const el = textareaRef.current
    if (!el) return
    const val = valueRef.current
    const cursor = el.selectionStart ?? val.length
    const before = val.slice(0, triggerPosRef.current)
    const after = val.slice(cursor)
    const chip = `[[${item.id}|${item.type}|${item.title}]]`
    const newVal = before + chip + " " + after
    valueRef.current = newVal
    onChange(newVal)
    setOpen(false)
    setResults([])
    setAnchor(null)
    requestAnimationFrame(() => {
      el.focus()
      const pos = before.length + chip.length + 1
      el.setSelectionRange(pos, pos)
    })
  }, [onChange, textareaRef])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || results.length === 0) return false
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

  const dismiss = useCallback(() => { setOpen(false); setAnchor(null) }, [])

  return { open, results, selectedIndex, select, handleKeyDown, dismiss, anchor, onInput }
}
