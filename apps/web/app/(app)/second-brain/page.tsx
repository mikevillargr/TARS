"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import {
  Search, LayoutGrid, List as ListIcon,
  Link as LinkIcon, FileText, File, Mic, Plus, Menu, X, Loader2,
  BookOpen, Tag, Star, Columns2, Image as ImageIcon, Table2, CalendarRange,
} from "lucide-react"
import { apiGet, apiPost, apiPatch } from "@/lib/api-client"
import { ItemDetailModal } from "@/components/second-brain/ItemDetailModal"
import { CaptureModal } from "@/components/second-brain/CaptureModal"
import { KanbanView } from "@/components/second-brain/KanbanView"
import { GalleryView } from "@/components/second-brain/GalleryView"
import { TableView } from "@/components/second-brain/TableView"
import { TimelineView } from "@/components/second-brain/TimelineView"
import { useDomains } from "@/hooks/useDomains"

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
  starred: boolean
  properties: { status?: string; type?: string; priority?: string }
  saved_at: string
}

type ViewMode = "grid" | "list" | "kanban" | "gallery" | "table" | "timeline"

const VIEW_ICONS: { mode: ViewMode; Icon: React.ElementType; title: string }[] = [
  { mode: "grid",     Icon: LayoutGrid,    title: "Grid" },
  { mode: "list",     Icon: ListIcon,      title: "List" },
  { mode: "kanban",   Icon: Columns2,      title: "Kanban" },
  { mode: "gallery",  Icon: ImageIcon,     title: "Gallery" },
  { mode: "table",    Icon: Table2,        title: "Table" },
  { mode: "timeline", Icon: CalendarRange, title: "Timeline" },
]

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

// Reads ?capture=note&title=... and fires a callback — must be inside Suspense
function CaptureParamsLoader({ onCapture }: { onCapture: (title: string) => void }) {
  const searchParams = useSearchParams()
  const firedRef = useRef(false)
  useEffect(() => {
    if (searchParams.get("capture") === "note" && !firedRef.current) {
      firedRef.current = true
      onCapture(searchParams.get("title") ?? "")
    }
  }, [searchParams, onCapture])
  return null
}

export default function SecondBrainPage() {
  const { domains: domainList } = useDomains()
  const [items, setItems]                       = useState<KnowledgeItem[]>([])
  const [loading, setLoading]                   = useState(true)
  const [viewMode, setViewMode]                 = useState<ViewMode>(() => {
    if (typeof window !== "undefined") return (localStorage.getItem("tars_sb_view") as ViewMode) ?? "grid"
    return "grid"
  })
  const [selectedId, setSelectedId]             = useState<string | null>(null)
  const [isMobileSidebarOpen, setMobileSidebar] = useState(false)
  const [selectedDomain, setSelectedDomain]     = useState("All")
  const [selectedTag, setSelectedTag]           = useState("")
  const [query, setQuery]                       = useState("")
  const [searchResults, setSearchResults]       = useState<SearchResult[] | null>(null)
  const [searching, setSearching]               = useState(false)
  const [showCapture, setShowCapture]           = useState(false)
  const [captureInitialTitle, setCaptureInitialTitle] = useState("")
  const [tagSearch, setTagSearch]               = useState("")
  const [showAllTags, setShowAllTags]           = useState(false)

  const handleCaptureParam = useCallback((title: string) => {
    setCaptureInitialTitle(title)
    setShowCapture(true)
  }, [])

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<KnowledgeItem[]>("/second-brain/items")
      setItems(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadItems() }, [loadItems])

  // Optimistic star toggle — persists via PATCH, rolls back on failure
  const toggleStar = useCallback(async (id: string, current: boolean) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, starred: !current } : i))
    try {
      await apiPatch(`/second-brain/items/${id}`, { starred: !current })
    } catch (e) {
      console.error(e)
      setItems(prev => prev.map(i => i.id === id ? { ...i, starred: current } : i))
    }
  }, [])

  function setAndPersistView(mode: ViewMode) {
    setViewMode(mode)
    localStorage.setItem("tars_sb_view", mode)
  }

  const handleStatusChange = useCallback(async (id: string, status: string) => {
    const prev = items.find(i => i.id === id)
    if (!prev) return
    setItems(arr => arr.map(i => i.id === id ? { ...i, properties: { ...i.properties, status } } : i))
    try {
      await apiPatch(`/second-brain/items/${id}`, { properties: { status } })
    } catch {
      setItems(arr => arr.map(i => i.id === id ? { ...i, properties: prev.properties } : i))
    }
  }, [items])

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

  const allTags = [...new Set(items.flatMap(i => i.tags ?? []))].sort()

  const displayItems = searchResults
    ? items.filter((item) => searchResults.some((r) => r.item_id === item.id))
    : items.filter((item) => {
        if (selectedDomain === "Starred" && !item.starred) return false
        if (selectedDomain !== "All" && selectedDomain !== "Starred" && item.domain !== selectedDomain) return false
        if (selectedTag && !(item.tags ?? []).includes(selectedTag)) return false
        return true
      })

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
        {/* All Items */}
        {["All"].concat([]).map(() => {
          const isActive = selectedDomain === "All"
          return (
            <button
              key="All"
              onClick={() => { setSelectedDomain("All"); setSelectedTag(""); setMobileSidebar(false) }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors"
              style={{
                backgroundColor: isActive ? "var(--c-moss-soft)" : "transparent",
                color: isActive ? "var(--c-moss)" : "var(--c-ink)",
                fontWeight: isActive ? 500 : 400,
                borderLeft: isActive ? "2px solid var(--c-moss)" : "2px solid transparent",
              }}
            >
              <span>All Items</span>
              <span style={{ color: isActive ? "var(--c-moss)" : "var(--c-ink-faint)" }}>{items.length}</span>
            </button>
          )
        })}
        {/* Starred */}
        {(() => {
          const count = items.filter((i) => i.starred).length
          const isActive = selectedDomain === "Starred"
          return (
            <button
              key="Starred"
              onClick={() => { setSelectedDomain("Starred"); setSelectedTag(""); setMobileSidebar(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{
                backgroundColor: isActive ? "var(--c-amber-soft)" : "transparent",
                color: isActive ? "var(--c-amber)" : "var(--c-ink)",
                fontWeight: isActive ? 500 : 400,
                borderLeft: isActive ? "2px solid var(--c-amber)" : "2px solid transparent",
              }}
            >
              <Star size={13} className="shrink-0" fill={isActive ? "var(--c-amber)" : "none"} style={{ color: "var(--c-amber)" }} />
              <span className="flex-1 text-left">Starred</span>
              <span style={{ color: isActive ? "var(--c-amber)" : "var(--c-ink-faint)" }}>{count || ""}</span>
            </button>
          )
        })()}
        {domainList.map((d) => {
          const count = items.filter((i) => i.domain === d.name).length
          const isActive = selectedDomain === d.name
          return (
            <button
              key={d.id}
              onClick={() => { setSelectedDomain(d.name); setSelectedTag(""); setMobileSidebar(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors"
              style={{
                backgroundColor: isActive ? "var(--c-moss-soft)" : "transparent",
                color: isActive ? "var(--c-moss)" : "var(--c-ink)",
                fontWeight: isActive ? 500 : 400,
                borderLeft: isActive ? "2px solid var(--c-moss)" : "2px solid transparent",
              }}
            >
              <span
                className="rounded-full shrink-0"
                style={{ width: 8, height: 8, backgroundColor: d.color, opacity: isActive ? 1 : 0.7 }}
              />
              <span className="flex-1 text-left">{d.name}</span>
              <span style={{ color: isActive ? "var(--c-moss)" : "var(--c-ink-faint)" }}>{count || ""}</span>
            </button>
          )
        })}
      </div>

      {/* Tags section */}
      {allTags.length > 0 && (() => {
        const TAG_PAGE_SIZE = 10
        const filtered = tagSearch.trim()
          ? allTags.filter(t => t.toLowerCase().includes(tagSearch.toLowerCase()))
          : allTags
        const visibleTags = (showAllTags || tagSearch.trim()) ? filtered : filtered.slice(0, TAG_PAGE_SIZE)
        const hiddenCount = filtered.length - TAG_PAGE_SIZE

        return (
          <div className="mt-4 pt-4 flex flex-col gap-2" style={{ borderTop: "1px solid var(--c-border-faint)" }}>
            {/* Header row */}
            <div className="flex items-center justify-between px-1">
              <span className="text-[0.6rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>Tags</span>
              {selectedTag && (
                <button
                  onClick={() => setSelectedTag("")}
                  className="text-[10px] flex items-center gap-0.5"
                  style={{ color: "var(--c-ink-faint)" }}
                >
                  <X size={10} /> clear
                </button>
              )}
            </div>

            {/* Search input */}
            <div className="relative px-1">
              <Search size={11} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--c-ink-faint)" }} />
              <input
                type="text"
                value={tagSearch}
                onChange={e => { setTagSearch(e.target.value); setShowAllTags(false) }}
                placeholder="Filter tags…"
                className="w-full pl-6 pr-2 py-1 rounded-md text-[11px] outline-none"
                style={{
                  backgroundColor: "var(--c-canvas)",
                  border: "1px solid var(--c-border-faint)",
                  color: "var(--c-ink)",
                }}
              />
              {tagSearch && (
                <button
                  onClick={() => setTagSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--c-ink-faint)" }}
                >
                  <X size={10} />
                </button>
              )}
            </div>

            {/* Tag chips */}
            {visibleTags.length > 0 ? (
              <div className="flex flex-wrap gap-1 px-1">
                {visibleTags.map(tag => {
                  const isActive = selectedTag === tag
                  const count = items.filter(i => (i.tags ?? []).includes(tag)).length
                  return (
                    <button
                      key={tag}
                      onClick={() => { setSelectedTag(isActive ? "" : tag); setMobileSidebar(false) }}
                      className="text-[11px] px-2 py-0.5 rounded-full transition-colors"
                      style={{
                        backgroundColor: isActive ? "var(--c-moss)" : "var(--c-surface-2)",
                        color: isActive ? "#fff" : "var(--c-ink-muted)",
                        border: `1px solid ${isActive ? "var(--c-moss)" : "var(--c-border-faint)"}`,
                      }}
                    >
                      #{tag} <span style={{ opacity: 0.7 }}>{count}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="px-1 text-[11px]" style={{ color: "var(--c-ink-faint)" }}>No tags match.</p>
            )}

            {/* Show more / less */}
            {!tagSearch.trim() && hiddenCount > 0 && (
              <button
                onClick={() => setShowAllTags(v => !v)}
                className="px-1 text-[11px] text-left flex items-center gap-1"
                style={{ color: "var(--c-ink-faint)" }}
              >
                <Tag size={10} />
                {showAllTags ? "Show fewer" : `${hiddenCount} more tag${hiddenCount !== 1 ? "s" : ""}…`}
              </button>
            )}
          </div>
        )
      })()}
    </div>
  )

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas relative">
      <Suspense fallback={null}>
        <CaptureParamsLoader onCapture={handleCaptureParam} />
      </Suspense>

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
        <div className="px-5 pt-5 pb-3 border-b shrink-0" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
          <div className="max-w-4xl mx-auto space-y-3">
            {/* Title row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 min-w-0">
                <button className="md:hidden p-2 -ml-2 rounded-md shrink-0" style={{ color: "var(--c-ink-faint)" }} onClick={() => setMobileSidebar(true)}>
                  <Menu size={20} />
                </button>
                <h1 className="font-semibold text-xl truncate" style={{ color: "var(--c-ink)", fontFamily: "var(--font-heading), serif" }}>
                  {query ? "Search Results" : selectedTag ? `#${selectedTag}` : selectedDomain === "All" ? "Second Brain" : selectedDomain}
                </h1>
              </div>
              {/* Desktop: view toggle + capture in title row */}
              <div className="hidden sm:flex items-center gap-2 shrink-0">
                <div className="flex items-center gap-0.5 p-1 rounded-lg" style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}>
                  {VIEW_ICONS.map(({ mode, Icon, title }) => (
                    <button
                      key={mode}
                      onClick={() => setAndPersistView(mode)}
                      title={title}
                      className="p-1.5 rounded-md transition-colors"
                      style={{ backgroundColor: viewMode === mode ? "var(--c-surface)" : "transparent", color: viewMode === mode ? "var(--c-ink)" : "var(--c-ink-faint)" }}
                    >
                      <Icon size={15} />
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setShowCapture(true)}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium shrink-0"
                  style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
                >
                  <Plus size={15} /> Capture
                </button>
              </div>
            </div>
            {/* Mobile: view toggle row (capture lives in topbar) */}
            <div className="flex sm:hidden items-center gap-2">
              <div className="flex items-center gap-0.5 p-1 rounded-lg flex-1" style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)" }}>
                {VIEW_ICONS.map(({ mode, Icon, title }) => (
                  <button
                    key={mode}
                    onClick={() => setAndPersistView(mode)}
                    title={title}
                    className="flex-1 flex justify-center p-1.5 rounded-md transition-colors"
                    style={{ backgroundColor: viewMode === mode ? "var(--c-surface)" : "transparent", color: viewMode === mode ? "var(--c-ink)" : "var(--c-ink-faint)" }}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
            </div>

            {/* Active tag chip */}
            {selectedTag && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--c-ink-faint)" }}>Filtered by:</span>
                <button
                  onClick={() => setSelectedTag("")}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium transition-colors"
                  style={{ backgroundColor: "var(--c-moss)", color: "#fff" }}
                >
                  <Tag size={11} />
                  #{selectedTag}
                  <X size={11} />
                </button>
              </div>
            )}

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

        {/* Items grid/list/kanban/gallery/table/timeline */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Kanban / Gallery / Table / Timeline non-grid views */}
          {viewMode === "kanban" && !loading && (
            <div className="max-w-none">
              <KanbanView
                items={displayItems}
                onStatusChange={handleStatusChange}
                onItemClick={setSelectedId}
                onToggleStar={toggleStar}
              />
            </div>
          )}
          {viewMode === "gallery" && !loading && (
            <div className="max-w-4xl mx-auto">
              <GalleryView items={displayItems} onItemClick={setSelectedId} onToggleStar={toggleStar} />
            </div>
          )}
          {viewMode === "table" && !loading && (
            <div className="max-w-5xl mx-auto">
              <TableView items={displayItems} onItemClick={setSelectedId} />
            </div>
          )}
          {viewMode === "timeline" && !loading && (
            <div className="max-w-2xl mx-auto">
              <TimelineView items={displayItems} onItemClick={setSelectedId} onToggleStar={toggleStar} />
            </div>
          )}
          {/* Grid / List */}
          <div className={`max-w-4xl mx-auto ${["grid", "list"].includes(viewMode) ? (viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" : "space-y-2") : "hidden"}`}>
            {loading ? (
              <div className="col-span-full py-16 flex justify-center">
                <Loader2 size={22} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
              </div>
            ) : displayItems.length === 0 ? (
              <div className="col-span-full py-16 text-center text-sm" style={{ color: "var(--c-ink-faint)" }}>
                {query ? "No items matched that search."
                  : selectedDomain === "Starred" ? "No starred items yet — tap the star on any card to pin it here."
                  : "Nothing here yet — hit Capture to add your first item."}
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
                      {item.domain && (() => {
                        const dc = domainList.find(d => d.name === item.domain)
                        return dc ? <span className="rounded-full shrink-0" style={{ width: 6, height: 6, backgroundColor: dc.color }} /> : null
                      })()}
                      <span className="text-[10px] font-mono uppercase tracking-wider font-medium">{item.domain ?? typeLabel(item.type)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px]" style={{ color: "var(--c-ink-faint)" }}>
                        {new Date(item.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                      <button
                        type="button"
                        onClick={e => { e.stopPropagation(); toggleStar(item.id, item.starred) }}
                        className={`p-0.5 -m-0.5 rounded transition-opacity ${item.starred ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
                        style={{ color: "var(--c-amber)" }}
                        title={item.starred ? "Unstar" : "Star"}
                        aria-pressed={item.starred}
                      >
                        <Star size={13} fill={item.starred ? "var(--c-amber)" : "none"} />
                      </button>
                    </div>
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
                  {viewMode === "grid" && (item.tags ?? []).length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-2">
                      {(item.tags ?? []).slice(0, 4).map((tag) => (
                        <button
                          key={tag}
                          type="button"
                          onClick={e => { e.stopPropagation(); setSelectedTag(selectedTag === tag ? "" : tag) }}
                          className="text-[10px] px-1.5 py-0.5 rounded-full transition-colors"
                          style={{
                            backgroundColor: selectedTag === tag ? "var(--c-moss)" : "var(--c-surface-2)",
                            color: selectedTag === tag ? "#fff" : "var(--c-ink-faint)",
                          }}
                        >
                          #{tag}
                        </button>
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
        onSaved={(item) => setItems(prev => [{ ...item, starred: false, properties: {} }, ...prev])}
        initialTitle={captureInitialTitle}
      />
    </div>
  )
}
