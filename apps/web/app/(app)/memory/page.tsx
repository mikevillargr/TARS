"use client"

import { useState } from "react"
import { Database, Search, Edit2, Trash2, Zap, Plus } from "lucide-react"
import { MOCK_MEMORIES } from "@/lib/mock-ui-data"

const DOMAINS = ["All", "Work", "Personal", "Cycling", "Client", "Health"]
const SOURCES = ["All", "Chat", "Meeting", "Email", "Second Brain", "Manual"]

export default function MemoryPage() {
  const [domainFilter, setDomainFilter] = useState("All")
  const [sourceFilter, setSourceFilter] = useState("All")
  const [importanceFilter, setImportanceFilter] = useState("All")
  const [sortBy, setSortBy] = useState<"Date" | "Importance">("Date")
  const [query, setQuery] = useState("")

  const filtered = MOCK_MEMORIES.filter((mem) => {
    if (domainFilter !== "All" && mem.domain !== domainFilter) return false
    if (sourceFilter !== "All" && mem.source !== sourceFilter) return false
    if (importanceFilter === "High (7+)" && mem.importance < 7) return false
    if (importanceFilter === "Critical (9+)" && mem.importance < 9) return false
    if (query.trim() && !mem.content.toLowerCase().includes(query.toLowerCase())) return false
    return true
  }).sort((a, b) => {
    if (sortBy === "Importance") return b.importance - a.importance
    return new Date(b.date).getTime() - new Date(a.date).getTime()
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-canvas">
      {/* Header */}
      <div className="px-6 py-5 border-b bg-surface shrink-0" style={{ borderColor: "#d8d2c4" }}>
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <h1 className="font-semibold text-2xl flex items-center gap-2 text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>
              <Database size={22} className="text-moss" /> Memory Browser
            </h1>
            <button className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={16} /> Add Memory
            </button>
          </div>

          <div className="relative mb-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search what the AI knows about you..."
              className="w-full bg-canvas border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-moss focus:ring-1 focus:ring-moss"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <select
              className="input-field py-1.5 text-xs bg-canvas"
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
            >
              {DOMAINS.map((d) => <option key={d} value={d}>{d === "All" ? "Domain: All" : d}</option>)}
            </select>

            <select
              className="input-field py-1.5 text-xs bg-canvas"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              {SOURCES.map((s) => <option key={s} value={s}>{s === "All" ? "Source: All" : s}</option>)}
            </select>

            <select
              className="input-field py-1.5 text-xs bg-canvas"
              value={importanceFilter}
              onChange={(e) => setImportanceFilter(e.target.value)}
            >
              <option value="All">Importance: All</option>
              <option value="High (7+)">High (7+)</option>
              <option value="Critical (9+)">Critical (9+)</option>
            </select>

            <button
              className="btn-ghost text-xs border border-border bg-canvas px-3 py-1.5"
              onClick={() => setSortBy(sortBy === "Date" ? "Importance" : "Date")}
            >
              Sort by: {sortBy}
            </button>
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {filtered.map((memory) => (
            <div key={memory.id} className="card group">
              <div className="flex justify-between items-start mb-2">
                <div className="flex gap-2">
                  <span className="badge badge-neutral bg-surface-2">{memory.domain}</span>
                  <span className="text-[10px] text-ink-faint uppercase tracking-wider font-medium pt-0.5">
                    From: {memory.source}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 text-xs font-medium" style={{ color: "#b8651a" }}>
                    <Zap size={12} style={{ fill: "#b8651a" }} /> {memory.importance}/10
                  </div>
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    <button className="p-1 text-ink-muted hover:text-ink rounded hover:bg-surface-2">
                      <Edit2 size={14} />
                    </button>
                    <button
                      className="p-1 rounded text-ink-muted"
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "#f0dcdc"; (e.currentTarget as HTMLElement).style.color = "#a04848" }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ""; (e.currentTarget as HTMLElement).style.color = "" }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-ink">{memory.content}</p>
              <div className="mt-3 text-[10px] text-ink-faint">
                Learned on {new Date(memory.date).toLocaleDateString()}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-ink-muted text-sm">
              No memories found matching these filters.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
