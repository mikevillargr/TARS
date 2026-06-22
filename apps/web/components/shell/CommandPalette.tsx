"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Search, X, Loader2,
  CheckSquare, FileText, Video, MessageSquare, BookOpen,
  Plus, Globe, ArrowRight, Brain, CalendarDays, Zap,
  LayoutDashboard, ChevronRight, ClipboardList,
} from "lucide-react"

// ── Types ────────────────────────────────────────────────────────────────────

interface SearchResult {
  id: string
  type: "task" | "artifact" | "meeting" | "conversation" | "knowledge"
  title: string
  subtitle?: string | null
  href: string
  meta?: string | null
}

interface SearchResponse {
  query: string
  tasks: SearchResult[]
  artifacts: SearchResult[]
  meetings: SearchResult[]
  conversations: SearchResult[]
  knowledge: SearchResult[]
}

interface FlatItem {
  key: string
  section: string
  result: SearchResult
  isAction?: boolean
}

// ── Static quick-action navigation links ────────────────────────────────────

const NAV_SHORTCUTS = [
  { id: "nav-chat",        title: "Go to Chat",         href: "/chat",         icon: MessageSquare },
  { id: "nav-tasks",       title: "Go to Projects",     href: "/tasks",        icon: CheckSquare },
  { id: "nav-reminders",  title: "Go to To-Dos",      href: "/reminders",   icon: ClipboardList },
  { id: "nav-brain",       title: "Go to Second Brain", href: "/second-brain", icon: Brain },
  { id: "nav-calendar",    title: "Go to Calendar",     href: "/calendar",     icon: CalendarDays },
  { id: "nav-meetings",    title: "Go to Meetings",     href: "/meetings",     icon: Video },
  { id: "nav-artifacts",   title: "Go to Artifacts",    href: "/artifacts",    icon: FileText },
  { id: "nav-agent-jobs",  title: "Go to Agent Jobs",   href: "/agent-jobs",   icon: Zap },
]

// ── Icon helpers ─────────────────────────────────────────────────────────────

function ResultIcon({ type, meta }: { type: string; meta?: string | null }) {
  const cls = "shrink-0"
  if (type === "task")         return <CheckSquare  size={15} className={cls} style={{ color: "var(--c-moss)" }} />
  if (type === "artifact")     return <FileText     size={15} className={cls} style={{ color: "#b45309" }} />
  if (type === "meeting")      return <Video        size={15} className={cls} style={{ color: "#7c3aed" }} />
  if (type === "conversation") return <MessageSquare size={15} className={cls} style={{ color: "var(--c-ink-muted)" }} />
  if (type === "knowledge")    return <BookOpen     size={15} className={cls} style={{ color: "#0369a1" }} />
  return <LayoutDashboard size={15} className={cls} style={{ color: "var(--c-ink-faint)" }} />
}

function MetaBadge({ meta }: { meta?: string | null }) {
  if (!meta) return null
  const colors: Record<string, string> = {
    inbox:      "#d97706",
    todo:       "#2563eb",
    in_progress:"#7c3aed",
    done:       "#2d5a4f",
    url:        "#0369a1",
    note:       "#6b6357",
    document:   "#b45309",
    ready:      "#2d5a4f",
    processing: "#d97706",
  }
  const color = colors[meta] ?? "var(--c-ink-faint)"
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0"
      style={{ backgroundColor: `${color}18`, color }}
    >
      {meta.replace("_", " ")}
    </span>
  )
}

// ── Highlight matching text ───────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark
        style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)", borderRadius: "2px", padding: "0 1px" }}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // ── Fetch search results ─────────────────────────────────────────────────

  const fetchResults = useCallback(async (q: string) => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setLoading(true)
    try {
      const res = await fetch(
        `/api/proxy/search?q=${encodeURIComponent(q)}&limit=4`,
        { signal: ctrl.signal }
      )
      if (!res.ok) return
      const data: SearchResponse = await res.json()
      setResults(data)
      setActiveIndex(0)
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  // Debounced query → fetch
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchResults(query), 280)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, open, fetchResults])

  // Focus input & reset state when opening
  useEffect(() => {
    if (open) {
      setQuery("")
      setResults(null)
      setActiveIndex(0)
      setTimeout(() => inputRef.current?.focus(), 30)
      fetchResults("")  // load suggestions immediately
    }
  }, [open, fetchResults])

  // ── Build flat item list ─────────────────────────────────────────────────

  const flatItems: FlatItem[] = []

  // Quick actions section
  if (query.trim()) {
    // "Ask TARS" first when there's a query
    flatItems.push({
      key: "ask-tars",
      section: "action",
      isAction: true,
      result: {
        id: "ask-tars",
        type: "conversation",
        title: `Ask TARS: "${query}"`,
        subtitle: "Start a new conversation",
        href: `/chat?ask=${encodeURIComponent(query)}`,
        meta: null,
      },
    })
    // Matching nav shortcuts
    const ql = query.toLowerCase()
    NAV_SHORTCUTS.filter(n => n.title.toLowerCase().includes(ql)).forEach(n => {
      flatItems.push({
        key: n.id,
        section: "action",
        isAction: true,
        result: { id: n.id, type: "conversation", title: n.title, href: n.href, meta: null },
      })
    })
  } else {
    // All nav shortcuts when empty
    NAV_SHORTCUTS.forEach(n => {
      flatItems.push({
        key: n.id,
        section: "action",
        isAction: true,
        result: { id: n.id, type: "conversation", title: n.title, href: n.href, meta: null },
      })
    })
  }

  // Results sections
  const sections: Array<{ key: string; label: string; items: SearchResult[] }> = [
    { key: "tasks",         label: "Tasks",        items: results?.tasks        ?? [] },
    { key: "knowledge",     label: "Second Brain",  items: results?.knowledge    ?? [] },
    { key: "artifacts",     label: "Artifacts",     items: results?.artifacts    ?? [] },
    { key: "meetings",      label: "Meetings",      items: results?.meetings     ?? [] },
    { key: "conversations", label: "Chats",         items: results?.conversations ?? [] },
  ]

  sections.forEach(sec => {
    sec.items.forEach(item => {
      flatItems.push({ key: `${sec.key}-${item.id}`, section: sec.key, result: item })
    })
  })

  // ── Keyboard navigation ──────────────────────────────────────────────────

  const navigate = useCallback((item: FlatItem) => {
    router.push(item.result.href)
    onClose()
  }, [router, onClose])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex(i => Math.min(i + 1, flatItems.length - 1))
      }
      if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex(i => Math.max(i - 1, 0))
      }
      if (e.key === "Enter") {
        e.preventDefault()
        const item = flatItems[activeIndex]
        if (item) navigate(item)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [open, flatItems, activeIndex, navigate, onClose])

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  if (!open) return null

  // ── Render ────────────────────────────────────────────────────────────────

  const hasResults =
    (results?.tasks.length ?? 0) +
    (results?.artifacts.length ?? 0) +
    (results?.meetings.length ?? 0) +
    (results?.conversations.length ?? 0) +
    (results?.knowledge.length ?? 0) > 0

  let flatIdx = -1 // running counter for data-idx assignment

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50"
        style={{ backgroundColor: "rgba(15,13,10,0.55)", backdropFilter: "blur(3px)" }}
        onClick={onClose}
      />

      {/* Palette */}
      <div
        className="fixed z-50 left-1/2 top-[10vh] -translate-x-1/2 w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          backgroundColor: "var(--c-surface)",
          border: "1px solid var(--c-border)",
          maxHeight: "75vh",
        }}
      >
        {/* ── Search input ── */}
        <div
          className="flex items-center gap-3 px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--c-border)" }}
        >
          {loading
            ? <Loader2 size={18} className="shrink-0 animate-spin" style={{ color: "var(--c-ink-faint)" }} />
            : <Search size={18} className="shrink-0" style={{ color: "var(--c-ink-faint)" }} />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Ask TARS or search…"
            className="flex-1 bg-transparent text-sm outline-none"
            style={{ color: "var(--c-ink)" }}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="shrink-0 p-1 rounded"
              style={{ color: "var(--c-ink-faint)" }}
            >
              <X size={14} />
            </button>
          )}
          <kbd
            className="hidden sm:inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-faint)", border: "1px solid var(--c-border)" }}
          >
            esc
          </kbd>
        </div>

        {/* ── Results list ── */}
        <div ref={listRef} className="flex-1 overflow-y-auto py-1.5">

          {/* Quick actions */}
          <div className="mb-0.5">
            <div
              className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: "var(--c-ink-faint)" }}
            >
              {query ? "Actions" : "Quick navigate"}
            </div>
            {flatItems
              .filter(i => i.section === "action")
              .map((item) => {
                flatIdx++
                const idx = flatIdx
                const isActive = activeIndex === idx
                const NavIcon = query.trim()
                  ? (item.key === "ask-tars" ? MessageSquare : (NAV_SHORTCUTS.find(n => n.id === item.key)?.icon ?? ArrowRight))
                  : (NAV_SHORTCUTS.find(n => n.id === item.key)?.icon ?? ArrowRight)
                return (
                  <button
                    key={item.key}
                    data-idx={idx}
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
                    style={{
                      backgroundColor: isActive ? "var(--c-surface-2)" : "transparent",
                      color: item.key === "ask-tars" ? "var(--c-moss)" : "var(--c-ink)",
                    }}
                  >
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                      style={{ backgroundColor: item.key === "ask-tars" ? "var(--c-moss-soft)" : "var(--c-surface-2)" }}
                    >
                      {item.key === "ask-tars"
                        ? <Zap size={13} style={{ color: "var(--c-moss)" }} />
                        : <NavIcon size={13} style={{ color: "var(--c-ink-muted)" }} />
                      }
                    </span>
                    <span className="text-sm font-medium truncate flex-1">{item.result.title}</span>
                    {item.result.subtitle && (
                      <span className="text-xs hidden sm:block" style={{ color: "var(--c-ink-faint)" }}>
                        {item.result.subtitle}
                      </span>
                    )}
                    {isActive && <ChevronRight size={14} style={{ color: "var(--c-ink-faint)" }} className="shrink-0" />}
                  </button>
                )
              })}
          </div>

          {/* Result sections */}
          {sections.map(sec => {
            if (sec.items.length === 0) return null
            return (
              <div key={sec.key} className="mt-1">
                <div
                  className="px-4 py-1 text-[10px] font-semibold uppercase tracking-widest"
                  style={{ color: "var(--c-ink-faint)" }}
                >
                  {sec.label}
                </div>
                {sec.items.map(item => {
                  flatIdx++
                  const idx = flatIdx
                  const isActive = activeIndex === idx
                  return (
                    <button
                      key={item.id}
                      data-idx={idx}
                      onClick={() => navigate({ key: item.id, section: sec.key, result: item })}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors"
                      style={{ backgroundColor: isActive ? "var(--c-surface-2)" : "transparent" }}
                    >
                      <span
                        className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                        style={{ backgroundColor: "var(--c-surface-2)" }}
                      >
                        <ResultIcon type={item.type} meta={item.meta} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-sm truncate"
                          style={{ color: "var(--c-ink)", fontWeight: 500 }}
                        >
                          <Highlight text={item.title} query={query} />
                        </div>
                        {item.subtitle && (
                          <div
                            className="text-xs truncate mt-0.5"
                            style={{ color: "var(--c-ink-faint)" }}
                          >
                            {item.subtitle}
                          </div>
                        )}
                      </div>
                      <MetaBadge meta={item.meta} />
                      {isActive && <ChevronRight size={14} style={{ color: "var(--c-ink-faint)" }} className="shrink-0" />}
                    </button>
                  )
                })}
              </div>
            )
          })}

          {/* Empty state */}
          {!loading && query && !hasResults && (
            <div
              className="flex flex-col items-center gap-2 py-10 px-4 text-center"
              style={{ color: "var(--c-ink-faint)" }}
            >
              <Search size={24} style={{ opacity: 0.4 }} />
              <p className="text-sm">No results for <strong style={{ color: "var(--c-ink-muted)" }}>&ldquo;{query}&rdquo;</strong></p>
              <button
                onClick={() => navigate({ key: "ask-tars", section: "action", isAction: true, result: { id: "ask-tars", type: "conversation", title: `Ask TARS: "${query}"`, href: `/chat?ask=${encodeURIComponent(query)}`, meta: null } })}
                className="text-xs px-3 py-1.5 rounded-full font-medium mt-1 transition-colors"
                style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}
              >
                Ask TARS about this instead
              </button>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="px-4 py-2 flex items-center gap-4 shrink-0"
          style={{ borderTop: "1px solid var(--c-border)", backgroundColor: "var(--c-canvas)" }}
        >
          <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--c-ink-faint)" }}>
            <kbd className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-mono"
              style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}>↑↓</kbd>
            navigate
          </span>
          <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--c-ink-faint)" }}>
            <kbd className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-mono"
              style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}>↵</kbd>
            open
          </span>
          <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--c-ink-faint)" }}>
            <kbd className="inline-flex items-center px-1 py-0.5 rounded text-[10px] font-mono"
              style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}>esc</kbd>
            close
          </span>
          <span className="ml-auto text-[11px] font-medium" style={{ color: "var(--c-ink-faint)" }}>
            TARS search
          </span>
        </div>
      </div>
    </>
  )
}
