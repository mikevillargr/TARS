"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Search, LayoutGrid, List as ListIcon,
  Link as LinkIcon, FileText, File, Mic, Plus, Menu, X, Loader2,
  BookOpen,
} from "lucide-react"
import { apiGet, apiPost } from "@/lib/api-client"
import { ItemDetailModal } from "@/components/second-brain/ItemDetailModal"
import { CaptureModal } from "@/components/second-brain/CaptureModal"

// ─── Types ────────────────────────────────────────────────────────────────────

interface KnowledgeItem {
  id: string
  type: string
  url: string | null
  source_title: string | null
  source_author: string | null
  summary: string | null
  personal_note: string | null
  tags: string[]
  domain: string | null
  access_count: number
  saved_at: string
}

interface SearchResult {
  item_id: string
  item_title: string | null
  item_type: string
  chunk_content: string | null
  chunk_index: number | null
  url: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function TypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  if (type === "url")      return <LinkIcon size={size} />
  if (type === "note")     return <FileText size={size} />
  if (type === "meeting")  return <Mic size={size} />
  if (type === "document") return <BookOpen size={size} />
  return <File size={size} />
}

function typeLabel(type: string) {
  return { url: "URL", note: "Note", meeting: "Meeting", document: "Doc" }[type] ?? type
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SecondBrainPage() {
  const [items, setItems]                       = useState<KnowledgeItem[]>([])
  const [loading, setLoading]                   = useState(true)
  const [viewMode, setViewMode]                 = useState<"grid" | "list">("grid")
  const [selectedId, setSelectedId]             = useState<string | null>(null)
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false)
  const [selectedDomain, setSelectedDomain]     = useState("All")
  const [query, setQuery]                       = useState("")
  const [searchResults, setSearchResults]       = useState<SearchResult[] | null>(null)
  const [searching, setSearching]               = useState(false)
  const [showCapture, setShowCapture]           = useState(false)

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<KnowledgeItem[]>("/second-brain/items")
      setItems(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadItems() }, [loadItems])

  // Debounced semantic search
  useEffect(() => {
    if (!query.trim()) { setSearchResults(null); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await apiPost<SearchResult[]>("/second-brain/search", { query: query.trim(), limit: 10 })
        setSearchResults(data)
      } catch (e) { console.error(e) }
      finally { setSearching(false) }
    }, 400)
    return () => clearTimeout(t)
  }, [query])

  const domains = ["All", ...Array.from(new Set(items.map((i) => i.domain).filter(Boolean) as string[]))]

  const displayItems = searchResults
    ? items.filter((item) => searchResults.some((r) => r.item_id === item.id))
    : items.filter((item) => selectedDomain === "All" || item.domain === selectedDomain)

  // Matched search chunk for selected item
  const selectedSearchChunk = selectedId && searchResults
    ? searchResults.find((r) => r.item_id === selectedId)?.chunk_content ?? null
    : null

  // Sidebar content
  const sidebarContent = (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-semibold text-lg" style={{ color: "var(--c-ink)", fontFamily: "var(--font-heading), serif" }}>Domains</h2>
        <span className="text-xs" style={{ color: "var(--c-ink-faint)" }}>{items.length} items</span>
      </div>
      <div className="space-y-1 flex-1">
        {domains.map((domain) => {
          const count = domain === "All" ? items.length : items.filter((i) => i.domain === domain).length
          const isActive = selectedDomain === domain
          return (
            <button
              key={domain}
              onClick={() => { setSelectedDomain(domain); setMobileSidebar(false) }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors"
              style={{
                backgroundColor: isActive ? "var(--c-moss-soft)" : "transparent",
                color: isActive ? "var(--c-moss)" : "var(--c-ink)",
                fontWeight: isActive ? 500 : 400,
                borderLeft: isActive ? "2px solid var(--c-moss)" : "2px solid transparent",
              }}
            >
              <span>{domain === "All" ? "All Items" : domain}</span>
              <span style={{ color: isActive ? "var(--c-moss)" : "var(--c-ink-faint)" }}>{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas relative">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col w-52 shrink-0 border-r" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
        {sidebarContent}
      </div>

      {/* Mobile sidebar overlay */}
      {isMobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.3)" }} onClick={() => setMobileSidebar(false)} />
          <div className="relative w-72 max-w-[80%] h-full shadow-xl flex flex-col" style={{ backgroundColor: "var(--c-surface)" }}>
            <button onClick={() => setMobileSidebar(false)} className="absolute top-4 right-4 p-2" style={{ color: "var(--c-ink-faint)" }}><X size={20} /></button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b shrink-0" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button className="md:hidden p-2 -ml-2 rounded-md" style={{ color: "var(--c-ink-faint)" }} onClick={() => setMobileSidebar(true)}>
                  <Menu size={20} />
                </button>
                <h1 className="font-semibold text-xl" style={{ color: "var(--c-ink)", fontFamily: "var(--font-heading), serif" }}>
                  {query ? "Search Results" : selectedDomain === "All" ? "Second Brain" : selectedDomain}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 p-1 rounded-lg" style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}>
                  <button onClick={() => setViewMode("grid")} className="p-1.5 rounded-md transition-colors" style={{ backgroundColor: viewMode === "grid" ? "var(--c-surface)" : "transparent", color: viewMode === "grid" ? "var(--c-ink)" : "var(--c-ink-faint)" }}><LayoutGrid size={15} /></button>
                  <button onClick={() => setViewMode("list")} className="p-1.5 rounded-md transition-colors" style={{ backgroundColor: viewMode === "list" ? "var(--c-surface)" : "transparent", color: viewMode === "list" ? "var(--c-ink)" : "var(--c-ink-faint)" }}><ListIcon size={15} /></button>
                </div>
                <button
                  onClick={() => setShowCapture(true)}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium"
                  style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
                >
                  <Plus size={15} /> Capture
                </button>
              </div>
            </div>

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--c-ink-faint)" }} />
              {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin" style={{ color: "var(--c-ink-faint)" }} />}
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Semantic search across all knowledge…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none transition-shadow focus:ring-1"
                style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
              />
            </div>
          </div>
        </div>

        {/* Items grid/list */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className={`max-w-4xl mx-auto ${viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" : "space-y-2"}`}>
            {loading ? (
              <div className="col-span-full py-16 flex justify-center">
                <Loader2 size={22} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
              </div>
            ) : displayItems.length === 0 ? (
              <div className="col-span-full py-16 text-center text-sm" style={{ color: "var(--c-ink-faint)" }}>
                {query ? "No items matched that search." : "Nothing here yet — hit Capture to add your first item."}
              </div>
            ) : displayItems.map((item) => {
              const isSelected = selectedId === item.id
              const matchedChunk = searchResults?.find((r) => r.item_id === item.id)?.chunk_content

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={`group cursor-pointer rounded-xl p-3.5 transition-all ${viewMode === "list" ? "flex items-center gap-4" : "flex flex-col min-h-[120px]"}`}
                  style={{
                    backgroundColor: isSelected ? "var(--c-moss-soft)" : "var(--c-surface)",
                    border: `1px solid ${isSelected ? "var(--c-moss)" : "var(--c-border-faint)"}`,
                    outline: isSelected ? "1px solid color-mix(in srgb, var(--c-moss) 40%, transparent)" : "none",
                  }}
                >
                  {/* Type + date */}
                  <div className={`flex items-center justify-between ${viewMode === "list" ? "w-40 shrink-0" : "mb-2"}`}>
                    <div className="flex items-center gap-1.5" style={{ color: "var(--c-ink-faint)" }}>
                      <TypeIcon type={item.type} size={12} />
                      <span className="text-[10px] uppercase tracking-wider font-medium">{item.domain ?? typeLabel(item.type)}</span>
                    </div>
                    <span className="text-[10px]" style={{ color: "var(--c-ink-faint)" }}>
                      {new Date(item.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>

                  {/* Title + summary */}
                  <div className={`${viewMode === "list" ? "flex-1 min-w-0" : "flex-1"}`}>
                    <h3
                      className="font-medium text-sm leading-snug mb-1"
                      style={{ color: isSelected ? "var(--c-moss)" : "var(--c-ink)", fontFamily: "var(--font-heading), serif" }}
                    >
                      {item.source_title ?? item.url ?? "Untitled"}
                    </h3>
                    <p
                      className={`text-xs leading-relaxed ${viewMode === "list" ? "truncate" : "line-clamp-2"}`}
                      style={{ color: matchedChunk ? "var(--c-amber)" : "var(--c-ink-faint)" }}
                    >
                      {matchedChunk
                        ? `"${matchedChunk.slice(0, 120)}…"`
                        : item.summary?.slice(0, 120) ?? ""}
                    </p>
                  </div>

                  {/* Tags */}
                  {viewMode === "grid" && item.tags?.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-2">
                      {item.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-faint)" }}>#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Item detail modal */}
      <ItemDetailModal
        itemId={selectedId}
        onClose={() => setSelectedId(null)}
        onDeleted={(id) => {
          setItems(prev => prev.filter(i => i.id !== id))
          setSelectedId(null)
        }}
        onUpdated={(updated) => {
          setItems(prev => prev.map(i => i.id === updated.id ? { ...i, ...updated } : i))
        }}
        searchChunk={selectedSearchChunk}
      />

      {/* Quick capture modal */}
      <CaptureModal
        open={showCapture}
        onClose={() => setShowCapture(false)}
        onSaved={(item) => setItems(prev => [item, ...prev])}
      />
    </div>
  )
}
