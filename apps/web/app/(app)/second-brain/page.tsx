"use client"

import { useState } from "react"
import {
  Search, Filter, LayoutGrid, List as ListIcon,
  Link as LinkIcon, FileText, File, Plus, Menu, X,
} from "lucide-react"
import { MOCK_SECOND_BRAIN } from "@/lib/mock-ui-data"

const COLLECTIONS = ["All Items", "Bike Builds", "Client Research", "Health & Rehab", "Dev Resources"]

type Item = typeof MOCK_SECOND_BRAIN[number]

function TypeIcon({ type }: { type: string }) {
  if (type === "url") return <LinkIcon size={14} />
  if (type === "note") return <FileText size={14} />
  return <File size={14} />
}

export default function SecondBrainPage() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [selectedCollection, setSelectedCollection] = useState("All Items")
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<Item | null>(null)
  const [query, setQuery] = useState("")

  const filteredItems = MOCK_SECOND_BRAIN.filter((item) => {
    const inCollection = selectedCollection === "All Items" || item.collection === selectedCollection
    const matchesQuery = !query.trim() || item.title.toLowerCase().includes(query.toLowerCase()) || item.excerpt.toLowerCase().includes(query.toLowerCase())
    return inCollection && matchesQuery
  })

  const SidebarContent = () => (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-semibold text-lg text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>Collections</h2>
        <span className="text-xs text-ink-muted">{MOCK_SECOND_BRAIN.length} items</span>
      </div>

      <div className="space-y-1 flex-1">
        {COLLECTIONS.map((collection) => {
          const count = collection === "All Items"
            ? MOCK_SECOND_BRAIN.length
            : MOCK_SECOND_BRAIN.filter((i) => i.collection === collection).length
          const isActive = selectedCollection === collection
          return (
            <button
              key={collection}
              onClick={() => { setSelectedCollection(collection); setIsMobileSidebarOpen(false) }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-moss-soft text-moss font-medium"
                  : "text-ink hover:bg-surface-2"
              }`}
              style={{ borderLeft: isActive ? "2px solid #2d5a4f" : "2px solid transparent" }}
            >
              <span>{collection}</span>
              <span className={isActive ? "text-moss/70" : "text-ink-muted"}>{count}</span>
            </button>
          )
        })}
      </div>

      <button className="btn-ghost w-full flex items-center justify-center gap-2 mt-4 py-2 border border-dashed border-border-faint text-sm">
        <Plus size={16} /> New Collection
      </button>
    </div>
  )

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas relative">
      {/* Desktop sidebar */}
      <div className="hidden md:flex flex-col w-64 shrink-0 border-r border-border bg-surface">
        <SidebarContent />
      </div>

      {/* Mobile sidebar overlay */}
      {isMobileSidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-ink/20 backdrop-blur-sm" onClick={() => setIsMobileSidebarOpen(false)} />
          <div className="relative w-72 max-w-[80%] bg-surface h-full shadow-xl flex flex-col">
            <button onClick={() => setIsMobileSidebarOpen(false)} className="absolute top-4 right-4 p-2 text-ink-muted hover:text-ink">
              <X size={20} />
            </button>
            <SidebarContent />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-border bg-surface shrink-0">
          <div className="max-w-4xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  className="md:hidden p-2 -ml-2 text-ink-muted hover:text-ink rounded-md hover:bg-surface-2"
                  onClick={() => setIsMobileSidebarOpen(true)}
                >
                  <Menu size={20} />
                </button>
                <h1 className="font-semibold text-2xl text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>
                  {selectedCollection}
                </h1>
              </div>
              <div className="flex items-center gap-2 bg-surface-2 p-1 rounded-md border border-border-faint">
                <button onClick={() => setViewMode("grid")} className={`p-1.5 rounded ${viewMode === "grid" ? "bg-surface shadow-sm" : "text-ink-muted"}`}>
                  <LayoutGrid size={16} />
                </button>
                <button onClick={() => setViewMode("list")} className={`p-1.5 rounded ${viewMode === "list" ? "bg-surface shadow-sm" : "text-ink-muted"}`}>
                  <ListIcon size={16} />
                </button>
              </div>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Semantic search across all knowledge..."
                  className="w-full bg-canvas border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-moss focus:ring-1 focus:ring-moss"
                />
              </div>
              <button className="btn-secondary flex items-center gap-2">
                <Filter size={16} /> <span className="hidden sm:inline">Filters</span>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className={`max-w-6xl mx-auto ${viewMode === "grid" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4" : "space-y-3"}`}>
            {filteredItems.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedItem(prev => prev?.id === item.id ? null : item)}
                className={`card cursor-pointer group hover:border-moss/50 transition-colors ${viewMode === "list" ? "flex items-center gap-4 p-3" : "flex flex-col h-48"}`}
                style={{ outline: selectedItem?.id === item.id ? "2px solid #2d5a4f" : "none", outlineOffset: "1px" }}
              >
                <div className={`flex items-start justify-between ${viewMode === "list" ? "w-48 shrink-0" : "mb-3"}`}>
                  <div className="flex items-center gap-2 text-ink-muted">
                    <TypeIcon type={item.type} />
                    <span className="text-[10px] uppercase tracking-wider font-medium">{item.domain}</span>
                  </div>
                  <span className="text-xs text-ink-faint">
                    {new Date(item.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                </div>

                <div className={viewMode === "list" ? "flex-1 min-w-0" : "flex-1"}>
                  <h3 className="font-medium text-base leading-tight mb-2 group-hover:text-moss transition-colors truncate" style={{ fontFamily: "var(--font-heading), serif" }}>
                    {item.title}
                  </h3>
                  <p className={`text-sm text-ink-muted ${viewMode === "grid" ? "line-clamp-3" : "truncate"}`}>
                    {item.excerpt}
                  </p>
                </div>

                <div className={`flex gap-1 overflow-hidden ${viewMode === "list" ? "w-32 shrink-0 justify-end" : "mt-auto pt-3"}`}>
                  {item.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="text-[10px] text-ink-muted bg-surface-2 px-1.5 py-0.5 rounded">#{tag}</span>
                  ))}
                </div>
              </div>
            ))}

            {filteredItems.length === 0 && (
              <div className="col-span-full py-12 text-center text-ink-muted">No items found in this collection.</div>
            )}
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
            <button
              onClick={() => setSelectedItem(null)}
              className="p-1 rounded-md"
              style={{ color: "#6b6357" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <h2 className="font-semibold text-base text-[#1a1714] leading-snug" style={{ fontFamily: "var(--font-heading), serif" }}>
              {selectedItem.title}
            </h2>

            {selectedItem.url && (
              <a href={selectedItem.url} className="text-sm break-all" style={{ color: "#2d5a4f" }}>
                {selectedItem.url}
              </a>
            )}

            <div className="flex flex-wrap gap-2">
              <span className="badge badge-neutral bg-surface-2">{selectedItem.domain}</span>
              <span className="badge badge-neutral bg-surface-2">{selectedItem.collection}</span>
              {selectedItem.tags.map((tag) => (
                <span key={tag} className="badge badge-neutral text-xs">#{tag}</span>
              ))}
            </div>

            <div className="pt-3 border-t" style={{ borderColor: "#e8e2d4" }}>
              <h3 className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Content / Excerpt</h3>
              <p className="text-sm leading-relaxed text-[#1a1714]">{selectedItem.excerpt}</p>
            </div>

            <div className="pt-3 border-t" style={{ borderColor: "#e8e2d4" }}>
              <h3 className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2">Personal Annotation</h3>
              <textarea
                className="input-field w-full h-24 text-sm resize-none"
                placeholder="Add your thoughts..."
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
