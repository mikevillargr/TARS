"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Search, LayoutGrid, List as ListIcon,
  Link as LinkIcon, FileText, File, Mic, Plus, Menu, X, Loader2,
  Pencil, Check, Copy, ExternalLink, Trash2, MessageSquare,
  BookOpen, ChevronDown, ChevronUp, Tag, Layers,
} from "lucide-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client"

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

interface KnowledgeItemDetail extends KnowledgeItem {
  clean_content: string | null
  chunk_count: number
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
  if (type === "url")     return <LinkIcon size={size} />
  if (type === "note")    return <FileText size={size} />
  if (type === "meeting") return <Mic size={size} />
  return <File size={size} />
}

function typeLabel(type: string) {
  return { url: "URL", note: "Note", meeting: "Meeting", document: "Doc" }[type] ?? type
}

const DOMAINS = ["work", "personal", "cycling", "client", "health"]

type CaptureTab = "url" | "text"

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  itemId,
  onClose,
  onDeleted,
  onUpdated,
  searchChunk,
}: {
  itemId: string
  onClose: () => void
  onDeleted: (id: string) => void
  onUpdated: (item: KnowledgeItem) => void
  searchChunk?: string | null
}) {
  const router = useRouter()
  const [item, setItem]           = useState<KnowledgeItemDetail | null>(null)
  const [loading, setLoading]     = useState(true)
  const [editing, setEditing]     = useState(false)
  const [editTitle, setEditTitle] = useState("")
  const [editNote, setEditNote]   = useState("")
  const [editTags, setEditTags]   = useState("")
  const [editDomain, setEditDomain] = useState("work")
  const [saving, setSaving]       = useState(false)
  const [copied, setCopied]       = useState(false)
  const [showFull, setShowFull]   = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setLoading(true)
    setItem(null)
    setEditing(false)
    setShowFull(false)
    setConfirmDelete(false)
    apiGet<KnowledgeItemDetail>(`/second-brain/items/${itemId}`)
      .then((d) => {
        setItem(d)
        setEditTitle(d.source_title ?? "")
        setEditNote(d.personal_note ?? "")
        setEditTags((d.tags ?? []).join(", "))
        setEditDomain(d.domain ?? "work")
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [itemId])

  const save = async () => {
    if (!item) return
    setSaving(true)
    try {
      const updated = await apiPatch<KnowledgeItemDetail>(`/second-brain/items/${item.id}`, {
        source_title: editTitle || null,
        personal_note: editNote || null,
        tags: editTags.split(",").map((t) => t.trim()).filter(Boolean),
        domain: editDomain,
      })
      setItem(updated)
      onUpdated(updated)
      setEditing(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const copyContent = async () => {
    const text = item?.clean_content ?? item?.summary ?? ""
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const deleteItem = async () => {
    if (!item) return
    await apiDelete(`/second-brain/items/${item.id}`)
    onDeleted(item.id)
  }

  const openInChat = () => {
    if (!item) return
    router.push(`/chat?load=${item.id}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin" style={{ color: "#948a7b" }} />
      </div>
    )
  }
  if (!item) return null

  const displayContent = item.clean_content ?? item.summary ?? ""
  const isLong = displayContent.length > 1200
  const shownContent = isLong && !showFull ? displayContent.slice(0, 1200) + "…" : displayContent

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-4 py-3 border-b shrink-0 flex items-center justify-between"
        style={{ borderColor: "#d8d2c4" }}
      >
        <div className="flex items-center gap-2 text-xs" style={{ color: "#948a7b" }}>
          <TypeIcon type={item.type} />
          <span className="uppercase tracking-wider font-medium">{typeLabel(item.type)}</span>
          {item.chunk_count > 0 && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
              style={{ backgroundColor: "#efeadf", color: "#6b6357" }}
            >
              <Layers size={9} /> {item.chunk_count} chunks
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!editing ? (
            <button
              onClick={() => setEditing(true)}
              className="p-1.5 rounded-md transition-colors hover:bg-surface-2"
              style={{ color: "#948a7b" }}
              title="Edit"
            >
              <Pencil size={14} />
            </button>
          ) : (
            <button
              onClick={save}
              disabled={saving}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: "#2d5a4f" }}
              title="Save changes"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-md" style={{ color: "#948a7b" }}>
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" data-selectable>

        {/* Title */}
        {editing ? (
          <input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="w-full text-sm font-semibold px-2 py-1.5 rounded-lg outline-none"
            style={{
              backgroundColor: "#f6f3ec",
              border: "1px solid #d8d2c4",
              color: "#1a1714",
              fontFamily: "var(--font-heading), serif",
            }}
            placeholder="Title"
          />
        ) : (
          <h2
            className="font-semibold text-base leading-snug"
            style={{ color: "#1a1714", fontFamily: "var(--font-heading), serif" }}
          >
            {item.source_title ?? item.url ?? "Untitled"}
          </h2>
        )}

        {/* URL link */}
        {item.url && !item.url.startsWith("fireflies://") && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs break-all transition-opacity hover:opacity-80"
            style={{ color: "#2d5a4f" }}
          >
            <ExternalLink size={11} />
            {item.url}
          </a>
        )}

        {/* Domain + tags */}
        {editing ? (
          <div className="space-y-2">
            <select
              value={editDomain}
              onChange={(e) => setEditDomain(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg outline-none w-full"
              style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
            >
              {DOMAINS.map((d) => <option key={d}>{d}</option>)}
            </select>
            <div className="relative">
              <Tag size={11} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "#948a7b" }} />
              <input
                value={editTags}
                onChange={(e) => setEditTags(e.target.value)}
                placeholder="tag1, tag2, tag3"
                className="w-full text-xs pl-6 pr-2 py-1.5 rounded-lg outline-none"
                style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {item.domain && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                style={{ backgroundColor: "#efeadf", color: "#6b6357" }}
              >
                {item.domain}
              </span>
            )}
            {(item.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "#f6f3ec", color: "#948a7b", border: "1px solid #e8e2d4" }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* Search match highlight */}
        {searchChunk && (
          <div
            className="rounded-lg p-3"
            style={{ backgroundColor: "#fffbe6", border: "1px solid #f0e68c" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#92740a" }}>
              Matched passage
            </p>
            <p className="text-xs leading-relaxed" style={{ color: "#4a3a00" }}>{searchChunk}</p>
          </div>
        )}

        {/* Personal note */}
        <div className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#948a7b" }}>
            Your Note
          </p>
          {editing ? (
            <textarea
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              placeholder="Add a personal annotation…"
              rows={3}
              className="w-full text-sm px-2.5 py-2 rounded-lg outline-none resize-none"
              style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
            />
          ) : item.personal_note ? (
            <p className="text-sm leading-relaxed italic" style={{ color: "#6b6357" }}>
              {item.personal_note}
            </p>
          ) : (
            <p className="text-xs" style={{ color: "#c4bdb2" }}>No note — click edit to add one</p>
          )}
        </div>

        {/* Full content */}
        {displayContent && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#948a7b" }}>
              Content
            </p>
            <div
              className="text-sm leading-relaxed rounded-lg p-3 overflow-hidden"
              style={{ backgroundColor: "#f6f3ec", border: "1px solid #e8e2d4", color: "#1a1714" }}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <p className="mb-2 last:mb-0 text-sm leading-relaxed">{children}</p>,
                  h1: ({ children }) => <h1 className="text-base font-semibold mb-1 mt-2">{children}</h1>,
                  h2: ({ children }) => <h2 className="text-sm font-semibold mb-1 mt-2">{children}</h2>,
                  h3: ({ children }) => <h3 className="text-sm font-medium mb-1 mt-1">{children}</h3>,
                  ul: ({ children }) => <ul className="pl-4 space-y-0.5 mb-2">{children}</ul>,
                  ol: ({ children }) => <ol className="pl-4 space-y-0.5 mb-2 list-decimal">{children}</ol>,
                  li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
                  code: ({ children, className }) => {
                    const isBlock = !!className
                    return isBlock
                      ? <pre className="text-xs p-2 rounded overflow-x-auto my-2" style={{ backgroundColor: "#1a1a1a", color: "#e2e2e2" }}><code>{children}</code></pre>
                      : <code className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: "#efeadf", color: "#b45309" }}>{children}</code>
                  },
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="underline" style={{ color: "#2d5a4f" }}>{children}</a>
                  ),
                }}
              >
                {shownContent}
              </ReactMarkdown>
            </div>
            {isLong && (
              <button
                onClick={() => setShowFull(!showFull)}
                className="mt-1.5 flex items-center gap-1 text-xs transition-colors"
                style={{ color: "#948a7b" }}
              >
                {showFull ? <><ChevronUp size={12} /> Show less</> : <><ChevronDown size={12} /> Show full content ({Math.round(displayContent.length / 5)} words)</>}
              </button>
            )}
          </div>
        )}

        {/* Metadata footer */}
        <div
          className="pt-3 border-t text-[10px] space-y-0.5"
          style={{ borderColor: "#e8e2d4", color: "#948a7b" }}
        >
          <p>Saved {new Date(item.saved_at).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</p>
          {item.access_count > 0 && <p>Referenced by TARS {item.access_count}×</p>}
          {item.source_author && <p>By {item.source_author}</p>}
        </div>
      </div>

      {/* Action bar */}
      <div className="shrink-0 border-t px-4 py-3 flex items-center gap-2" style={{ borderColor: "#d8d2c4" }}>
        <button
          onClick={openInChat}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors font-medium"
          style={{ backgroundColor: "#2d5a4f", color: "#fff" }}
          title="Ask TARS about this"
        >
          <MessageSquare size={12} />
          Chat
        </button>

        <button
          onClick={copyContent}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
          style={{ backgroundColor: "#f6f3ec", color: "#6b6357", border: "1px solid #d8d2c4" }}
        >
          {copied ? <Check size={11} style={{ color: "#2d5a4f" }} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>

        {item.url && !item.url.startsWith("fireflies://") && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: "#f6f3ec", color: "#6b6357", border: "1px solid #d8d2c4" }}
          >
            <ExternalLink size={11} />
            Open
          </a>
        )}

        <div className="flex-1" />

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: "#c4bdb2" }}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: "#6b6357" }}>Delete?</span>
            <button
              onClick={deleteItem}
              className="text-xs px-2 py-1 rounded-md"
              style={{ backgroundColor: "#dc2626", color: "#fff" }}
            >
              Yes
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-xs px-2 py-1 rounded-md"
              style={{ backgroundColor: "#f6f3ec", color: "#6b6357", border: "1px solid #d8d2c4" }}
            >
              No
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SecondBrainPage() {
  const [items, setItems]                         = useState<KnowledgeItem[]>([])
  const [loading, setLoading]                     = useState(true)
  const [viewMode, setViewMode]                   = useState<"grid" | "list">("grid")
  const [selectedId, setSelectedId]               = useState<string | null>(null)
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

  // Find matched chunk for selected item (when in search mode)
  const selectedSearchChunk = selectedId && searchResults
    ? searchResults.find((r) => r.item_id === selectedId)?.chunk_content ?? null
    : null

  const handleIngest = async () => {
    setIngestError("")
    setIngesting(true)
    try {
      const tags = captureTags.split(",").map((t) => t.trim()).filter(Boolean)
      let item: KnowledgeItem
      if (captureTab === "url") {
        item = await apiPost<KnowledgeItem>("/second-brain/ingest/url", { url: captureUrl.trim(), personal_note: captureNote, tags, domain: captureDomain })
      } else {
        item = await apiPost<KnowledgeItem>("/second-brain/ingest/text", { content: captureText.trim(), title: captureTitle.trim(), personal_note: captureNote, tags, domain: captureDomain })
      }
      setItems((prev) => [item, ...prev])
      setShowCapture(false)
      setCaptureUrl(""); setCaptureText(""); setCaptureTitle(""); setCaptureNote(""); setCaptureTags("")
    } catch (e: unknown) {
      setIngestError(e instanceof Error ? e.message : "Ingest failed")
    } finally { setIngesting(false) }
  }

  // JSX variable (not a component) — avoids "create component during render" lint error
  const sidebarContent = (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-semibold text-lg" style={{ color: "#1a1714", fontFamily: "var(--font-heading), serif" }}>Domains</h2>
        <span className="text-xs" style={{ color: "#948a7b" }}>{items.length} items</span>
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
                backgroundColor: isActive ? "#e3ede9" : "transparent",
                color: isActive ? "#2d5a4f" : "#1a1714",
                fontWeight: isActive ? 500 : 400,
                borderLeft: isActive ? "2px solid #2d5a4f" : "2px solid transparent",
              }}
            >
              <span>{domain === "All" ? "All Items" : domain}</span>
              <span style={{ color: isActive ? "#2d5a4f" : "#948a7b" }}>{count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas relative">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col w-52 shrink-0 border-r" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
        {sidebarContent}
      </div>

      {/* Mobile sidebar overlay */}
      {isMobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0" style={{ backgroundColor: "rgba(26,23,20,0.2)" }} onClick={() => setMobileSidebar(false)} />
          <div className="relative w-72 max-w-[80%] h-full shadow-xl flex flex-col" style={{ backgroundColor: "#fbfaf6" }}>
            <button onClick={() => setMobileSidebar(false)} className="absolute top-4 right-4 p-2" style={{ color: "#948a7b" }}><X size={20} /></button>
            {sidebarContent}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden transition-all ${selectedId ? "lg:mr-0" : ""}`}>
        {/* Header */}
        <div className="p-5 border-b shrink-0" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button className="md:hidden p-2 -ml-2 rounded-md" style={{ color: "#948a7b" }} onClick={() => setMobileSidebar(true)}>
                  <Menu size={20} />
                </button>
                <h1 className="font-semibold text-xl" style={{ color: "#1a1714", fontFamily: "var(--font-heading), serif" }}>
                  {query ? "Search Results" : selectedDomain === "All" ? "Second Brain" : selectedDomain}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 p-1 rounded-lg" style={{ backgroundColor: "#efeadf", border: "1px solid #d8d2c4" }}>
                  <button onClick={() => setViewMode("grid")} className="p-1.5 rounded-md transition-colors" style={{ backgroundColor: viewMode === "grid" ? "#fff" : "transparent", color: viewMode === "grid" ? "#1a1714" : "#948a7b" }}><LayoutGrid size={15} /></button>
                  <button onClick={() => setViewMode("list")} className="p-1.5 rounded-md transition-colors" style={{ backgroundColor: viewMode === "list" ? "#fff" : "transparent", color: viewMode === "list" ? "#1a1714" : "#948a7b" }}><ListIcon size={15} /></button>
                </div>
                <button
                  onClick={() => setShowCapture(true)}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium"
                  style={{ backgroundColor: "#2d5a4f", color: "#fff" }}
                >
                  <Plus size={15} /> Capture
                </button>
              </div>
            </div>

            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "#948a7b" }} />
              {searching && <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin" style={{ color: "#948a7b" }} />}
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Semantic search across all knowledge…"
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none transition-shadow focus:ring-1"
                style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
              />
            </div>
          </div>
        </div>

        {/* Items grid/list */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className={`max-w-4xl mx-auto ${viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" : "space-y-2"}`}>
            {loading ? (
              <div className="col-span-full py-16 flex justify-center">
                <Loader2 size={22} className="animate-spin" style={{ color: "#948a7b" }} />
              </div>
            ) : displayItems.length === 0 ? (
              <div className="col-span-full py-16 text-center text-sm" style={{ color: "#948a7b" }}>
                {query ? "No items matched that search." : "Nothing here yet — hit Capture to add your first item."}
              </div>
            ) : displayItems.map((item) => {
              const isSelected = selectedId === item.id
              const matchedChunk = searchResults?.find((r) => r.item_id === item.id)?.chunk_content

              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedId(isSelected ? null : item.id)}
                  className={`group cursor-pointer rounded-xl p-3.5 transition-all ${viewMode === "list" ? "flex items-center gap-4" : "flex flex-col min-h-[120px]"}`}
                  style={{
                    backgroundColor: isSelected ? "#e3ede9" : "#fff",
                    border: `1px solid ${isSelected ? "rgba(45,90,79,0.4)" : "#e8e2d4"}`,
                    outline: isSelected ? "1px solid rgba(45,90,79,0.3)" : "none",
                  }}
                >
                  {/* Type + date */}
                  <div className={`flex items-center justify-between ${viewMode === "list" ? "w-40 shrink-0" : "mb-2"}`}>
                    <div className="flex items-center gap-1.5" style={{ color: "#948a7b" }}>
                      <TypeIcon type={item.type} size={12} />
                      <span className="text-[10px] uppercase tracking-wider font-medium">{item.domain ?? typeLabel(item.type)}</span>
                    </div>
                    <span className="text-[10px]" style={{ color: "#c4bdb2" }}>
                      {new Date(item.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>

                  {/* Title + summary */}
                  <div className={`${viewMode === "list" ? "flex-1 min-w-0" : "flex-1"}`}>
                    <h3
                      className="font-medium text-sm leading-snug mb-1 transition-colors"
                      style={{ color: isSelected ? "#2d5a4f" : "#1a1714", fontFamily: "var(--font-heading), serif" }}
                    >
                      {item.source_title ?? item.url ?? "Note"}
                    </h3>
                    {/* Show matched chunk in search mode, else summary */}
                    <p
                      className={`text-xs leading-relaxed ${viewMode === "list" ? "truncate" : "line-clamp-2"}`}
                      style={{ color: matchedChunk ? "#6b5c00" : "#948a7b" }}
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
                        <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: "#f6f3ec", color: "#948a7b" }}>#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Detail panel */}
      {selectedId && (
        <>
          {/* Mobile: full-screen overlay */}
          <div
            className="lg:hidden fixed inset-0 z-40"
            style={{ backgroundColor: "rgba(26,23,20,0.3)" }}
            onClick={() => setSelectedId(null)}
          />
          <div
            className="fixed inset-y-0 right-0 z-50 w-[85vw] max-w-sm lg:relative lg:inset-auto lg:z-auto lg:w-[360px] flex flex-col shrink-0 border-l"
            style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
          >
            <DetailPanel
              itemId={selectedId}
              onClose={() => setSelectedId(null)}
              onDeleted={(id) => {
                setItems((prev) => prev.filter((i) => i.id !== id))
                setSelectedId(null)
              }}
              onUpdated={(updated) => {
                setItems((prev) => prev.map((i) => i.id === updated.id ? { ...i, ...updated } : i))
              }}
              searchChunk={selectedSearchChunk}
            />
          </div>
        </>
      )}

      {/* Quick Capture modal */}
      {showCapture && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(26,23,20,0.3)", backdropFilter: "blur(4px)" }}>
          <div className="rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d4" }}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-semibold text-lg" style={{ color: "#1a1714", fontFamily: "var(--font-heading), serif" }}>Quick Capture</h2>
              <button onClick={() => { setShowCapture(false); setIngestError("") }} className="p-1.5 rounded-md" style={{ color: "#948a7b" }}><X size={18} /></button>
            </div>

            <div className="flex gap-1 p-1 rounded-xl mb-4" style={{ backgroundColor: "#f6f3ec" }}>
              {(["url", "text"] as CaptureTab[]).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setCaptureTab(tab)}
                  className="flex-1 py-1.5 text-sm rounded-lg transition-colors font-medium"
                  style={{
                    backgroundColor: captureTab === tab ? "#fff" : "transparent",
                    color: captureTab === tab ? "#1a1714" : "#948a7b",
                    boxShadow: captureTab === tab ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
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
                className="w-full text-sm px-3 py-2.5 rounded-lg outline-none mb-3"
                style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                autoFocus
              />
            ) : (
              <>
                <input
                  type="text"
                  value={captureTitle}
                  onChange={(e) => setCaptureTitle(e.target.value)}
                  placeholder="Title (optional)"
                  className="w-full text-sm px-3 py-2.5 rounded-lg outline-none mb-2"
                  style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                />
                <textarea
                  value={captureText}
                  onChange={(e) => setCaptureText(e.target.value)}
                  placeholder="Your note or content…"
                  className="w-full h-28 text-sm px-3 py-2.5 rounded-lg outline-none resize-none mb-3"
                  style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                  autoFocus
                />
              </>
            )}

            <textarea
              value={captureNote}
              onChange={(e) => setCaptureNote(e.target.value)}
              placeholder="Personal annotation (optional)"
              className="w-full h-16 text-sm px-3 py-2 rounded-lg outline-none resize-none mb-3"
              style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
            />

            <div className="flex gap-2 mb-4">
              <input
                type="text"
                value={captureTags}
                onChange={(e) => setCaptureTags(e.target.value)}
                placeholder="Tags (comma separated)"
                className="flex-1 text-sm px-3 py-2 rounded-lg outline-none"
                style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
              />
              <select
                className="text-sm px-2 py-2 rounded-lg outline-none"
                style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                value={captureDomain}
                onChange={(e) => setCaptureDomain(e.target.value)}
              >
                {DOMAINS.map((d) => <option key={d}>{d}</option>)}
              </select>
            </div>

            {ingestError && <p className="text-sm mb-3" style={{ color: "#dc2626" }}>{ingestError}</p>}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowCapture(false); setIngestError("") }}
                className="text-sm px-4 py-2 rounded-lg"
                style={{ color: "#6b6357", backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4" }}
              >
                Cancel
              </button>
              <button
                onClick={handleIngest}
                disabled={ingesting || (captureTab === "url" ? !captureUrl.trim() : !captureText.trim())}
                className="text-sm px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-40"
                style={{ backgroundColor: "#2d5a4f", color: "#fff" }}
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
