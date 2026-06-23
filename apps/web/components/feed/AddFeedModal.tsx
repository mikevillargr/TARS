"use client"

import { useState } from "react"
import { X, Rss, Search, Plus, Loader2, Check } from "lucide-react"
import { apiPost, apiGet } from "@/lib/api-client"

interface DiscoverResult {
  feed_url: string
  name: string
  description: string | null
  subscribers: number | null
  icon_url: string | null
  website_url: string | null
}

interface AddFeedModalProps {
  existingCategories: string[]
  onClose: () => void
  onAdded: () => void
}

const SUGGESTED_CATEGORIES = [
  "Tech", "AI", "Marketing", "Cycling", "Business", "Design",
  "Philippines", "Podcasts", "Finance", "Science",
]

export default function AddFeedModal({ existingCategories, onClose, onAdded }: AddFeedModalProps) {
  const [tab, setTab] = useState<"url" | "discover">("url")

  // URL tab — single-step, no separate Preview gate
  const [urlInput, setUrlInput] = useState("")
  const [category, setCategory] = useState("")
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState("")
  const [addDone, setAddDone] = useState(false)

  // Discover tab
  const [discoverQuery, setDiscoverQuery] = useState("")
  const [discoverResults, setDiscoverResults] = useState<DiscoverResult[]>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverError, setDiscoverError] = useState("")
  const [feedState, setFeedState] = useState<Record<string, "adding" | "done" | string>>({})

  const allCategories = Array.from(new Set([...existingCategories, ...SUGGESTED_CATEGORIES]))

  async function handleAdd() {
    const url = urlInput.trim()
    if (!url || adding || addDone) return
    setAdding(true)
    setAddError("")
    try {
      await apiPost("/feed/sources", { url, category: category.trim() || undefined })
      setAddDone(true)
      onAdded()
      setTimeout(onClose, 800)
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Could not add — check the URL and try again")
    } finally {
      setAdding(false)
    }
  }

  async function handleDiscover() {
    if (!discoverQuery.trim()) return
    setDiscoverLoading(true)
    setDiscoverError("")
    setDiscoverResults([])
    try {
      const data = await apiGet<DiscoverResult[]>(`/feed/discover?q=${encodeURIComponent(discoverQuery.trim())}`)
      setDiscoverResults(data)
    } catch (e: unknown) {
      setDiscoverError(e instanceof Error ? e.message : "Feed search unavailable")
    } finally {
      setDiscoverLoading(false)
    }
  }

  async function handleAddDiscovered(result: DiscoverResult) {
    const key = result.feed_url
    if (feedState[key] === "adding" || feedState[key] === "done") return
    setFeedState((prev) => ({ ...prev, [key]: "adding" }))
    try {
      await apiPost("/feed/sources", {
        url: result.feed_url,
        name: result.name,
        source_type: "rss",
        favicon_url: result.icon_url || undefined,
        category: category.trim() || undefined,
      })
      setFeedState((prev) => ({ ...prev, [key]: "done" }))
      onAdded()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add"
      setFeedState((prev) => ({ ...prev, [key]: msg }))
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="relative flex flex-col w-full max-w-xl rounded-xl border border-[var(--c-border)] shadow-2xl"
        style={{ background: "var(--c-canvas)", maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--c-border)]">
          <div className="flex items-center gap-2">
            <Rss size={15} className="text-[var(--moss)]" />
            <span className="tars-title">Add Feed</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] hover:bg-[var(--c-surface)] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--c-border)] px-5">
          {(["url", "discover"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`tars-label px-3 py-2.5 border-b-2 transition-colors ${
                tab === t
                  ? "border-[var(--moss)] text-[var(--moss)]"
                  : "border-transparent text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
              }`}
            >
              {t === "url" ? "PASTE URL" : "DISCOVER"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">

          {/* ── URL tab ── */}
          {tab === "url" && (
            <div className="space-y-4">
              <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>
                Paste any URL — RSS feed, website, YouTube channel, Reddit, or Google News topic.
                TARS auto-discovers the feed.
              </p>

              <div>
                <label className="tars-label mb-1.5 block">URL</label>
                <input
                  type="url"
                  value={urlInput}
                  autoFocus
                  onChange={(e) => { setUrlInput(e.target.value); setAddError(""); setAddDone(false) }}
                  onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                  placeholder="https://example.com  or  https://example.com/feed"
                  className="w-full px-3 py-2.5 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] text-sm text-[var(--c-ink)] placeholder:text-[var(--c-ink-faint)] outline-none focus:border-[var(--moss)] transition-colors"
                />
                {addError && (
                  <p className="mt-1.5 text-xs text-rose-500">{addError}</p>
                )}
              </div>

              <div>
                <label className="tars-label mb-1.5 block">CATEGORY (OPTIONAL)</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Tech, Cycling, Marketing…"
                  list="category-suggestions"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] text-sm text-[var(--c-ink)] placeholder:text-[var(--c-ink-faint)] outline-none focus:border-[var(--moss)] transition-colors"
                />
                <datalist id="category-suggestions">
                  {allCategories.map((c) => <option key={c} value={c} />)}
                </datalist>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {SUGGESTED_CATEGORIES.slice(0, 6).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCategory(c)}
                      className={`tars-label px-2 py-1 rounded transition-colors ${
                        category === c
                          ? "bg-[var(--moss)]/20 text-[var(--moss)]"
                          : "bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleAdd}
                disabled={!urlInput.trim() || adding || addDone}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                  padding: "10px 0",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: !urlInput.trim() || adding || addDone ? "default" : "pointer",
                  opacity: !urlInput.trim() ? 0.4 : 1,
                  background: addDone ? "#5a7a3a" : "#5a7a3a",
                  color: "#ffffff",
                  border: "none",
                  transition: "opacity 0.15s",
                }}
              >
                {adding ? (
                  <><Loader2 size={14} className="animate-spin" />Finding & adding feed…</>
                ) : addDone ? (
                  <><Check size={14} />Added!</>
                ) : (
                  <><Plus size={14} />Add Feed</>
                )}
              </button>
            </div>
          )}

          {/* ── Discover tab ── */}
          {tab === "discover" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-ink-faint)]" />
                  <input
                    type="text"
                    value={discoverQuery}
                    autoFocus={tab === "discover"}
                    onChange={(e) => setDiscoverQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
                    placeholder="digital marketing, cycling, AI news…"
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] text-sm text-[var(--c-ink)] placeholder:text-[var(--c-ink-faint)] outline-none focus:border-[var(--moss)] transition-colors"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleDiscover}
                  disabled={!discoverQuery.trim() || discoverLoading}
                  className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40 transition-colors"
                  style={{ background: "var(--c-surface-raised)", color: "var(--c-ink)" }}
                >
                  {discoverLoading ? <Loader2 size={14} className="animate-spin" /> : "Search"}
                </button>
              </div>

              <div>
                <label className="tars-label mb-1.5 block">CATEGORY FOR NEW FEEDS (OPTIONAL)</label>
                <input
                  type="text"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="e.g. Tech, Marketing…"
                  list="category-suggestions-2"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] text-sm text-[var(--c-ink)] placeholder:text-[var(--c-ink-faint)] outline-none focus:border-[var(--moss)] transition-colors"
                />
                <datalist id="category-suggestions-2">
                  {allCategories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>

              {discoverResults.length > 0 ? (
                <div className="space-y-2">
                  {discoverResults.map((result) => {
                    const st = feedState[result.feed_url]
                    const isAdding = st === "adding"
                    const isDone = st === "done"
                    const isError = st && st !== "adding" && st !== "done"
                    return (
                      <div
                        key={result.feed_url}
                        className="rounded-lg border p-3"
                        style={{
                          background: isDone ? "rgba(90,122,58,0.08)" : isError ? "rgba(239,68,68,0.05)" : "var(--c-surface)",
                          borderColor: isDone ? "rgba(90,122,58,0.4)" : isError ? "rgba(239,68,68,0.3)" : "var(--c-border)",
                        }}
                      >
                        <div className="flex items-start gap-2 mb-2">
                          {result.icon_url ? (
                            <img src={result.icon_url} alt="" className="w-5 h-5 rounded mt-0.5 shrink-0" />
                          ) : (
                            <div className="w-5 h-5 rounded shrink-0 mt-0.5 flex items-center justify-center" style={{ background: "var(--c-surface-raised)" }}>
                              <Rss size={10} className="text-[var(--c-ink-faint)]" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>{result.name}</p>
                            {isError ? (
                              <p className="text-xs text-rose-400 mt-0.5">{st}</p>
                            ) : result.description ? (
                              <p className="text-xs mt-0.5 line-clamp-2" style={{ color: "var(--c-ink-faint)" }}>{result.description}</p>
                            ) : null}
                            {result.subscribers && !isError && (
                              <p className="text-xs mt-0.5" style={{ fontFamily: "var(--font-mono)", color: "var(--c-ink-faint)" }}>
                                {result.subscribers.toLocaleString()} subscribers
                              </p>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleAddDiscovered(result)}
                          disabled={isAdding || isDone}
                          style={{
                            display: "flex", width: "100%", alignItems: "center", justifyContent: "center",
                            gap: "6px", padding: "6px 0", borderRadius: "6px",
                            fontSize: "11px", fontFamily: "var(--font-mono), monospace",
                            fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase",
                            cursor: isAdding || isDone ? "default" : "pointer",
                            opacity: isAdding ? 0.6 : 1,
                            background: isDone ? "#5a7a3a" : isError ? "rgba(239,68,68,0.15)" : "#5a7a3a",
                            color: isDone ? "#ffffff" : isError ? "#ef4444" : "#ffffff",
                            border: "none",
                          }}
                        >
                          {isAdding ? <Loader2 size={11} className="animate-spin" />
                            : isDone ? "✓ ADDED"
                            : isError ? "RETRY"
                            : <><Plus size={11} />ADD FEED</>}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ) : discoverError ? (
                <div className="p-4 rounded-lg border border-rose-500/30 bg-rose-500/5">
                  <p className="text-sm text-rose-400">{discoverError}</p>
                </div>
              ) : discoverQuery && !discoverLoading ? (
                <div className="text-center py-8">
                  <p className="tars-label text-[var(--c-ink-faint)]">NO RESULTS — TRY A DIFFERENT QUERY</p>
                  <p className="text-xs text-[var(--c-ink-faint)] mt-1">Or paste the URL directly in the &quot;Paste URL&quot; tab</p>
                </div>
              ) : !discoverQuery ? (
                <div className="text-center py-8">
                  <Search size={20} className="mx-auto text-[var(--c-ink-faint)] mb-2" />
                  <p className="tars-label text-[var(--c-ink-faint)]">SEARCH MILLIONS OF FEEDS</p>
                  <p className="text-xs text-[var(--c-ink-faint)] mt-1">Powered by Feedly feed index</p>
                </div>
              ) : null}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
