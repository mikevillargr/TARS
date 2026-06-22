"use client"

import { useState, useCallback } from "react"
import { X, Rss, Search, Plus, ExternalLink, Loader2, ChevronRight } from "lucide-react"
import { apiPost, apiGet } from "@/lib/api-client"

interface PreviewItem {
  title: string
  url: string
  summary: string
  published_at: string | null
}

interface PreviewResult {
  name: string
  feed_url: string
  source_type: string
  favicon_url: string | null
  items: PreviewItem[]
}

interface DiscoverResult {
  feed_url: string
  name: string
  description: string | null
  subscribers: number | null
  icon_url: string | null
  website_url: string | null
}

interface PresetPack {
  id: string
  label: string
  icon: string
  feeds: { name: string; url: string }[]
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
  const [tab, setTab] = useState<"url" | "discover" | "presets">("url")

  // URL tab
  const [urlInput, setUrlInput] = useState("")
  const [category, setCategory] = useState("")
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState("")
  const [addingUrl, setAddingUrl] = useState(false)

  // Discover tab
  const [discoverQuery, setDiscoverQuery] = useState("")
  const [discoverResults, setDiscoverResults] = useState<DiscoverResult[]>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [discoverError, setDiscoverError] = useState("")
  const [addingFeed, setAddingFeed] = useState<string | null>(null)
  const [addFeedError, setAddFeedError] = useState<Record<string, string>>({})

  // Presets tab
  const [presets, setPresets] = useState<PresetPack[]>([])
  const [presetsLoaded, setPresetsLoaded] = useState(false)
  const [enablingPack, setEnablingPack] = useState<string | null>(null)

  const allCategories = Array.from(new Set([...existingCategories, ...SUGGESTED_CATEGORIES]))

  async function handlePreview() {
    if (!urlInput.trim()) return
    setPreviewLoading(true)
    setPreviewError("")
    setPreview(null)
    try {
      const data = await apiPost<PreviewResult>("/feed/sources/preview", { url: urlInput.trim() })
      setPreview(data)
    } catch (e: unknown) {
      setPreviewError(e instanceof Error ? e.message : "Could not read feed from that URL")
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleAddUrl() {
    if (!preview) return
    setAddingUrl(true)
    try {
      await apiPost("/feed/sources", {
        url: urlInput.trim(),
        name: preview.name,
        category: category.trim() || undefined,
      })
      onAdded()
      onClose()
    } catch {
      setPreviewError("Failed to add feed")
    } finally {
      setAddingUrl(false)
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
    setAddingFeed(result.feed_url)
    setAddFeedError((prev) => ({ ...prev, [result.feed_url]: "" }))
    try {
      await apiPost("/feed/sources", {
        url: result.feed_url,
        name: result.name,
        source_type: "rss",
        favicon_url: result.icon_url || undefined,
        category: category.trim() || undefined,
      })
      onAdded()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to add feed"
      setAddFeedError((prev) => ({ ...prev, [result.feed_url]: msg }))
    } finally {
      setAddingFeed(null)
    }
  }

  const loadPresets = useCallback(async () => {
    if (presetsLoaded) return
    try {
      const data = await apiGet<PresetPack[]>("/feed/presets")
      setPresets(data)
      setPresetsLoaded(true)
    } catch {
      setPresetsLoaded(true)
    }
  }, [presetsLoaded])

  async function handleEnablePack(packId: string) {
    setEnablingPack(packId)
    try {
      await apiPost(`/feed/presets/${packId}/enable`, {})
      onAdded()
    } catch {
      // ignore
    } finally {
      setEnablingPack(null)
    }
  }

  function handleTabChange(t: "url" | "discover" | "presets") {
    setTab(t)
    if (t === "presets") loadPresets()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        className="relative flex flex-col w-full max-w-xl rounded-xl border border-[var(--c-border)] shadow-2xl"
        style={{ background: "var(--c-canvas)", maxHeight: "80vh" }}
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
          {(["url", "discover", "presets"] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={`tars-label px-3 py-2.5 border-b-2 transition-colors ${
                tab === t
                  ? "border-[var(--moss)] text-[var(--moss)]"
                  : "border-transparent text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
              }`}
            >
              {t === "url" ? "PASTE URL" : t === "discover" ? "DISCOVER" : "PRESETS"}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {tab === "url" && (
            <div className="space-y-4">
              <div>
                <label className="tars-label mb-1.5 block">URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => { setUrlInput(e.target.value); setPreview(null) }}
                    onKeyDown={(e) => e.key === "Enter" && handlePreview()}
                    placeholder="RSS feed, website, YouTube channel, Reddit, Google News…"
                    className="flex-1 px-3 py-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] text-sm text-[var(--c-ink)] placeholder:text-[var(--c-ink-faint)] outline-none focus:border-[var(--moss)] transition-colors"
                  />
                  <button
                    onClick={handlePreview}
                    disabled={!urlInput.trim() || previewLoading}
                    className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
                    style={{ background: "var(--c-surface-raised)", color: "var(--c-ink)" }}
                  >
                    {previewLoading ? <Loader2 size={14} className="animate-spin" /> : "Preview"}
                  </button>
                </div>
                {previewError && (
                  <p className="mt-1.5 text-xs text-rose-500">{previewError}</p>
                )}
              </div>

              {preview && (
                <div className="rounded-lg border border-[var(--c-border)] overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3 bg-[var(--c-surface)]">
                    {preview.favicon_url && (
                      <img src={preview.favicon_url} alt="" className="w-4 h-4 rounded" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--c-ink)] truncate">{preview.name}</p>
                      <p className="tars-label text-[var(--c-ink-faint)]">{preview.source_type.toUpperCase()} · {preview.items.length} items previewed</p>
                    </div>
                  </div>
                  {preview.items.slice(0, 3).map((item, i) => (
                    <div key={i} className="px-4 py-2.5 border-t border-[var(--c-border)]">
                      <p className="text-sm text-[var(--c-ink)] truncate">{item.title}</p>
                      {item.summary && (
                        <p className="text-xs text-[var(--c-ink-faint)] truncate mt-0.5">{item.summary}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}

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
                onClick={handleAddUrl}
                disabled={!preview || addingUrl}
                className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ background: "var(--moss)", color: "var(--c-surface)" }}
              >
                {addingUrl ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Add Feed
              </button>
            </div>
          )}

          {tab === "discover" && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--c-ink-faint)]" />
                  <input
                    type="text"
                    value={discoverQuery}
                    onChange={(e) => setDiscoverQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleDiscover()}
                    placeholder="Search feeds — digital marketing, cycling, AI news…"
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--c-border)] bg-[var(--c-surface)] text-sm text-[var(--c-ink)] placeholder:text-[var(--c-ink-faint)] outline-none focus:border-[var(--moss)] transition-colors"
                  />
                </div>
                <button
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
                <div className="space-y-1">
                  {discoverResults.map((result) => (
                    <div
                      key={result.feed_url}
                      className="flex items-start gap-3 p-3 rounded-lg border border-[var(--c-border)] hover:border-[var(--moss)]/40 transition-colors"
                      style={{ background: "var(--c-surface)" }}
                    >
                      {result.icon_url ? (
                        <img src={result.icon_url} alt="" className="w-6 h-6 rounded mt-0.5 shrink-0" />
                      ) : (
                        <div className="w-6 h-6 rounded bg-[var(--c-surface-raised)] shrink-0 mt-0.5 flex items-center justify-center">
                          <Rss size={12} className="text-[var(--c-ink-faint)]" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-[var(--c-ink)] truncate">{result.name}</p>
                          <button
                            onClick={() => handleAddDiscovered(result)}
                            disabled={addingFeed === result.feed_url}
                            className="shrink-0 flex items-center gap-1 tars-label px-2.5 py-1 rounded-md transition-colors disabled:opacity-40"
                            style={{ background: "var(--moss)", color: "var(--c-surface)" }}
                          >
                            {addingFeed === result.feed_url
                              ? <Loader2 size={11} className="animate-spin" />
                              : <Plus size={11} />
                            }
                            ADD
                          </button>
                        </div>
                        {result.description && (
                          <p className="text-xs text-[var(--c-ink-faint)] truncate mt-0.5">{result.description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1">
                          {result.subscribers && (
                            <span className="tars-label text-[var(--c-ink-faint)]">
                              {result.subscribers.toLocaleString()} subscribers
                            </span>
                          )}
                          {result.website_url && (
                            <a
                              href={result.website_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="tars-label text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] flex items-center gap-0.5"
                            >
                              <ExternalLink size={9} />
                              site
                            </a>
                          )}
                        </div>
                        {addFeedError[result.feed_url] && (
                          <p className="text-xs text-rose-400 mt-1">{addFeedError[result.feed_url]}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : discoverError ? (
                <div className="p-4 rounded-lg border border-rose-500/30 bg-rose-500/5">
                  <p className="text-sm text-rose-400">{discoverError}</p>
                  {discoverError.includes("API key") && (
                    <p className="text-xs text-[var(--c-ink-faint)] mt-2">
                      Get a free key at <span className="font-mono">developer.feedly.com</span> and add{" "}
                      <span className="font-mono">FEEDLY_API_KEY=…</span> to the harness <span className="font-mono">.env</span> file.
                    </p>
                  )}
                </div>
              ) : discoverQuery && !discoverLoading ? (
                <div className="text-center py-8">
                  <p className="tars-label text-[var(--c-ink-faint)]">NO RESULTS — TRY A DIFFERENT QUERY</p>
                  <p className="text-xs text-[var(--c-ink-faint)] mt-1">Or add a URL manually in the "Paste URL" tab</p>
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

          {tab === "presets" && (
            <div className="space-y-3">
              <p className="text-xs text-[var(--c-ink-faint)]">
                Add a curated pack of industry feeds with one click.
              </p>
              {!presetsLoaded ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-[var(--c-ink-faint)]" />
                </div>
              ) : presets.length === 0 ? (
                <p className="tars-label text-[var(--c-ink-faint)] text-center py-8">NO PRESETS AVAILABLE</p>
              ) : (
                presets.map((pack) => (
                  <div
                    key={pack.id}
                    className="flex items-center gap-4 p-4 rounded-lg border border-[var(--c-border)]"
                    style={{ background: "var(--c-surface)" }}
                  >
                    <span className="text-2xl shrink-0">{pack.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--c-ink)]">{pack.label}</p>
                      <p className="tars-label text-[var(--c-ink-faint)]">{pack.feeds.length} FEEDS</p>
                    </div>
                    <button
                      onClick={() => handleEnablePack(pack.id)}
                      disabled={enablingPack === pack.id}
                      className="flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md transition-colors disabled:opacity-40"
                      style={{ background: "var(--moss)", color: "var(--c-surface)" }}
                    >
                      {enablingPack === pack.id
                        ? <Loader2 size={11} className="animate-spin" />
                        : <ChevronRight size={11} />
                      }
                      ADD ALL
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
