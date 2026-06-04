"use client"

import { useState, useEffect, useCallback } from "react"
import { Database, Search, Trash2, Zap, Plus, X, ChevronDown } from "lucide-react"
import { apiGet, apiPost, apiDelete } from "@/lib/api-client"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useDomains } from "@/hooks/useDomains"

interface Memory {
  id: string
  content: string
  domain: string
  source: string
  importance: number
  created_at: string
  updated_at: string
}

interface MemoryListResponse {
  items: Memory[]
  total: number
  limit: number
  offset: number
}

const SOURCES = ["All", "conversation", "meeting", "email", "manual"]
const PAGE_SIZE = 100

export default function MemoryPage() {
  const confirm = useConfirm()
  const { domains: domainList } = useDomains()
  const [memories, setMemories]           = useState<Memory[]>([])
  const [total, setTotal]                 = useState(0)
  const [offset, setOffset]               = useState(0)
  const [loading, setLoading]             = useState(true)
  const [loadingMore, setLoadingMore]     = useState(false)
  const [domainFilter, setDomainFilter]   = useState("All")
  const [sourceFilter, setSourceFilter]   = useState("All")
  const [sortBy, setSortBy]               = useState<"date" | "importance">("date")
  const [query, setQuery]                 = useState("")
  const [searching, setSearching]         = useState(false)
  const [showAdd, setShowAdd]             = useState(false)
  const [addContent, setAddContent]       = useState("")
  const [addDomain, setAddDomain]         = useState("work")
  const [addImportance, setAddImportance] = useState(3)
  const [saving, setSaving]               = useState(false)

  const buildUrl = useCallback((off: number) => {
    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(off),
    })
    if (domainFilter !== "All") params.set("domain", domainFilter)
    if (sourceFilter !== "All") params.set("source", sourceFilter)
    return `/memory/memories?${params}`
  }, [domainFilter, sourceFilter])

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<MemoryListResponse>(buildUrl(0))
      setMemories(data.items)
      setTotal(data.total)
      setOffset(0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [buildUrl])

  const loadMore = async () => {
    const nextOffset = offset + PAGE_SIZE
    setLoadingMore(true)
    try {
      const data = await apiGet<MemoryListResponse>(buildUrl(nextOffset))
      setMemories(prev => [...prev, ...data.items])
      setTotal(data.total)
      setOffset(nextOffset)
    } catch (e) {
      console.error(e)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => { loadAll() }, [loadAll])

  // Debounced semantic search
  useEffect(() => {
    if (!query.trim()) { loadAll(); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await apiPost<Memory[]>("/memory/memories/search", { query: query.trim(), limit: 50 })
        setMemories(data)
        setTotal(data.length)
        setOffset(0)
      } catch (e) {
        console.error(e)
      } finally {
        setSearching(false)
      }
    }, 400)
    return () => clearTimeout(t)
  }, [query, loadAll])

  const handleDelete = async (id: string) => {
    const mem = memories.find((m) => m.id === id)
    const ok = await confirm({
      title: "Delete memory?",
      description: mem?.content
        ? `"${mem.content.slice(0, 100)}${mem.content.length > 100 ? "…" : ""}" will be permanently removed.`
        : "This memory will be permanently removed.",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!ok) return
    await apiDelete(`/memory/memories/${id}`)
    setMemories((prev) => prev.filter((m) => m.id !== id))
    setTotal(prev => prev - 1)
  }

  const handleAdd = async () => {
    if (!addContent.trim()) return
    setSaving(true)
    try {
      const mem = await apiPost<Memory>("/memory/memories", {
        content: addContent.trim(),
        domain: addDomain,
        source: "manual",
        importance: addImportance,
      })
      setMemories((prev) => [mem, ...prev])
      setTotal(prev => prev + 1)
      setAddContent("")
      setShowAdd(false)
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  const filtered = memories
    .filter((m) => {
      // When not searching, domain/source filters are applied server-side.
      // When searching, apply client-side since search returns flat array.
      if (query.trim()) {
        if (domainFilter !== "All" && m.domain !== domainFilter) return false
        if (sourceFilter !== "All" && m.source !== sourceFilter) return false
      }
      return true
    })
    .sort((a, b) =>
      sortBy === "importance"
        ? b.importance - a.importance
        : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )

  const hasMore = !query.trim() && memories.length < total

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-canvas">
      {/* Header */}
      <div className="px-6 py-5 border-b bg-surface shrink-0" style={{ borderColor: "var(--c-border)" }}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="font-semibold text-2xl flex items-center gap-2" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>
                <Database size={22} className="text-moss" /> Memory Browser
              </h1>
              {!loading && (
                <p className="text-xs mt-1" style={{ color: "var(--c-ink-faint)" }}>
                  {query.trim()
                    ? `${filtered.length} result${filtered.length !== 1 ? "s" : ""} for "${query.trim()}"`
                    : `${total.toLocaleString()} memor${total !== 1 ? "ies" : "y"} total${memories.length < total ? ` · showing ${memories.length}` : ""}`
                  }
                </p>
              )}
            </div>
            <button onClick={() => setShowAdd(true)} className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={16} /> Add Memory
            </button>
          </div>

          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            {searching && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">searching…</span>}
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Semantic search across memories…"
              className="w-full bg-canvas border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-moss focus:ring-1 focus:ring-moss"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              className="input-field py-1.5 text-xs bg-canvas"
              value={domainFilter}
              onChange={(e) => { setDomainFilter(e.target.value); setOffset(0) }}
            >
              <option value="All">Domain: All</option>
              {domainList.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
            <select
              className="input-field py-1.5 text-xs bg-canvas"
              value={sourceFilter}
              onChange={(e) => { setSourceFilter(e.target.value); setOffset(0) }}
            >
              {SOURCES.map((s) => <option key={s} value={s}>{s === "All" ? "Source: All" : s}</option>)}
            </select>
            <button
              className="btn-ghost text-xs border border-border bg-canvas px-3 py-1.5"
              onClick={() => setSortBy(sortBy === "date" ? "importance" : "date")}
            >
              Sort: {sortBy === "date" ? "Date" : "Importance"}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {loading ? (
            <p className="text-center py-12 text-ink-muted text-sm">Loading memories…</p>
          ) : filtered.length === 0 ? (
            <p className="text-center py-12 text-ink-muted text-sm">
              {query ? "No memories matched that search." : "No memories yet. TARS will build this up from your conversations."}
            </p>
          ) : (
            <>
              {filtered.map((mem) => (
                <div key={mem.id} className="card group">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex gap-2">
                      <span className="badge badge-neutral bg-surface-2 flex items-center gap-1">
                        {(() => { const dc = domainList.find(d => d.name === mem.domain); return dc ? <span className="rounded-full inline-block shrink-0" style={{ width: 6, height: 6, backgroundColor: dc.color }} /> : null })()}
                        {mem.domain}
                      </span>
                      <span className="text-[10px] text-ink-faint uppercase tracking-wider font-medium pt-0.5">
                        {mem.source}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--c-amber)" }}>
                        <Zap size={12} style={{ fill: "var(--c-amber)" }} /> {mem.importance}/5
                      </div>
                      <button
                        onClick={() => handleDelete(mem.id)}
                        className="p-1 rounded transition-colors"
                        style={{ color: "var(--c-ink-faint)" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-rose-soft)"; (e.currentTarget as HTMLElement).style.color = "var(--c-rose)" }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed text-ink">{mem.content}</p>
                  <div className="mt-3 text-[10px] text-ink-faint">
                    {new Date(mem.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}

              {/* Load more */}
              {hasMore && (
                <div className="text-center pt-2 pb-6">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="btn-ghost text-sm flex items-center gap-2 mx-auto border border-border px-4 py-2 disabled:opacity-40"
                  >
                    {loadingMore ? (
                      "Loading…"
                    ) : (
                      <>
                        <ChevronDown size={15} />
                        Load more ({total - memories.length} remaining)
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Add Memory modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 backdrop-blur-sm">
          <div className="bg-surface rounded-xl shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-lg" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>Add Memory</h2>
              <button onClick={() => setShowAdd(false)} className="p-1 text-ink-muted hover:text-ink"><X size={18} /></button>
            </div>
            <textarea
              value={addContent}
              onChange={(e) => setAddContent(e.target.value)}
              placeholder="What should TARS remember?"
              className="input-field w-full h-28 text-sm resize-none mb-4"
              autoFocus
            />
            <div className="flex gap-3 mb-4">
              <select className="input-field text-sm flex-1" value={addDomain} onChange={(e) => setAddDomain(e.target.value)}>
                {domainList.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
              <div className="flex items-center gap-2 text-sm text-ink-muted">
                <span>Importance</span>
                <input
                  type="number" min={1} max={5} value={addImportance}
                  onChange={(e) => setAddImportance(Number(e.target.value))}
                  className="input-field w-16 text-center"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="btn-ghost text-sm">Cancel</button>
              <button onClick={handleAdd} disabled={saving || !addContent.trim()} className="btn-primary text-sm disabled:opacity-40">
                {saving ? "Saving…" : "Save Memory"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
