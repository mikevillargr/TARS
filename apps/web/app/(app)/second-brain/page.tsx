"use client"

import { useEffect, useState } from "react"
import { Search, Plus, Trash2, Link, FileText, ExternalLink, BookOpen } from "lucide-react"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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

const DOMAIN_COLORS: Record<string, string> = {
  work: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  personal: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  research: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  client: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
}

function ItemTypeIcon({ type }: { type: string }) {
  if (type === "url") return <Link size={14} className="text-muted-foreground shrink-0" />
  return <FileText size={14} className="text-muted-foreground shrink-0" />
}

function ItemCard({ item, onDelete }: { item: KnowledgeItem; onDelete: (id: string) => void }) {
  const domainColor = item.domain ? (DOMAIN_COLORS[item.domain] ?? "bg-zinc-500/20 text-zinc-400 border-zinc-500/30") : null

  return (
    <div className="group rounded-lg border border-border bg-card p-4 flex flex-col gap-2 hover:border-border/80 transition-colors">
      <div className="flex items-start gap-3">
        <ItemTypeIcon type={item.type} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {item.source_title ?? (item.url ? new URL(item.url).hostname : "Untitled")}
            </p>
            <div className="flex items-center gap-1 shrink-0">
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-accent text-muted-foreground"
                >
                  <ExternalLink size={12} />
                </a>
              )}
              <button
                onClick={() => onDelete(item.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
          {item.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
              {item.summary}
            </p>
          )}
          {item.personal_note && (
            <p className="text-xs text-amber-400/80 mt-1 italic line-clamp-1">
              Note: {item.personal_note}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {domainColor && (
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${domainColor}`}>
            {item.domain}
          </span>
        )}
        {item.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
            {tag}
          </span>
        ))}
        <span className="text-xs text-muted-foreground ml-auto">
          {new Date(item.saved_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
    </div>
  )
}

function SearchResultCard({ result }: { result: SearchResult }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <ItemTypeIcon type={result.item_type} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground truncate">
              {result.item_title ?? "Untitled"}
            </p>
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          {result.chunk_content && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed line-clamp-3">
              {result.chunk_content}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function CaptureUrlForm({ onSuccess }: { onSuccess: () => void }) {
  const [url, setUrl] = useState("")
  const [note, setNote] = useState("")
  const [tags, setTags] = useState("")
  const [domain, setDomain] = useState("work")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handle() {
    if (!url.trim()) return
    setLoading(true)
    setError("")
    try {
      await apiPost("/second-brain/ingest/url", {
        url: url.trim(),
        personal_note: note,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        domain,
      })
      setUrl("")
      setNote("")
      setTags("")
      onSuccess()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to ingest URL")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="https://..."
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <Textarea
        placeholder="Personal note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="resize-none"
      />
      <Input
        placeholder="Tags (comma-separated)"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <Select value={domain} onValueChange={(v) => v && setDomain(v)}>
        <SelectTrigger>
          <SelectValue placeholder="Domain" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="work">Work</SelectItem>
          <SelectItem value="personal">Personal</SelectItem>
          <SelectItem value="research">Research</SelectItem>
          <SelectItem value="client">Client</SelectItem>
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button onClick={handle} disabled={loading || !url.trim()}>
          {loading ? "Fetching & ingesting…" : "Save URL"}
        </Button>
      </div>
    </div>
  )
}

function CaptureNoteForm({ onSuccess }: { onSuccess: () => void }) {
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [note, setNote] = useState("")
  const [tags, setTags] = useState("")
  const [domain, setDomain] = useState("work")
  const [loading, setLoading] = useState(false)

  async function handle() {
    if (!content.trim()) return
    setLoading(true)
    try {
      await apiPost("/second-brain/ingest/text", {
        content: content.trim(),
        title: title.trim(),
        personal_note: note,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        domain,
      })
      setTitle("")
      setContent("")
      setNote("")
      setTags("")
      onSuccess()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <Textarea
        placeholder="Paste text, notes, or anything you want to remember…"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        className="resize-none"
      />
      <Textarea
        placeholder="Personal note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        className="resize-none"
      />
      <Input
        placeholder="Tags (comma-separated)"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <Select value={domain} onValueChange={(v) => v && setDomain(v)}>
        <SelectTrigger>
          <SelectValue placeholder="Domain" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="work">Work</SelectItem>
          <SelectItem value="personal">Personal</SelectItem>
          <SelectItem value="research">Research</SelectItem>
          <SelectItem value="client">Client</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex justify-end">
        <Button onClick={handle} disabled={loading || !content.trim()}>
          {loading ? "Saving…" : "Save note"}
        </Button>
      </div>
    </div>
  )
}

export default function SecondBrainPage() {
  const [items, setItems] = useState<KnowledgeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [captureOpen, setCaptureOpen] = useState(false)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    try {
      const data = await apiGet<KnowledgeItem[]>("/second-brain/items")
      setItems(data)
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const data = await apiPost<SearchResult[]>("/second-brain/search", {
        query: searchQuery,
        limit: 10,
      })
      setSearchResults(data)
    } finally {
      setSearching(false)
    }
  }

  async function handleDelete(id: string) {
    await apiDelete(`/second-brain/items/${id}`)
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  function onCaptureSuccess() {
    setCaptureOpen(false)
    load()
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen size={18} className="text-muted-foreground" />
          <h1 className="text-lg font-semibold text-foreground">Second Brain</h1>
          {!loading && !searchResults && (
            <span className="text-sm text-muted-foreground">{items.length} items</span>
          )}
        </div>
        <Dialog open={captureOpen} onOpenChange={setCaptureOpen}>
          <DialogTrigger render={<Button size="sm" className="gap-1.5" />}>
            <Plus size={14} />
            Quick Capture
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Quick Capture</DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="url" className="mt-2">
              <TabsList className="w-full">
                <TabsTrigger value="url" className="flex-1">
                  <Link size={13} className="mr-1.5" />
                  URL
                </TabsTrigger>
                <TabsTrigger value="note" className="flex-1">
                  <FileText size={13} className="mr-1.5" />
                  Note
                </TabsTrigger>
              </TabsList>
              <TabsContent value="url" className="mt-4">
                <CaptureUrlForm onSuccess={onCaptureSuccess} />
              </TabsContent>
              <TabsContent value="note" className="mt-4">
                <CaptureNoteForm onSuccess={onCaptureSuccess} />
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search your knowledge semantically…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="outline" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </Button>
          {searchResults !== null && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSearchResults(null)
                setSearchQuery("")
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {searchResults !== null ? (
          <>
            <p className="text-xs text-muted-foreground mb-3">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for &ldquo;{searchQuery}&rdquo;
            </p>
            {searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2 text-center">
                <p className="text-muted-foreground">Nothing matched your search</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {searchResults.map((r) => (
                  <SearchResultCard key={r.item_id} result={r} />
                ))}
              </div>
            )}
          </>
        ) : loading ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
            <BookOpen size={40} className="text-muted-foreground/40" />
            <div>
              <p className="text-muted-foreground font-medium">Your second brain is empty</p>
              <p className="text-sm text-muted-foreground/60 mt-1">
                Save URLs, notes, and documents — TARS will recall them when relevant.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="mt-2 gap-1.5"
              onClick={() => setCaptureOpen(true)}
            >
              <Plus size={13} />
              Add your first item
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
