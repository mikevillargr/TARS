"use client"

import { useEffect, useState } from "react"
import { Search, Plus, Trash2, Star, Brain } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { apiGet, apiPost, apiDelete } from "@/lib/api-client"

interface Memory {
  id: string
  content: string
  domain: string
  source: string
  importance: number
  created_at: string
  updated_at: string
}

const DOMAIN_COLORS: Record<string, string> = {
  work: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  personal: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  health: "bg-green-500/20 text-green-400 border-green-500/30",
  cycling: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  client: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
}

const SOURCE_LABELS: Record<string, string> = {
  conversation: "Chat",
  meeting: "Meeting",
  email: "Email",
  manual: "Manual",
}

function ImportanceStars({ value }: { value: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={12}
          className={i < value ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}
        />
      ))}
    </div>
  )
}

function MemoryCard({ memory, onDelete }: { memory: Memory; onDelete: (id: string) => void }) {
  const domainColor = DOMAIN_COLORS[memory.domain] ?? "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
  const sourceLabel = SOURCE_LABELS[memory.source] ?? memory.source

  return (
    <div className="group rounded-lg border border-border bg-card p-4 flex flex-col gap-2 hover:border-border/80 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-foreground leading-relaxed flex-1">{memory.content}</p>
        <button
          onClick={() => onDelete(memory.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${domainColor}`}>
          {memory.domain}
        </span>
        <span className="text-xs text-muted-foreground">{sourceLabel}</span>
        <ImportanceStars value={memory.importance} />
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(memory.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </span>
      </div>
    </div>
  )
}

export default function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [isSearchResults, setIsSearchResults] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newContent, setNewContent] = useState("")
  const [newDomain, setNewDomain] = useState("work")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await apiGet<Memory[]>("/memory/memories")
      setMemories(data)
      setIsSearchResults(false)
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) {
      load()
      return
    }
    setSearching(true)
    try {
      const data = await apiPost<Memory[]>("/memory/search", {
        query: searchQuery,
        limit: 20,
      })
      setMemories(data)
      setIsSearchResults(true)
    } finally {
      setSearching(false)
    }
  }

  async function handleDelete(id: string) {
    await apiDelete(`/memory/memories/${id}`)
    setMemories((prev) => prev.filter((m) => m.id !== id))
  }

  async function handleAdd() {
    if (!newContent.trim()) return
    setSaving(true)
    try {
      const mem = await apiPost<Memory>("/memory/memories", {
        content: newContent,
        domain: newDomain,
        source: "manual",
        importance: 3,
      })
      setMemories((prev) => [mem, ...prev])
      setNewContent("")
      setNewDomain("work")
      setAddOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">Memory</h1>
          {!loading && (
            <span className="text-sm text-muted-foreground">
              {isSearchResults ? `${memories.length} results` : `${memories.length} memories`}
            </span>
          )}
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5">
              <Plus size={14} />
              Add memory
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add memory</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 mt-2">
              <Textarea
                placeholder="What should TARS remember?"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={4}
                className="resize-none"
              />
              <Select value={newDomain} onValueChange={setNewDomain}>
                <SelectTrigger>
                  <SelectValue placeholder="Domain" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="work">Work</SelectItem>
                  <SelectItem value="personal">Personal</SelectItem>
                  <SelectItem value="health">Health</SelectItem>
                  <SelectItem value="cycling">Cycling</SelectItem>
                  <SelectItem value="client">Client</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAdd} disabled={saving || !newContent.trim()}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search memories semantically…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </Button>
          {isSearchResults && (
            <Button type="button" variant="ghost" onClick={load}>
              Clear
            </Button>
          )}
        </form>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <Brain size={40} className="text-muted-foreground/40" />
            <div>
              <p className="text-muted-foreground font-medium">
                {isSearchResults ? "No memories matched your search" : "No memories yet"}
              </p>
              {!isSearchResults && (
                <p className="text-sm text-muted-foreground/60 mt-1">
                  TARS saves memories from conversations automatically. You can also add them manually.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {memories.map((m) => (
              <MemoryCard key={m.id} memory={m} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
