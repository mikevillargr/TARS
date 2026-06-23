"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  Rss, Star, Play, Headphones, ExternalLink, Brain, MessageSquare,
  RefreshCw, Plus, ChevronDown, ChevronRight, Loader2, Check, ArrowLeft, Trash2,
  Pencil, LayoutList, LayoutGrid, X as XIcon, Search,
} from "lucide-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client"
import AddFeedModal from "@/components/feed/AddFeedModal"

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedSource {
  id: string
  name: string
  url: string
  source_type: string
  category: string | null
  favicon_url: string | null
  enabled: boolean
  fetch_interval_hours: number
  last_fetched_at: string | null
  error_count: number
  unread_count: number
  created_at: string
}

interface FeedItem {
  id: string
  feed_source_id: string
  title: string
  url: string
  author: string | null
  summary: string | null
  image_url: string | null
  published_at: string | null
  media_type: "article" | "video" | "podcast" | "link"
  media_url: string | null
  is_read: boolean
  is_starred: boolean
  knowledge_item_id: string | null
  source_name: string
  source_favicon: string | null
}

interface FeedItemDetail extends FeedItem {
  content: string | null
}

interface CategoryOut {
  category: string | null
  total_count: number
  unread_count: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string | null): string {
  if (!dateStr) return ""
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function MediaTypeIcon({ type }: { type: FeedItem["media_type"] }) {
  if (type === "video") return <Play size={11} className="text-amber-500" />
  if (type === "podcast") return <Headphones size={11} className="text-purple-400" />
  if (type === "link") return <ExternalLink size={11} className="text-[var(--c-ink-faint)]" />
  return null
}

// ─── Article row ──────────────────────────────────────────────────────────────

function ArticleRow({
  item,
  selected,
  onClick,
  onStar,
}: {
  item: FeedItem
  selected: boolean
  onClick: () => void
  onStar: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-stretch gap-0 relative group ${
        selected ? "bg-[var(--c-surface-raised)]" : "hover:bg-[var(--c-surface)]"
      } transition-colors`}
    >
      {/* Unread bar */}
      <div
        className="w-0.5 shrink-0 self-stretch"
        style={{ background: !item.is_read ? "var(--moss)" : "transparent" }}
      />

      {/* Text content */}
      <div className="flex-1 min-w-0 px-3 py-3">
        <div className="flex items-center gap-1.5 mb-1">
          {item.source_favicon && (
            <img src={item.source_favicon} alt="" className="w-3.5 h-3.5 rounded" />
          )}
          <span className="tars-label text-[var(--c-ink-faint)] truncate">{item.source_name}</span>
          {item.published_at && (
            <>
              <span className="tars-label text-[var(--c-ink-faint)]">·</span>
              <span className="tars-label text-[var(--c-ink-faint)]">{relativeTime(item.published_at)}</span>
            </>
          )}
          {item.media_type !== "article" && (
            <span className="ml-auto shrink-0">
              <MediaTypeIcon type={item.media_type} />
            </span>
          )}
        </div>
        <p
          className={`text-sm leading-snug line-clamp-2 ${
            item.is_read ? "text-[var(--c-ink-faint)]" : "text-[var(--c-ink)] font-medium"
          }`}
        >
          {item.title}
        </p>
        {item.summary && (
          <p className="text-xs text-[var(--c-ink-faint)] line-clamp-1 mt-0.5 md:hidden">{item.summary}</p>
        )}
      </div>

      {/* Thumbnail — mobile only, right side (Apple News style) */}
      {item.image_url && (
        <div className="md:hidden shrink-0 self-center mr-3 w-[68px] h-[68px] rounded-lg overflow-hidden bg-[var(--c-surface)]">
          <img src={item.image_url} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Star on hover — desktop */}
      <button
        onClick={(e) => { e.stopPropagation(); onStar() }}
        className={`hidden md:flex shrink-0 self-center pr-3 opacity-0 group-hover:opacity-100 transition-all ${
          item.is_starred ? "!opacity-100" : ""
        }`}
        aria-label="Star"
      >
        <Star
          size={13}
          className={item.is_starred ? "fill-amber-400 text-amber-400" : "text-[var(--c-ink-faint)]"}
        />
      </button>

      {/* Star — always visible on mobile if starred */}
      {item.is_starred && (
        <button
          onClick={(e) => { e.stopPropagation(); onStar() }}
          className="md:hidden shrink-0 self-center pr-2"
          aria-label="Star"
        >
          <Star size={12} className="fill-amber-400 text-amber-400" />
        </button>
      )}
    </button>
  )
}

// ─── Article card (grid view) ────────────────────────────────────────────────

function ArticleCard({
  item,
  selected,
  onClick,
  onStar,
}: {
  item: FeedItem
  selected: boolean
  onClick: () => void
  onStar: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`relative group w-full text-left flex flex-col rounded-lg border overflow-hidden transition-colors ${
        selected ? "border-[var(--moss)]/60" : "border-[var(--c-border)] hover:border-[var(--c-ink-faint)]"
      }`}
      style={{ background: selected ? "var(--c-surface)" : "var(--c-canvas)" }}
    >
      {/* Unread dot */}
      {!item.is_read && (
        <div
          className="absolute top-2 left-2 w-2 h-2 rounded-full z-10"
          style={{ background: "var(--moss)" }}
        />
      )}

      {/* Thumbnail */}
      <div className="w-full aspect-video bg-[var(--c-surface)] overflow-hidden shrink-0 flex items-center justify-center">
        {item.image_url ? (
          <img src={item.image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 opacity-30">
            {item.source_favicon
              ? <img src={item.source_favicon} alt="" className="w-6 h-6 rounded" />
              : <Rss size={18} />
            }
          </div>
        )}
        {item.media_type !== "article" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="rounded-full p-2" style={{ background: "rgba(0,0,0,0.45)" }}>
              <MediaTypeIcon type={item.media_type} />
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col p-3 gap-1.5 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {item.source_favicon && (
            <img src={item.source_favicon} alt="" className="w-3 h-3 rounded shrink-0" />
          )}
          <span className="tars-label text-[var(--c-ink-faint)] truncate flex-1">{item.source_name}</span>
          {item.published_at && (
            <span className="tars-label text-[var(--c-ink-faint)] shrink-0">{relativeTime(item.published_at)}</span>
          )}
        </div>
        <p className={`text-sm leading-snug line-clamp-2 ${item.is_read ? "text-[var(--c-ink-faint)]" : "text-[var(--c-ink)] font-medium"}`}>
          {item.title}
        </p>
        {item.summary && (
          <p className="text-xs text-[var(--c-ink-faint)] line-clamp-2 mt-0.5">{item.summary}</p>
        )}
      </div>

      {/* Star on hover */}
      <button
        onClick={(e) => { e.stopPropagation(); onStar() }}
        className={`absolute bottom-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-all ${
          item.is_starred ? "!opacity-100" : ""
        }`}
        style={{ background: "var(--c-surface)" }}
        aria-label="Star"
      >
        <Star
          size={11}
          className={item.is_starred ? "fill-amber-400 text-amber-400" : "text-[var(--c-ink-faint)]"}
        />
      </button>
    </button>
  )
}

// ─── Reading pane ─────────────────────────────────────────────────────────────

function ReadingPane({
  item,
  onStar,
  onSaveToSecondBrain,
  onChatWithTars,
  savingToBrain,
}: {
  item: FeedItemDetail | null
  onStar: () => void
  onSaveToSecondBrain: () => void
  onChatWithTars: () => void
  savingToBrain?: boolean
}) {
  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-8">
        <Rss size={24} className="text-[var(--c-ink-faint)]" />
        <span className="tars-label text-[var(--c-ink-faint)]">SELECT AN ARTICLE TO READ</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Article header */}
      <div className="px-6 pt-6 pb-4 border-b border-[var(--c-border)]">
        <h1 className="text-xl font-semibold text-[var(--c-ink)] leading-snug mb-2">
          {item.title}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          {item.source_favicon && (
            <img src={item.source_favicon} alt="" className="w-4 h-4 rounded" />
          )}
          <span className="tars-label text-[var(--c-ink-faint)]">{item.source_name}</span>
          {item.author && (
            <>
              <span className="tars-label text-[var(--c-ink-faint)]">·</span>
              <span className="tars-label text-[var(--c-ink-faint)]">{item.author}</span>
            </>
          )}
          {item.published_at && (
            <>
              <span className="tars-label text-[var(--c-ink-faint)]">·</span>
              <span className="tars-label text-[var(--c-ink-faint)]">{relativeTime(item.published_at)}</span>
            </>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {item.media_type === "video" && item.media_url && (
          <div className="relative mb-5 rounded-lg overflow-hidden" style={{ paddingTop: "56.25%" }}>
            <iframe
              src={item.media_url}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {item.media_type === "podcast" && item.media_url && (
          <div className="mb-5 p-4 rounded-lg border border-[var(--c-border)]" style={{ background: "var(--c-surface)" }}>
            <div className="flex items-center gap-2 mb-3">
              <Headphones size={14} className="text-purple-400" />
              <span className="tars-label text-purple-400">PODCAST</span>
            </div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={item.media_url} className="w-full" />
          </div>
        )}

        {item.media_type === "link" && (
          <div className="mb-5 p-5 rounded-lg border border-[var(--c-border)] flex items-center gap-4"
            style={{ background: "var(--c-surface)" }}
          >
            <ExternalLink size={16} className="text-[var(--c-ink-faint)] shrink-0" />
            <div>
              <p className="text-sm text-[var(--c-ink-faint)] mb-2">{item.summary || "No preview available."}</p>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="tars-label text-[var(--moss)] hover:underline"
              >
                OPEN LINK →
              </a>
            </div>
          </div>
        )}

        {item.image_url && item.media_type === "article" && (
          <img
            src={item.image_url}
            alt=""
            className="w-full rounded-lg mb-5 object-cover max-h-64"
          />
        )}

        {item.content ? (
          <div
            className="prose text-sm text-[var(--c-ink)] leading-relaxed [&_p]:mb-4 [&_p]:mt-0 [&_a]:text-[var(--moss)] [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mb-3 [&_h1]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h2]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mb-2 [&_h3]:mt-4 [&_ul]:mb-4 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:mb-4 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:mb-1 [&_img]:rounded-lg [&_img]:max-w-full [&_img]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--moss)] [&_blockquote]:pl-4 [&_blockquote]:text-[var(--c-ink-faint)] [&_blockquote]:my-4 [&_pre]:bg-[var(--c-surface)] [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:mb-4 [&_pre]:overflow-x-auto [&_code]:text-xs"
            dangerouslySetInnerHTML={{ __html: item.content }}
          />
        ) : item.summary ? (
          <p className="text-sm text-[var(--c-ink)] leading-relaxed">{item.summary}</p>
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-[var(--c-ink-faint)]">No content cached — open the original to read.</p>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="px-6 py-3 border-t border-[var(--c-border)] flex items-center gap-2 flex-wrap">
        <button
          onClick={onStar}
          className={`flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md transition-colors ${
            item.is_starred
              ? "bg-amber-400/15 text-amber-500"
              : "hover:bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
          }`}
        >
          <Star size={12} className={item.is_starred ? "fill-amber-400" : ""} />
          {item.is_starred ? "STARRED" : "STAR"}
        </button>

        <button
          onClick={onSaveToSecondBrain}
          disabled={!!item.knowledge_item_id || savingToBrain}
          className={`flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md transition-colors disabled:cursor-default ${
            item.knowledge_item_id
              ? "bg-[var(--moss)]/15 text-[var(--moss)]"
              : savingToBrain
              ? "text-[var(--c-ink-faint)]"
              : "hover:bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
          }`}
        >
          {item.knowledge_item_id
            ? <Check size={12} />
            : savingToBrain
            ? <Loader2 size={12} className="animate-spin" />
            : <Brain size={12} />
          }
          {item.knowledge_item_id ? "SAVED" : savingToBrain ? "SAVING…" : "SAVE TO BRAIN"}
        </button>

        <button
          onClick={onChatWithTars}
          className="flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md hover:bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors"
        >
          <MessageSquare size={12} />
          CHAT WITH TARS
        </button>

        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md hover:bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors"
        >
          <ExternalLink size={12} />
          OPEN ORIGINAL
        </a>
      </div>
    </div>
  )
}

// ─── Article modal (card view) ───────────────────────────────────────────────

function ArticleModal({
  item,
  loading,
  onClose,
  onStar,
  onSaveToSecondBrain,
  onChatWithTars,
  savingToBrain,
}: {
  item: FeedItemDetail | null
  loading: boolean
  onClose: () => void
  onStar: () => void
  onSaveToSecondBrain: () => void
  onChatWithTars: () => void
  savingToBrain?: boolean
}) {
  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col w-full max-w-3xl rounded-xl border border-[var(--c-border)] shadow-2xl overflow-hidden"
        style={{ background: "var(--c-canvas)", maxHeight: "90vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] hover:bg-[var(--c-surface)] transition-colors"
        >
          <XIcon size={15} />
        </button>

        {loading || !item ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={20} className="animate-spin text-[var(--c-ink-faint)]" />
          </div>
        ) : (
          <div className="flex flex-col h-full overflow-hidden" style={{ maxHeight: "90vh" }}>
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-[var(--c-border)] pr-12">
              <h1 className="text-xl font-semibold text-[var(--c-ink)] leading-snug mb-2">
                {item.title}
              </h1>
              <div className="flex items-center gap-2 flex-wrap">
                {item.source_favicon && (
                  <img src={item.source_favicon} alt="" className="w-4 h-4 rounded" />
                )}
                <span className="tars-label text-[var(--c-ink-faint)]">{item.source_name}</span>
                {item.author && (
                  <>
                    <span className="tars-label text-[var(--c-ink-faint)]">·</span>
                    <span className="tars-label text-[var(--c-ink-faint)]">{item.author}</span>
                  </>
                )}
                {item.published_at && (
                  <>
                    <span className="tars-label text-[var(--c-ink-faint)]">·</span>
                    <span className="tars-label text-[var(--c-ink-faint)]">{relativeTime(item.published_at)}</span>
                  </>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {item.media_type === "video" && item.media_url && (
                <div className="relative mb-5 rounded-lg overflow-hidden" style={{ paddingTop: "56.25%" }}>
                  <iframe
                    src={item.media_url}
                    className="absolute inset-0 w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}
              {item.media_type === "podcast" && item.media_url && (
                <div className="mb-5 p-4 rounded-lg border border-[var(--c-border)]" style={{ background: "var(--c-surface)" }}>
                  <div className="flex items-center gap-2 mb-3">
                    <Headphones size={14} className="text-purple-400" />
                    <span className="tars-label text-purple-400">PODCAST</span>
                  </div>
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <audio controls src={item.media_url} className="w-full" />
                </div>
              )}
              {item.media_type === "link" && (
                <div className="mb-5 p-5 rounded-lg border border-[var(--c-border)] flex items-center gap-4" style={{ background: "var(--c-surface)" }}>
                  <ExternalLink size={16} className="text-[var(--c-ink-faint)] shrink-0" />
                  <div>
                    <p className="text-sm text-[var(--c-ink-faint)] mb-2">{item.summary || "No preview available."}</p>
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="tars-label text-[var(--moss)] hover:underline">OPEN LINK →</a>
                  </div>
                </div>
              )}
              {item.image_url && item.media_type === "article" && (
                <img src={item.image_url} alt="" className="w-full rounded-lg mb-5 object-cover max-h-64" />
              )}
              {item.content ? (
                <div
                  className="prose text-sm text-[var(--c-ink)] leading-relaxed [&_a]:text-[var(--moss)] [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_img]:rounded-lg [&_img]:max-w-full [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--moss)] [&_blockquote]:pl-4 [&_blockquote]:text-[var(--c-ink-faint)]"
                  dangerouslySetInnerHTML={{ __html: item.content }}
                />
              ) : item.summary ? (
                <p className="text-sm text-[var(--c-ink)] leading-relaxed">{item.summary}</p>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-[var(--c-ink-faint)]">No content cached — open the original to read.</p>
                </div>
              )}
            </div>

            {/* Action bar */}
            <div className="px-6 py-3 border-t border-[var(--c-border)] flex items-center gap-2 flex-wrap">
              <button
                onClick={onStar}
                className={`flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md transition-colors ${
                  item.is_starred
                    ? "bg-amber-400/15 text-amber-500"
                    : "hover:bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
                }`}
              >
                <Star size={12} className={item.is_starred ? "fill-amber-400" : ""} />
                {item.is_starred ? "STARRED" : "STAR"}
              </button>
              <button
                onClick={onSaveToSecondBrain}
                disabled={!!item.knowledge_item_id || savingToBrain}
                className={`flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md transition-colors disabled:cursor-default ${
                  item.knowledge_item_id
                    ? "bg-[var(--moss)]/15 text-[var(--moss)]"
                    : savingToBrain
                    ? "text-[var(--c-ink-faint)]"
                    : "hover:bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
                }`}
              >
                {item.knowledge_item_id
                  ? <Check size={12} />
                  : savingToBrain
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Brain size={12} />
                }
                {item.knowledge_item_id ? "SAVED" : savingToBrain ? "SAVING…" : "SAVE TO BRAIN"}
              </button>
              <button
                onClick={onChatWithTars}
                className="flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md hover:bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors"
              >
                <MessageSquare size={12} />
                CHAT WITH TARS
              </button>
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md hover:bg-[var(--c-surface)] text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors"
              >
                <ExternalLink size={12} />
                OPEN ORIGINAL
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FeedPage() {
  const router = useRouter()

  // Data
  const [sources, setSources] = useState<FeedSource[]>([])
  const [categories, setCategories] = useState<CategoryOut[]>([])
  const [items, setItems] = useState<FeedItem[]>([])
  const [selectedItem, setSelectedItem] = useState<FeedItemDetail | null>(null)
  const [loadingItems, setLoadingItems] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [savingToBrain, setSavingToBrain] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const LIMIT = 50

  // Filters
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null)
  const [filter, setFilter] = useState<"unread" | "starred" | "all">("unread")
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // UI
  const [showAddModal, setShowAddModal] = useState(false)
  const [syncingSource, setSyncingSource] = useState<string | null>(null)
  const [mobilePanel, setMobilePanel] = useState<"list" | "reading">("list")
  const [viewMode, setViewMode] = useState<"list" | "cards">("list")
  const [articleModalOpen, setArticleModalOpen] = useState(false)

  // Resizable sidebar
  const [sidebarWidth, setSidebarWidth] = useState(208)
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)
  const sidebarWidthRef = useRef(208)
  const isMobileRef = useRef(false)

  // Search
  const [searchQuery, setSearchQuery] = useState("")
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Edit feed
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editCategory, setEditCategory] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)

  const loadCategories = useCallback(async () => {
    try {
      const data = await apiGet<CategoryOut[]>("/feed/categories")
      setCategories(data)
    } catch { /* ignore */ }
  }, [])

  const loadSources = useCallback(async () => {
    try {
      const data = await apiGet<FeedSource[]>("/feed/sources")
      setSources(data)
    } catch { /* ignore */ }
  }, [])

  const loadItems = useCallback(async (reset = false, searchOverride?: string) => {
    setLoadingItems(true)
    const currentOffset = reset ? 0 : offset
    const q = searchOverride !== undefined ? searchOverride : searchQuery
    try {
      const params = new URLSearchParams()
      if (activeCategory) params.set("category", activeCategory)
      if (activeSourceId) params.set("source_id", activeSourceId)
      if (filter === "unread") params.set("unread_only", "true")
      if (filter === "starred") params.set("starred", "true")
      if (q.trim()) params.set("search", q.trim())
      params.set("limit", String(LIMIT))
      params.set("offset", String(currentOffset))

      const data = await apiGet<FeedItem[]>(`/feed/items?${params.toString()}`)
      if (reset) {
        setItems(data)
        setOffset(data.length)
      } else {
        setItems((prev) => [...prev, ...data])
        setOffset(currentOffset + data.length)
      }
      setHasMore(data.length === LIMIT)
    } catch { /* ignore */ } finally {
      setLoadingItems(false)
    }
  }, [activeCategory, activeSourceId, filter, offset, searchQuery])

  // Initial load + restore prefs
  useEffect(() => {
    loadSources()
    loadCategories()
    // Mobile: force card view, track for modal behaviour
    isMobileRef.current = window.innerWidth < 768
    if (isMobileRef.current) {
      setViewMode("cards")
    }
    // Restore sidebar width
    const saved = localStorage.getItem("feed-sidebar-width")
    if (saved) {
      const w = parseInt(saved, 10)
      if (w >= 160 && w <= 360) {
        setSidebarWidth(w)
        sidebarWidthRef.current = w
      }
    }
  }, [loadSources, loadCategories])

  // Sidebar drag handlers
  function onSidebarDragStart(e: React.MouseEvent) {
    e.preventDefault()
    dragState.current = { startX: e.clientX, startWidth: sidebarWidthRef.current }

    function onMove(ev: MouseEvent) {
      if (!dragState.current) return
      const diff = ev.clientX - dragState.current.startX
      const next = Math.min(360, Math.max(160, dragState.current.startWidth + diff))
      sidebarWidthRef.current = next
      setSidebarWidth(next)
    }

    function onUp() {
      dragState.current = null
      localStorage.setItem("feed-sidebar-width", String(sidebarWidthRef.current))
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }

    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
  }

  // Reload items when filters change
  const filtersRef = useRef({ activeCategory, activeSourceId, filter, searchQuery })
  useEffect(() => {
    filtersRef.current = { activeCategory, activeSourceId, filter, searchQuery }
    loadItems(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCategory, activeSourceId, filter, searchQuery])

  async function handleSelectItem(item: FeedItem, forceModal = false) {
    const useModal = viewMode === "cards" || isMobileRef.current || forceModal
    if (selectedItem?.id === item.id && !forceModal) {
      if (useModal) setArticleModalOpen(true)
      return
    }
    setLoadingDetail(true)
    if (useModal) setArticleModalOpen(true)
    // Optimistic mark read
    if (!item.is_read) {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, is_read: true } : i))
      loadCategories()
    }
    try {
      const detail = await apiGet<FeedItemDetail>(`/feed/items/${item.id}`)
      setSelectedItem(detail)
      if (!useModal) setMobilePanel("reading")
    } catch { /* ignore */ } finally {
      setLoadingDetail(false)
    }
  }

  async function handleStar(itemId: string) {
    const item = items.find((i) => i.id === itemId) ?? (selectedItem?.id === itemId ? selectedItem : null)
    if (!item) return
    const newStarred = !item.is_starred
    setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, is_starred: newStarred } : i))
    if (selectedItem?.id === itemId) setSelectedItem((prev) => prev ? { ...prev, is_starred: newStarred } : prev)
    try {
      await apiPatch(`/feed/items/${itemId}`, { is_starred: newStarred })
    } catch {
      // revert
      setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, is_starred: !newStarred } : i))
      if (selectedItem?.id === itemId) setSelectedItem((prev) => prev ? { ...prev, is_starred: !newStarred } : prev)
    }
  }

  async function handleSaveToSecondBrain() {
    if (!selectedItem || selectedItem.knowledge_item_id || savingToBrain) return
    setSavingToBrain(true)
    try {
      const result = await apiPost<{ knowledge_item_id: string }>(`/feed/items/${selectedItem.id}/save`, {})
      setSelectedItem((prev) => prev ? { ...prev, knowledge_item_id: result.knowledge_item_id } : prev)
      setItems((prev) => prev.map((i) => i.id === selectedItem.id ? { ...i, knowledge_item_id: result.knowledge_item_id } : i))
    } catch {
      /* silent — button reverts automatically since setSavingToBrain(false) runs */
    } finally {
      setSavingToBrain(false)
    }
  }

  async function handleChatWithTars() {
    if (!selectedItem) return
    try {
      const { conversation_id } = await apiPost<{ conversation_id: string }>(
        `/feed/items/${selectedItem.id}/chat`,
        {}
      )
      router.push(`/chat/${conversation_id}`)
    } catch { /* ignore */ }
  }

  async function handleSync(sourceId: string) {
    setSyncingSource(sourceId)
    try {
      await apiPost(`/feed/sources/${sourceId}/sync`, {})
      await loadItems(true)
      await loadCategories()
    } catch { /* ignore */ } finally {
      setSyncingSource(null)
    }
  }

  function startEditSource(src: FeedSource) {
    setEditingSourceId(src.id)
    setEditName(src.name)
    setEditCategory(src.category ?? "")
  }

  async function handleSaveEdit(sourceId: string) {
    if (savingEdit) return
    setSavingEdit(true)
    try {
      await apiPatch(`/feed/sources/${sourceId}`, {
        name: editName.trim() || undefined,
        category: editCategory.trim() || null,
      })
      await loadSources()
      await loadCategories()
      setEditingSourceId(null)
    } catch { /* ignore */ } finally {
      setSavingEdit(false)
    }
  }

  async function handleDeleteSource(sourceId: string) {
    try {
      await apiDelete(`/feed/sources/${sourceId}`)
      if (activeSourceId === sourceId) { setActiveSourceId(null) }
      if (selectedItem?.feed_source_id === sourceId) { setSelectedItem(null) }
      await loadSources()
      await loadCategories()
      await loadItems(true)
    } catch { /* ignore */ }
  }

  async function handleMarkAllRead() {
    const params: Record<string, string> = {}
    if (activeCategory) params.category = activeCategory
    if (activeSourceId) params.source_id = activeSourceId
    try {
      await apiPost("/feed/items/mark-all-read", params)
      setItems((prev) => prev.map((i) => ({ ...i, is_read: true })))
      setSelectedItem((prev) => prev ? { ...prev, is_read: true } : prev)
      await loadCategories()
    } catch { /* ignore */ }
  }

  function handleFeedAdded() {
    loadSources()
    loadCategories()
    loadItems(true)
  }

  function handleSearchChange(value: string) {
    setSearchQuery(value)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    // loadItems fires via the useEffect that watches searchQuery
  }

  // Group sources by category for sidebar
  const sourcesByCategory = sources.reduce<Record<string, FeedSource[]>>((acc, s) => {
    const cat = s.category ?? "__uncategorized__"
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(s)
    return acc
  }, {})

  const totalUnread = categories.reduce((sum, c) => sum + c.unread_count, 0)
  const existingCategories = categories.map((c) => c.category).filter(Boolean) as string[]

  const isEmpty = sources.length === 0 && !loadingItems

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left Sidebar — desktop only ───────────────────────────────── */}
      <div
        className="hidden md:flex shrink-0 flex-col overflow-y-auto"
        style={{ background: "var(--c-canvas)", width: sidebarWidth, borderRight: "1px solid var(--c-border)" }}
      >
        <div className="px-4 pt-5 pb-3 flex items-center gap-2">
          <Rss size={13} className="text-[var(--moss)]" />
          <span className="tars-title">Feed</span>
          {totalUnread > 0 && (
            <span className="tars-label text-[var(--c-ink-faint)] ml-auto">{totalUnread}</span>
          )}
        </div>

        {/* Filter tabs */}
        <div className="px-2 pb-2 space-y-0.5">
          {(["unread", "all", "starred"] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setActiveCategory(null); setActiveSourceId(null) }}
              className={`w-full text-left px-2 py-1.5 rounded-md tars-label transition-colors ${
                filter === f && !activeCategory && !activeSourceId
                  ? "bg-[var(--c-surface-raised)] text-[var(--moss)]"
                  : "text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] hover:bg-[var(--c-surface)]"
              }`}
            >
              {f === "unread" ? `UNREAD · ${totalUnread}` : f === "all" ? "ALL" : "STARRED"}
            </button>
          ))}
        </div>

        {/* Categories + Sources */}
        {Object.keys(sourcesByCategory).length > 0 && (
          <div className="pt-2 pb-2">
            <div className="px-4 py-1">
              <span className="tars-label text-[var(--c-ink-faint)]">FEEDS</span>
            </div>
            {Object.entries(sourcesByCategory).map(([cat, catSources]) => {
              const catLabel = cat === "__uncategorized__" ? "Uncategorized" : cat
              const catUnread = categories.find((c) => (c.category ?? "__uncategorized__") === cat)?.unread_count ?? 0
              const isExpanded = expandedCategories.has(cat)

              return (
                <div key={cat}>
                  <button
                    onClick={() => {
                      if (catSources.length === 1) {
                        setActiveSourceId(catSources[0].id)
                        setActiveCategory(null)
                      } else {
                        setActiveCategory(cat === "__uncategorized__" ? null : cat)
                        setActiveSourceId(null)
                        setExpandedCategories((prev) => {
                          const next = new Set(prev)
                          if (next.has(cat)) next.delete(cat)
                          else next.add(cat)
                          return next
                        })
                      }
                    }}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-1.5 tars-label transition-colors ${
                      activeCategory === (cat === "__uncategorized__" ? null : cat) && !activeSourceId
                        ? "text-[var(--moss)]"
                        : "text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
                    }`}
                  >
                    {catSources.length > 1 && (
                      isExpanded
                        ? <ChevronDown size={10} />
                        : <ChevronRight size={10} />
                    )}
                    <span className="flex-1 truncate">{catLabel}</span>
                    {catUnread > 0 && (
                      <span className="shrink-0">{catUnread}</span>
                    )}
                  </button>

                  {(isExpanded || catSources.length === 1) && catSources.map((src) => (
                    <div key={src.id}>
                      {editingSourceId === src.id ? (
                        /* Inline edit form */
                        <div className="pl-7 pr-2 py-2 space-y-1.5">
                          <input
                            autoFocus
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(src.id)
                              if (e.key === "Escape") setEditingSourceId(null)
                            }}
                            className="w-full px-2 py-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] text-xs text-[var(--c-ink)] outline-none focus:border-[var(--moss)]"
                            placeholder="Feed name"
                          />
                          <input
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveEdit(src.id)
                              if (e.key === "Escape") setEditingSourceId(null)
                            }}
                            list="sidebar-category-suggestions"
                            className="w-full px-2 py-1 rounded border border-[var(--c-border)] bg-[var(--c-surface)] text-xs text-[var(--c-ink)] outline-none focus:border-[var(--moss)]"
                            placeholder="Category (optional)"
                          />
                          <datalist id="sidebar-category-suggestions">
                            {existingCategories.map((c) => <option key={c} value={c} />)}
                          </datalist>
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleSaveEdit(src.id)}
                              disabled={savingEdit}
                              className="flex-1 tars-label px-2 py-1 rounded text-center transition-colors"
                              style={{ background: "var(--moss)", color: "#fff" }}
                            >
                              {savingEdit ? "…" : "SAVE"}
                            </button>
                            <button
                              onClick={() => setEditingSourceId(null)}
                              className="tars-label px-2 py-1 rounded transition-colors text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
                              style={{ background: "var(--c-surface)" }}
                            >
                              <XIcon size={11} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="group flex items-center pl-7 pr-1">
                          <button
                            onClick={() => { setActiveSourceId(src.id); setActiveCategory(null) }}
                            className={`flex-1 min-w-0 text-left py-1 flex items-center gap-1.5 tars-label transition-colors ${
                              activeSourceId === src.id
                                ? "text-[var(--moss)]"
                                : "text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
                            }`}
                          >
                            {src.favicon_url
                              ? <img src={src.favicon_url} alt="" className="w-3 h-3 rounded shrink-0" />
                              : <Rss size={10} className="shrink-0" />
                            }
                            <span className="flex-1 truncate">{src.name}</span>
                            {src.unread_count > 0 && (
                              <span className="shrink-0 mr-1">{src.unread_count}</span>
                            )}
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); startEditSource(src) }}
                            className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
                            title="Edit feed"
                          >
                            <Pencil size={10} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteSource(src.id) }}
                            className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-[var(--c-ink-faint)] hover:text-rose-400"
                            title={`Remove ${src.name}`}
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        )}

        <div className="mt-auto px-3 py-3 border-t border-[var(--c-border)]">
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg tars-label text-[var(--c-ink-faint)] hover:text-[var(--moss)] hover:bg-[var(--c-surface)] transition-colors"
          >
            <Plus size={12} />
            ADD FEED
          </button>
        </div>
      </div>

      {/* ── Sidebar drag handle — sits between sidebar and center ──────── */}
      <div
        onMouseDown={onSidebarDragStart}
        className="hidden md:block shrink-0 cursor-col-resize select-none group relative z-10"
        style={{ width: 5 }}
      >
        <div className="absolute inset-0 -mx-1.5 group-hover:bg-[var(--moss)]/20 transition-colors" />
      </div>

      {/* ── Center — Article List ─────────────────────────────────────── */}
      <div
        className={`${mobilePanel === "reading" ? "hidden md:flex" : "flex"} flex-col overflow-hidden ${
          viewMode === "cards"
            ? "flex-1 min-w-0"
            : "border-r border-[var(--c-border)] w-full md:w-80 md:shrink-0 md:flex-none"
        }`}
        style={{ background: "var(--c-canvas)" }}
      >
        {/* Mobile filter bar — replaces sidebar on small screens */}
        <div className="flex md:hidden overflow-x-auto gap-1 px-3 py-2 border-b border-[var(--c-border)] shrink-0" style={{ scrollbarWidth: "none" }}>
          {(["unread", "all", "starred"] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setActiveCategory(null); setActiveSourceId(null) }}
              className={`shrink-0 tars-label px-2.5 py-1 rounded-full transition-colors ${
                filter === f && !activeCategory && !activeSourceId
                  ? "text-[var(--c-surface)]"
                  : "text-[var(--c-ink-faint)]"
              }`}
              style={filter === f && !activeCategory && !activeSourceId ? { background: "var(--moss)" } : { background: "var(--c-surface)" }}
            >
              {f === "unread" ? `UNREAD${totalUnread > 0 ? ` · ${totalUnread}` : ""}` : f === "all" ? "ALL" : "STARRED"}
            </button>
          ))}
          {existingCategories.map((cat) => {
            const catUnread = categories.find((c) => c.category === cat)?.unread_count ?? 0
            const isActive = activeCategory === cat
            return (
              <button
                key={cat}
                onClick={() => { setActiveCategory(cat); setActiveSourceId(null) }}
                className="shrink-0 tars-label px-2.5 py-1 rounded-full transition-colors"
                style={isActive ? { background: "var(--moss)", color: "var(--c-surface)" } : { background: "var(--c-surface)", color: "var(--c-ink-faint)" }}
              >
                {cat.toUpperCase()}{catUnread > 0 ? ` · ${catUnread}` : ""}
              </button>
            )
          })}
          <button
            onClick={() => setShowAddModal(true)}
            className="shrink-0 flex items-center gap-1 tars-label px-2.5 py-1 rounded-full transition-colors"
            style={{ background: "var(--c-surface)", color: "var(--c-ink-faint)" }}
          >
            <Plus size={10} />ADD
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[var(--c-border)]">
          {/* Search input */}
          <div className="relative flex-1 min-w-0">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--c-ink-faint)] pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search…"
              className="w-full pl-7 pr-7 py-1.5 rounded-md border border-[var(--c-border)] bg-[var(--c-surface)] text-xs text-[var(--c-ink)] placeholder:text-[var(--c-ink-faint)] outline-none focus:border-[var(--moss)] transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => handleSearchChange("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"
              >
                <XIcon size={11} />
              </button>
            )}
          </div>
          <button
            onClick={handleMarkAllRead}
            className="tars-label text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors px-2 py-1 rounded"
            title="Mark all read"
          >
            MARK READ
          </button>
          {activeSourceId && (
            <button
              onClick={() => handleSync(activeSourceId)}
              disabled={syncingSource === activeSourceId}
              className="p-1.5 rounded text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors"
              title="Sync feed"
            >
              <RefreshCw size={12} className={syncingSource === activeSourceId ? "animate-spin" : ""} />
            </button>
          )}
          {/* View toggle — desktop only */}
          <div className="hidden md:flex items-center rounded border border-[var(--c-border)] overflow-hidden">
            <button
              onClick={() => setViewMode("list")}
              className={`p-1.5 transition-colors ${viewMode === "list" ? "text-[var(--moss)]" : "text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"}`}
              style={viewMode === "list" ? { background: "var(--c-surface)" } : {}}
              title="List view"
            >
              <LayoutList size={13} />
            </button>
            <button
              onClick={() => setViewMode("cards")}
              className={`p-1.5 transition-colors ${viewMode === "cards" ? "text-[var(--moss)]" : "text-[var(--c-ink-faint)] hover:text-[var(--c-ink)]"}`}
              style={viewMode === "cards" ? { background: "var(--c-surface)" } : {}}
              title="Card view"
            >
              <LayoutGrid size={13} />
            </button>
          </div>
        </div>

        {/* Items */}
        <div className={`flex-1 overflow-y-auto ${viewMode === "list" ? "divide-y divide-[var(--c-border)]" : "p-3"}`}>
          {isEmpty ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
              <Rss size={24} className="text-[var(--c-ink-faint)]" />
              <div>
                <p className="tars-label text-[var(--c-ink-faint)]">NO FEEDS YET</p>
                <p className="text-xs text-[var(--c-ink-faint)] mt-1">Add your first feed to start reading</p>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 tars-label px-3 py-1.5 rounded-md mt-1 transition-colors"
                style={{ background: "var(--moss)", color: "var(--c-surface)" }}
              >
                <Plus size={12} />
                ADD FEED
              </button>
            </div>
          ) : loadingItems && items.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 size={16} className="animate-spin text-[var(--c-ink-faint)]" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 gap-2">
              <p className="tars-label text-[var(--c-ink-faint)]">ALL CAUGHT UP</p>
            </div>
          ) : viewMode === "cards" ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {items.map((item) => (
                  <ArticleCard
                    key={item.id}
                    item={item}
                    selected={selectedItem?.id === item.id}
                    onClick={() => handleSelectItem(item)}
                    onStar={() => handleStar(item.id)}
                  />
                ))}
              </div>
              {hasMore && (
                <button
                  onClick={() => loadItems(false)}
                  disabled={loadingItems}
                  className="w-full py-3 mt-3 tars-label text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors text-center"
                >
                  {loadingItems ? <Loader2 size={12} className="animate-spin mx-auto" /> : "LOAD MORE"}
                </button>
              )}
            </>
          ) : (
            <>
              {items.map((item) => (
                <ArticleRow
                  key={item.id}
                  item={item}
                  selected={selectedItem?.id === item.id}
                  onClick={() => handleSelectItem(item)}
                  onStar={() => handleStar(item.id)}
                />
              ))}
              {hasMore && (
                <button
                  onClick={() => loadItems(false)}
                  disabled={loadingItems}
                  className="w-full py-3 tars-label text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors text-center"
                >
                  {loadingItems ? <Loader2 size={12} className="animate-spin mx-auto" /> : "LOAD MORE"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Right — Reading Pane (list view only) ────────────────────── */}
      <div
        className={`${viewMode === "cards" ? "hidden" : mobilePanel === "list" ? "hidden md:flex" : "flex"} flex-col flex-1 min-w-0 overflow-hidden`}
        style={{ background: "var(--c-canvas)" }}
      >
        {/* Mobile back button */}
        <div className="flex md:hidden items-center gap-2 px-4 py-2.5 border-b border-[var(--c-border)] shrink-0">
          <button
            onClick={() => setMobilePanel("list")}
            className="flex items-center gap-1.5 tars-label text-[var(--c-ink-faint)] hover:text-[var(--c-ink)] transition-colors"
          >
            <ArrowLeft size={13} />
            BACK
          </button>
        </div>
        {loadingDetail ? (
          <div className="flex items-center justify-center flex-1">
            <Loader2 size={18} className="animate-spin text-[var(--c-ink-faint)]" />
          </div>
        ) : (
          <ReadingPane
            item={selectedItem}
            onStar={() => selectedItem && handleStar(selectedItem.id)}
            onSaveToSecondBrain={handleSaveToSecondBrain}
            onChatWithTars={handleChatWithTars}
            savingToBrain={savingToBrain}
          />
        )}
      </div>

      {/* ── Add Feed Modal ────────────────────────────────────────────── */}
      {showAddModal && (
        <AddFeedModal
          existingCategories={existingCategories}
          onClose={() => setShowAddModal(false)}
          onAdded={handleFeedAdded}
        />
      )}

      {/* ── Article Modal (card view) ─────────────────────────────────── */}
      {articleModalOpen && (
        <ArticleModal
          item={selectedItem}
          loading={loadingDetail}
          onClose={() => setArticleModalOpen(false)}
          onStar={() => selectedItem && handleStar(selectedItem.id)}
          onSaveToSecondBrain={handleSaveToSecondBrain}
          onChatWithTars={handleChatWithTars}
          savingToBrain={savingToBrain}
        />
      )}
    </div>
  )
}
