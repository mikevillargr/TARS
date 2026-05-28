"use client"

import { useState, useEffect, useCallback } from "react"
import {
  Search, Filter, LayoutGrid, List as ListIcon,
  Link as LinkIcon, FileText, File, Plus, Menu, X, Loader2,
} from "lucide-react"
import { apiGet, apiPost, apiDelete } from "@/lib/api-client"

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
  url: string | null
}

function TypeIcon({ type }: { type: string }) {
  if (type === "url") return <LinkIcon size={14} />
  if (type === "note") return <FileText size={14} />
  return <File size={14} />
}

type CaptureTab = "url" | "text"

export default function SecondBrainPage() {
  const [items, setItems]                         = useState<KnowledgeItem[]>([])
  const [loading, setLoading]                     = useState(true)
  const [viewMode, setViewMode]                   = useState<"grid" | "list">("grid")
  const [selectedItem, setSelectedItem]           = useState<KnowledgeItem | null>(null)
  const [isMobileSidebarOpen, setMobileSidebar]   = useState(false)
  const [selectedDomain, setSelectedDomain]       = useState("All")
  const [query, setQuery]                         = useState("")
  const [searchResults, setSearchResults]         = useState<SearchResult[] | null>(null)
  const [searching, setSearching]                 = useState(false)
  const [showCapture, setShowCapture]             = useState(false)
  const [captureTab, setCaptureTab]               = useState<CaptureTab>("url")
  const [captureUrl, setCaptureUrl]               = useState("")
  const [captureText, setCaptureText]             = useState("")
  const [captureTitle, setCaptureTitle]           = useState("")
  const [captureNote, setCaptureNote]             = useState("")
  const [captureTags, setCaptureTags]             = useState("")
  const [captureDomain, setCaptureDomain]         = useState("work")
  const [ingesting, setIngesting]                 = useState(false)
  const [ingestError, setIngestError]             = useState("")

  const loadItems = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<KnowledgeItem[]>("/second-brain/items")
      setItems(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
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
      } catch (e) {
        console.error(e)
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [query])

  const domains = ["All", ...Array.from(new Set(items.map((i) => i.domain).filter(Boolean) as string[]))]

  const displayItems = searchResults
    ? items.filter((item) => searchResults.some((r) => r.item_id === item.id))
    : items.filter((item) => selectedDomain === "All" || item.domain === selectedDomain)

  const handleDelete = async (id: string) => {
    await apiDelete(`/second-brain/items/${id}`)
    setItems((prev) => prev.filter((i) => i.id !== id))
    if (selectedItem?.id === id) setSelectedItem(null)
  }

  const handleIngest = async () => {
    setIngestError("")
    setIngesting(true)
    try {
      const tags = captureTags.split(",").map((t) => t.trim()).filter(Boolean)
      let item: KnowledgeItem
      if (captureTab === "url") {
        item = await apiPost<KnowledgeItem>("/second-brain/ingest/url", {
          url: captureUrl.trim(),
          personal_note: captureNote,
          tags,
          domain: captureDomain,
        })
      } else {
        item = await apiPost<KnowledgeItem>("/second-brain/ingest/text", {
          content: captureText.trim(),
          title: captureTitle.trim(),
          personal_note: captureNote,
          tags,
          domain: captureDomain,
        })
      }
      setItems((prev) => [item, ...prev])
      setShowCapture(false)
      setCaptureUrl(""); setCaptureText(""); setCaptureTitle("")
      setCaptureNote(""); setCaptureTags("")
    } catch (e: unknown) {
      setIngestError(e instanceof Error ? e.message : "Ingest failed")
    } finally {
      setIngesting(false)
    }
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-semibold text-lg text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>Domains</h2>
        <span className="text-xs text-ink-muted">{items.length} items</span>
      </div>
      <div className="space-y-1 flex-1">
        {domains.map((domain) => {
          const count = domain === "All" ? items.length : items.filter((i) => i.domain === domain).length
          const isActive = selectedDomain === domain
          return (
            <button
              key={domain}
              onClick={() => { setSelectedDomain(domain); setMobileSidebar(false) }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                isActive ? "bg-moss-soft text-moss font-medium" : "text-ink hover:bg-surface-2"
              }`}
              style={{ borderLeft: isActive ? "2px solid #2d5a4f" : "2px solid transparent" }}
            >
              <span>{domain === "All" ? "All Items" : domain}</span>
              <span className={isActive ? "text-moss/70" : "text-ink-muted"}>{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas relative">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col w-56 shrink-0 border-r border-border bg-surface">
        <SidebarContent />
      </div>

      {/* Mobile sidebar overlay */}
      {isMobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={() => setMobileSidebar(false)} />
          <div className="relative w-72 max-w-[80%] bg-surface h-full shadow-xl flex flex-col">
            <button onClick={() => setMobileSidebar(false)} className="absolute top-4 right-4 p-2 text-ink-muted hover:text-ink"><X size={20} /></button>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-border bg-surface shrink-0">
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button className="md:hidden p-2 -ml-2 text-ink-muted hover:text-ink rounded-md hover:bg-surface-2" onClick={() => setMobileSidebar(true)}>
                  <Menu size={20} />
                </button>
                <h1 className="font-semibold text-2xl text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>
                  {query ? "Search Results" : selectedDomain === "All" ? "Second Brain" : selectedDomain}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 bg-surface-2 p-1 rounded-md border border-border-faint">
                  <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded ${viewMode === "grid" ? "bg-surface shadow-sm" : "text-ink-muted"}`}><LayoutGrid size={16} /></button>
                  <button onClick={() => setViewMode("list")} className={`p-1.5 rounded ${viewMode === "list" ? "bg-surface shadow-sm" : "text-ink-muted"}`}><ListIcon size={16} /></button>
                </div>
                <button onClick={() => setShowCapture(true)} className="btn-primary flex items-center gap-2 text-sm">
                  <Plus size={16} /> Capture
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-faint animate-spin" />}
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Semantic search across all knowledge…"
                  className="w-full bg-canvas border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-moss focus:ring-1 focus:ring-moss"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className={`max-w-6xl mx-auto ${viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-3"}`}>
            {loading ? (
              <div className="col-span-full py-12 flex justify-center">
                <Loader2 size={24} className="animate-spin text-ink-muted" />
              </div>
            ) : displayItems.length === 0 ? (
              <div className="col-span-full py-12 text-center text-ink-muted text-sm">
                {query ? "No items matched that search." : "Nothing here yet. Hit Capture to add your first item."}
              </div>
            ) : displayItems.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedItem((prev) => prev?.id === item.id ? null : item)}
                className={`card cursor-pointer group hover:border-moss/50 transition-colors ${viewMode === "list" ? "flex items-center gap-4 p-3" : "flex flex-col h-48"}`}
                style={{ outline: selectedItem?.id === item.id ? "2px solid #2d5a4f" : "none", outlineOffset: "1px" }}
              >
                <div className={`flex items-start justify-between ${viewMode === "list" ? "w-48 shrink-0" : "mb-3"}`}>
                  <div className="flex items-center gap-2 text-ink-muted">
                    <TypeIcon type={item.type} />
                    <span className="text-[10px] uppercase tracking-wider font-medium">{item.domain ?? item.type}</span>
                  </div>
                  <span className="text-xs text-ink-faint">
                    {new Date(item.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>
                <div className={viewMode === "list" ? "flex-1 min-w-0" : "flex-1"}>
                  <h3 className="font-medium text-base leading-tight mb-2 group-hover:text-moss transition-colors truncate" style={{ fontFamily: "var(--font-heading), serif" }}>
                    {item.source_title ?? (item.url ?? "Note")}
                  </h3>
                  <p className={`text-sm text-ink-muted ${viewMode === "grid" ? "line-clamp-3" : "truncate"}`}>
                    {item.summary ?? ""}
                  </p>
                </div>
                <div className={`flex gap-1 overflow-hidden ${viewMode === "list" ? "w-32 shrink-0 justify-end" : "mt-auto pt-3"}`}>
                  {item.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="text-[10px] text-ink-muted bg-surface-2 px-1.5 py-0.5 rounded">#{tag}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right detail panel */}
      {selectedItem && (
        <div className="w-[300px] border-l flex flex-col shrink-0 overflow-y-auto" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
          <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: "#d8d2c4" }}>
            <div className="flex items-center gap-2 text-ink-muted text-xs">
              <TypeIcon type={selectedItem.type} />
              <span className="uppercase tracking-wider font-medium">{selectedItem.type}</span>
            </div>
            <button onClick={() => setSelectedItem(null)} className="p-1 rounded-md text-ink-muted hover:bg-surface-2"><X size={15} /></button>
          </div>
          <div className="p-4 space-y-4">
            <h2 className="font-semibold text-base text-[#1a1714] leading-snug" style={{ fontFamily: "var(--font-heading), serif" }}>
              {selectedItem.source_title ?? selectedItem.url ?? "Note"}
            </h2>
            {selectedItem.url && (
              <a href={selectedItem.url} target="_blank" rel="noreferrer" className="text-sm break-all" style={{ color: "#2d5a4f" }}>
                {selectedItem.url}
              </a>
            )}
            <div className="flex flex-wrap gap-2">
              {selectedItem.domain && <span className="badge badge-neutral bg-surface-2">{selectedItem.domain}</span>}
              {selectedItem.tags.map((tag) => (
                <span key={tag} className="badge badge-neutral text-xs">#{tag}</span>
              ))}
            </div>
            {selectedItem.summary && (
              <div className="pt-3 border-t" style={{ borderColor: "#e8e2d4" }}>
                <h3 className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Summary</h3>
                <p className="text-sm leading-relaxed text-[#1a1714]">{selectedItem.summary}</p>
              </div>
            )}
            {selectedItem.personal_note && (
              <div className="pt-3 border-t" style={{ borderColor: "#e8e2d4" }}>
                <h3 className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Your Note</h3>
                <p className="text-sm leading-relaxed text-[#1a1714]">{selectedItem.personal_note}</p>
              </div>
            )}
            <div className="pt-3 border-t" style={{ borderColor: "#e8e2d4" }}>
              <button
                onClick={() => handleDelete(selectedItem.id)}
                className="text-xs text-ink-muted hover:text-red-600 transition-colors"
              >
                Delete item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Capture modal */}
      {showCapture && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>Quick Capture</h2>
              <button onClick={() => { setShowCapture(false); setIngestError("") }} className="p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 bg-surface-2 p-1 rounded-md mb-4">
              {(["url", "text"] as CaptureTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCaptureTab(tab)}
                  className={`flex-1 py-1.5 text-sm rounded transition-colors ${captureTab === tab ? "bg-surface shadow-sm font-medium" : "text-ink-muted"}`}
                >
                  {tab === "url" ? "URL" : "Note"}
                </button>
              ))}
            </div>

            {captureTab === "url" ? (
              <input
                type="url"
                value={captureUrl}
                onChange={(e) => setCaptureUrl(e.target.value)}
                placeholder="https://…"
                className="input-field w-full text-sm mb-3"
                autoFocus
              />
            ) : (
              <>
                <input
                  type="text"
                  value={captureTitle}
                  onChange={(e) => setCaptureTitle(e.target.value)}
                  placeholder="Title (optional)"
                  className="input-field w-full text-sm mb-2"
                />
                <textarea
                  value={captureText}
                  onChange={(e) => setCaptureText(e.target.value)}
                  placeholder="Your note or content…"
                  className="input-field w-full h-28 text-sm resize-none mb-3"
                  autoFocus
                />
              </>
            )}

            <textarea
              value={captureNote}
              onChange={(e) => setCaptureNote(e.target.value)}
              placeholder="Personal annotation (optional)"
              className="input-field w-full h-16 text-sm resize-none mb-3"
            />

            <div className="flex gap-3 mb-4">
              <input
                type="text"
                value={captureTags}
                onChange={(e) => setCaptureTags(e.target.value)}
                placeholder="Tags (comma separated)"
                className="input-field flex-1 text-sm"
              />
              <select className="input-field text-sm" value={captureDomain} onChange={(e) => setCaptureDomain(e.target.value)}>
                {["work", "personal", "cycling", "client", "health"].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            {ingestError && <p className="text-sm text-red-600 mb-3">{ingestError}</p>}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowCapture(false); setIngestError("") }} className="btn-ghost text-sm">Cancel</button>
              <button
                onClick={handleIngest}
                disabled={ingesting || (captureTab === "url" ? !captureUrl.trim() : !captureText.trim())}
                className="btn-primary text-sm disabled:opacity-40 flex items-center gap-2"
              >
                {ingesting && <Loader2 size={14} className="animate-spin" />}
                {ingesting ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
