"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import parse, { domToReact, type HTMLReactParserOptions, Element } from "html-react-parser"
import {
  ChevronLeft, X, Pencil, Check, Copy, ExternalLink, Trash2,
  MessageSquare, Loader2, Tag, Layers, ChevronDown, ChevronUp,
  Link as LinkIcon, FileText, Mic, File, BookOpen, ListTodo, Star,
  Sparkles, ArrowUpRight,
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { apiGet, apiPatch, apiDelete } from "@/lib/api-client"
import { useDomains } from "@/hooks/useDomains"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useIsMobile } from "@/hooks/use-mobile"
import { TiptapEditor, type MentionRef } from "./TiptapEditor"
import { useContactPopup } from "@/context/ContactPopupContext"
import type { Link as LinkType, ItemProperties } from "@tars/types"

// ─── Types ─────────────────────────────────────────────────────────────────────

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
  starred: boolean
  properties: ItemProperties
  saved_at: string
}

interface KnowledgeItemDetail extends KnowledgeItem {
  clean_content: string | null
  chunk_count: number
}

// ─── Property helpers ──────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = { raw: "Raw", developing: "Developing", actionable: "Actionable", archived: "Archived" }
const STATUS_STYLE: Record<string, { bg: string; color: string; border?: string }> = {
  raw:        { bg: "color-mix(in srgb, var(--c-amber) 15%, transparent)", color: "var(--c-amber)" },
  developing: { bg: "transparent", color: "var(--c-moss)", border: "1px solid color-mix(in srgb, var(--c-moss) 40%, transparent)" },
  actionable: { bg: "var(--c-moss)", color: "white" },
  archived:   { bg: "var(--c-surface-2)", color: "var(--c-ink-faint)" },
}
const TYPE_VALUES   = ["idea", "project", "reference", "research"]
const PRIORITY_VALUES = ["high", "medium", "low"]
const STATUS_VALUES   = ["raw", "developing", "actionable", "archived"]

export interface ItemDetailModalProps {
  itemId: string | null
  onClose: () => void
  onDeleted: (id: string) => void
  onUpdated: (item: KnowledgeItem) => void
  onNavigateToItem?: (id: string) => void
  searchChunk?: string | null
}

function TypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  if (type === "url")      return <LinkIcon size={size} />
  if (type === "note")     return <FileText size={size} />
  if (type === "meeting")  return <Mic size={size} />
  if (type === "document") return <BookOpen size={size} />
  return <File size={size} />
}

function typeLabel(type: string) {
  return { url: "URL", note: "Note", meeting: "Meeting", document: "Doc" }[type] ?? type
}

export function ItemDetailModal({
  itemId,
  onClose,
  onDeleted,
  onUpdated,
  onNavigateToItem,
  searchChunk,
}: ItemDetailModalProps) {
  const router = useRouter()
  const isMobile = useIsMobile()
  const { openContact } = useContactPopup()
  const { domains } = useDomains()
  const [item, setItem]               = useState<KnowledgeItemDetail | null>(null)
  const [loading, setLoading]         = useState(false)
  const [editing, setEditing]         = useState(false)
  const [editTitle, setEditTitle]     = useState("")
  const [editNote, setEditNote]       = useState("")
  const [editTags, setEditTags]       = useState("")
  const [editDomain, setEditDomain]   = useState("")
  const [editProps, setEditProps]     = useState<ItemProperties>({})
  const [editingProps, setEditingProps] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)
  const [backlinks, setBacklinks]     = useState<LinkType[]>([])
  const [docMarkdown, setDocMarkdown] = useState("")
  const [wordCount, setWordCount]     = useState(0)
  const [saving, setSaving]           = useState(false)
  const [saveStatus, setSaveStatus]   = useState<"idle" | "saving" | "saved">("idle")
  const [copied, setCopied]           = useState(false)
  const [addingTask, setAddingTask]   = useState(false)
  const [taskAdded, setTaskAdded]     = useState(false)
  const lastSavedContent              = useRef("")
  const lastSavedTitle                = useRef("")
  const [showFull, setShowFull]       = useState(false)
  const mentionSyncTimer              = useRef<ReturnType<typeof setTimeout> | null>(null)
  const confirm                       = useConfirm()

  const isDocument = item?.type === "document" || item?.type === "note" || item?.type === "voice"

  const looksLikeHtml = (str: string) => /^\s*<[a-z]/i.test(str)

  const htmlParseOptions: HTMLReactParserOptions = {
    replace(node) {
      if (!(node instanceof Element)) return
      const { name, children } = node
      const cls = "className" in node.attribs ? node.attribs.className : undefined
      const child = <>{domToReact(children as any, htmlParseOptions)}</>
      if (name === "img") {
        const { src, alt } = node.attribs
        if (!src) return <></>
        return <img src={src} alt={alt ?? ""} className="max-w-full rounded my-2" style={{ maxHeight: 400, objectFit: "cover" }} />
      }
      if (name === "h1") return <h1 className="text-base font-semibold mb-1 mt-3">{child}</h1>
      if (name === "h2") return <h2 className="text-sm font-semibold mb-1 mt-3">{child}</h2>
      if (name === "h3") return <h3 className="text-sm font-medium mb-1 mt-2">{child}</h3>
      if (name === "p")  return <p className="mb-2 last:mb-0 text-sm leading-relaxed">{child}</p>
      if (name === "ul") return <ul className="pl-4 space-y-0.5 mb-2 list-disc">{child}</ul>
      if (name === "ol") return <ol className="pl-4 space-y-0.5 mb-2 list-decimal">{child}</ol>
      if (name === "li") return <li className="text-sm leading-relaxed">{child}</li>
      if (name === "a")  return <a href={node.attribs.href} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--c-moss)" }}>{child}</a>
      if (name === "strong" || name === "b") return <strong className="font-semibold">{child}</strong>
      if (name === "em" || name === "i") return <em>{child}</em>
      if (name === "blockquote") return <blockquote className="pl-3 border-l-2 italic text-sm my-2" style={{ borderColor: "var(--c-border)", color: "var(--c-ink-muted)" }}>{child}</blockquote>
      if (name === "pre") return <pre className="text-xs p-2 rounded overflow-x-auto my-2" style={{ backgroundColor: "var(--c-surface-2)", whiteSpace: "pre-wrap" }}>{child}</pre>
      if (name === "code") return <code className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-amber)" }}>{child}</code>
      if (name === "figure" || name === "figcaption") return <div className="my-2">{child}</div>
      // strip script/style/iframe completely
      if (name === "script" || name === "style" || name === "iframe" || name === "object") return <></>
    },
  }

  // Refs that always hold the latest values — lets saveDocument be a stable useCallback
  const saveValuesRef  = useRef({ item, editTitle, editNote, editTags, editDomain, editProps, docMarkdown })
  const onUpdatedRef   = useRef(onUpdated)
  const currentItemIdRef = useRef<string | null>(null)
  const hasUnsavedChanges = useRef(false)
  useEffect(() => {
    saveValuesRef.current = { item, editTitle, editNote, editTags, editDomain, editProps, docMarkdown }
    onUpdatedRef.current  = onUpdated
  })

  useEffect(() => {
    if (!itemId) return
    setLoading(true)
    setItem(null)
    setEditing(false)
    setShowFull(false)
    setDocMarkdown("")
    setTaskAdded(false)
    setBacklinks([])
    setEditProps({})
    Promise.all([
      apiGet<KnowledgeItemDetail>(`/second-brain/items/${itemId}`),
      apiGet<LinkType[]>(`/links?target_type=knowledge_item&target_id=${itemId}`).catch(() => [] as LinkType[]),
    ])
      .then(([d, links]) => {
        currentItemIdRef.current = d.id
        hasUnsavedChanges.current = false
        setItem(d)
        setEditTitle(d.source_title ?? "")
        setEditNote(d.personal_note ?? "")
        setEditTags((d.tags ?? []).join(", "))
        setEditDomain(d.domain ?? "work")
        setEditProps(d.properties ?? {})
        setBacklinks(links)
        if (d.type === "document" || d.type === "note") {
          setDocMarkdown(d.clean_content ?? "")
          lastSavedContent.current = d.clean_content ?? ""
          lastSavedTitle.current = d.source_title ?? ""
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [itemId])

  async function saveMetadata() {
    if (!item) return
    setSaving(true)
    try {
      const updated = await apiPatch<KnowledgeItemDetail>(`/second-brain/items/${item.id}`, {
        source_title: editTitle || null,
        personal_note: editNote || null,
        tags: editTags.split(",").map(t => t.trim()).filter(Boolean),
        domain: editDomain,
        properties: editProps,
      })
      setItem(updated)
      onUpdated(updated)
      setEditing(false)
      setEditingProps(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function autoFillProperties() {
    if (!item) return
    setAutoFilling(true)
    try {
      const res = await fetch(`/api/proxy/second-brain/items/${item.id}/properties/auto`, { method: "POST" })
      if (res.ok) {
        const d = await res.json() as KnowledgeItemDetail
        setItem(d)
        setEditProps(d.properties ?? {})
        onUpdated(d)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setAutoFilling(false)
    }
  }

  const handleMentionClick = useCallback((id: string, type: string, rect: DOMRect) => {
    if (type === "contact") {
      openContact(id, rect)
    } else if (type === "knowledge_item") {
      onNavigateToItem?.(id)
    } else if (type === "task") {
      router.push(`/tasks?id=${id}`)
    }
  }, [openContact, onNavigateToItem, router])

  const handleMentionsExtracted = useCallback((mentions: MentionRef[]) => {
    if (!item || mentions.length === 0) return
    if (mentionSyncTimer.current) clearTimeout(mentionSyncTimer.current)
    mentionSyncTimer.current = setTimeout(async () => {
      const links = mentions.map(m => ({
        source_type: "knowledge_item",
        source_id: item.id,
        target_type: m.type,
        target_id: m.id,
        relationship: "mentions",
      }))
      try {
        await fetch("/api/proxy/links/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ links }),
        })
      } catch { /* silent */ }
    }, 2000)
  }, [item])

  async function toggleStar() {
    if (!item) return
    const next = !item.starred
    setItem({ ...item, starred: next })          // optimistic
    try {
      const updated = await apiPatch<KnowledgeItemDetail>(`/second-brain/items/${item.id}`, { starred: next })
      setItem(updated)
      onUpdated(updated)
    } catch (err) {
      console.error(err)
      setItem(prev => prev ? { ...prev, starred: !next } : prev)   // rollback
    }
  }

  // Stable save function — reads latest values from refs so it never has stale closures
  const saveDocument = useCallback(async () => {
    const { item, editTitle, editNote, editTags, editDomain, editProps, docMarkdown } = saveValuesRef.current
    if (!item) return
    const itemId = item.id
    setSaving(true)
    try {
      const updated = await apiPatch<KnowledgeItemDetail>(`/second-brain/items/${itemId}`, {
        source_title: editTitle || null,
        personal_note: editNote || null,
        tags: editTags.split(",").map(t => t.trim()).filter(Boolean),
        domain: editDomain,
        properties: editProps,
        clean_content: docMarkdown,
      })
      // Guard: only update React state if we're still viewing the same item
      if (currentItemIdRef.current === itemId) {
        setItem(updated)
        onUpdatedRef.current(updated)
      }
      lastSavedContent.current = docMarkdown
      lastSavedTitle.current = editTitle
      hasUnsavedChanges.current = false
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus(s => s === "saved" ? "idle" : s), 2000)
    } catch (err) {
      console.error(err)
      setSaveStatus("idle")
    } finally {
      setSaving(false)
    }
  }, [])

  // Auto-save — debounced 1.5s after last change to content or title
  useEffect(() => {
    if (!item || !isDocument) return
    if (docMarkdown === lastSavedContent.current && editTitle === lastSavedTitle.current) return
    hasUnsavedChanges.current = true
    setSaveStatus("saving")
    const t = setTimeout(saveDocument, 1500)
    return () => clearTimeout(t)
  }, [docMarkdown, editTitle, item, isDocument, saveDocument])

  // Flush any pending save when navigating to a different item or closing the modal
  useEffect(() => {
    if (!itemId) return
    return () => {
      if (hasUnsavedChanges.current) {
        saveDocument()
      }
    }
  }, [itemId, saveDocument])

  async function copyContent() {
    const text = item?.clean_content ?? item?.summary ?? ""
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleAddToTask() {
    if (!item) return
    setAddingTask(true)
    try {
      const title = item.source_title ?? item.url ?? "Second Brain item"
      await fetch("/api/proxy/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Review: ${title.slice(0, 80)}`,
          description: `From Second Brain — ${typeLabel(item.type).toLowerCase()} saved on ${new Date(item.saved_at).toLocaleDateString()}.\n\n${item.summary ? item.summary.slice(0, 300) + (item.summary.length > 300 ? "…" : "") : ""}`.trim(),
          status: "inbox",
          priority: "normal",
        }),
      })
      setTaskAdded(true)
      setTimeout(() => setTaskAdded(false), 2500)
    } catch (err) {
      console.error(err)
    } finally {
      setAddingTask(false)
    }
  }

  async function deleteItem() {
    if (!item) return
    const ok = await confirm({
      title: "Delete item?",
      description: item.source_title
        ? `"${item.source_title}" will be permanently removed from your Second Brain.`
        : "This item will be permanently removed from your Second Brain.",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!ok) return
    await apiDelete(`/second-brain/items/${item.id}`)
    onDeleted(item.id)
    onClose()
  }

  const displayContent = item ? (item.clean_content ?? item.summary ?? "") : ""
  const isLong = displayContent.length > 1200
  const shownContent = isLong && !showFull ? displayContent.slice(0, 1200) + "…" : displayContent

  // ─── Shared sub-sections ────────────────────────────────────────────────────

  const headerTitle = (
    <div className="flex-1 min-w-0">
      {(isDocument || editing) ? (
        <input
          value={editTitle}
          onChange={e => setEditTitle(e.target.value)}
          placeholder="Untitled document"
          className="w-full bg-transparent border-none outline-none text-sm font-semibold truncate"
          style={{ color: "var(--c-ink)", fontFamily: "var(--font-heading), serif" }}
        />
      ) : (
        <h2
          className="text-sm font-semibold truncate"
          style={{ color: "var(--c-ink)", fontFamily: "var(--font-heading), serif" }}
        >
          {item?.source_title ?? item?.url ?? "Untitled"}
        </h2>
      )}
    </div>
  )

  const starToggle = item && (
    <button
      onClick={toggleStar}
      className="p-1.5 rounded-md transition-colors"
      style={{ color: "var(--c-amber)" }}
      title={item.starred ? "Unstar" : "Star"}
      aria-pressed={item.starred}
    >
      <Star size={15} fill={item.starred ? "var(--c-amber)" : "none"} />
    </button>
  )

  const editToggle = !isDocument && (
    !editing ? (
      <button
        onClick={() => setEditing(true)}
        className="p-1.5 rounded-md transition-colors"
        style={{ color: "var(--c-ink-faint)" }}
        title="Edit metadata"
      >
        <Pencil size={14} />
      </button>
    ) : (
      <button
        onClick={saveMetadata}
        disabled={saving}
        className="p-1.5 rounded-md"
        style={{ color: "var(--c-moss)" }}
        title="Save"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      </button>
    )
  )

  const saveStatusBadge = isDocument && saveStatus !== "idle" && (
    <span
      className="text-[11px] transition-opacity"
      style={{ color: saveStatus === "saved" ? "var(--c-moss)" : "var(--c-ink-faint)" }}
    >
      {saveStatus === "saving" ? "Saving…" : "Saved ✓"}
    </span>
  )

  const bodyContent = loading ? (
    <div className="flex-1 flex items-center justify-center">
      <Loader2 size={20} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
    </div>
  ) : !item ? null : isDocument ? (
    <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
      <TiptapEditor
        content={item.clean_content ?? ""}
        resetKey={item.id}
        onChange={setDocMarkdown}
        onWordCount={setWordCount}
        onMentionsExtracted={handleMentionsExtracted}
        onMentionClick={handleMentionClick}
        placeholder="Start writing…"
      />
    </div>
  ) : (
    <div className="flex-1 overflow-y-auto p-5 space-y-4" data-selectable>
      {item.url && !item.url.startsWith("fireflies://") && (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-xs break-all transition-opacity hover:opacity-80"
          style={{ color: "var(--c-moss)" }}
        >
          <ExternalLink size={11} />
          {item.url}
        </a>
      )}
      {editing ? (
        <div className="space-y-2">
          <div className="relative">
            {(() => { const dc = domains.find(d => d.name === editDomain); return dc ? <span className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded-full pointer-events-none" style={{ width: 8, height: 8, backgroundColor: dc.color }} /> : null })()}
            <select
              value={editDomain}
              onChange={e => setEditDomain(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg outline-none w-full"
              style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)", paddingLeft: domains.find(d => d.name === editDomain) ? "1.5rem" : undefined }}
            >
              {domains.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select>
          </div>
          <div className="relative">
            <Tag size={11} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--c-ink-faint)" }} />
            <input
              value={editTags}
              onChange={e => setEditTags(e.target.value)}
              placeholder="tag1, tag2, tag3"
              className="w-full text-xs pl-6 pr-2 py-1.5 rounded-lg outline-none"
              style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {item.domain && (() => {
            const dc = domains.find(d => d.name === item.domain)
            return (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium flex items-center gap-1" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}>
                {dc && <span className="rounded-full inline-block" style={{ width: 6, height: 6, backgroundColor: dc.color }} />}
                {item.domain}
              </span>
            )
          })()}
          {(item.tags ?? []).map(tag => (
            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--c-canvas)", color: "var(--c-ink-faint)", border: "1px solid var(--c-border-faint)" }}>
              #{tag}
            </span>
          ))}
        </div>
      )}
      {/* ─── Properties section ─── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="tars-label">Properties</span>
          <div className="flex items-center gap-1">
            {editingProps ? (
              <button
                onClick={async () => { await saveMetadata(); setEditingProps(false) }}
                className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1"
                style={{ color: "var(--c-moss)" }}
              >
                {saving ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                Save
              </button>
            ) : (
              <button
                onClick={() => setEditingProps(true)}
                className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
                style={{ color: "var(--c-ink-faint)" }}
              >
                <Pencil size={9} /> Edit
              </button>
            )}
            <button
              onClick={autoFillProperties}
              disabled={autoFilling}
              className="text-[10px] px-2 py-0.5 rounded flex items-center gap-1 transition-colors"
              style={{ color: "var(--c-ink-faint)" }}
            >
              {autoFilling ? <Loader2 size={9} className="animate-spin" /> : <Sparkles size={9} />}
              Auto-fill
            </button>
          </div>
        </div>
        {editingProps ? (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border)" }}>
            {[
              { key: "status", label: "Status", options: STATUS_VALUES },
              { key: "type",   label: "Type",   options: TYPE_VALUES },
              { key: "priority", label: "Priority", options: PRIORITY_VALUES },
            ].map(({ key, label, options }) => (
              <div key={key} className="flex items-center px-3 py-2 border-b last:border-b-0" style={{ borderColor: "var(--c-border-faint)" }}>
                <span className="tars-label w-20 shrink-0">{label}</span>
                <select
                  value={(editProps as any)[key] ?? ""}
                  onChange={e => setEditProps(p => ({ ...p, [key]: e.target.value || undefined }))}
                  className="flex-1 text-xs bg-transparent outline-none"
                  style={{ color: "var(--c-ink)" }}
                >
                  <option value="">—</option>
                  {options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
            {Object.entries(editProps.custom ?? {}).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--c-border-faint)" }}>
                <input
                  value={k}
                  readOnly
                  className="tars-label w-20 bg-transparent border-none outline-none shrink-0"
                  style={{ color: "var(--c-ink-faint)" }}
                />
                <input
                  value={v}
                  onChange={e => setEditProps(p => ({ ...p, custom: { ...p.custom, [k]: e.target.value } }))}
                  className="flex-1 text-xs bg-transparent outline-none border-none"
                  style={{ color: "var(--c-ink)" }}
                />
                <button
                  onClick={() => setEditProps(p => {
                    const c = { ...(p.custom ?? {}) }
                    delete c[k]
                    return { ...p, custom: c }
                  })}
                  style={{ color: "var(--c-ink-faint)" }}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                const key = prompt("Property name:")
                if (key?.trim()) setEditProps(p => ({ ...p, custom: { ...(p.custom ?? {}), [key.trim()]: "" } }))
              }}
              className="w-full text-left px-3 py-2 text-[10px] transition-colors"
              style={{ color: "var(--c-ink-faint)" }}
            >
              + Add property
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {editProps.status && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium uppercase" style={{ ...STATUS_STYLE[editProps.status] }}>
                {STATUS_LABEL[editProps.status] ?? editProps.status}
              </span>
            )}
            {editProps.type && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium uppercase" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}>
                {editProps.type}
              </span>
            )}
            {editProps.priority && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium uppercase"
                style={{
                  backgroundColor: editProps.priority === "high" ? "color-mix(in srgb, var(--c-amber) 15%, transparent)" : "var(--c-surface-2)",
                  color: editProps.priority === "high" ? "var(--c-amber)" : "var(--c-ink-muted)",
                }}
              >
                {editProps.priority}
              </span>
            )}
            {!editProps.status && !editProps.type && !editProps.priority && (
              <span className="text-[10px]" style={{ color: "var(--c-ink-faint)" }}>No properties — click Auto-fill or Edit</span>
            )}
          </div>
        )}
      </div>

      {searchChunk && (
        <div className="rounded-lg p-3" style={{ backgroundColor: "var(--c-amber-soft)", border: "1px solid color-mix(in srgb, var(--c-amber) 30%, transparent)" }}>
          <p className="text-[10px] font-semibold font-mono uppercase tracking-wider mb-1" style={{ color: "var(--c-amber)" }}>Matched passage</p>
          <p className="text-xs leading-relaxed" style={{ color: "var(--c-ink)" }}>{searchChunk}</p>
        </div>
      )}
      <div className="space-y-1">
        <p className="text-[10px] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>Your Note</p>
        {editing ? (
          <textarea
            value={editNote}
            onChange={e => setEditNote(e.target.value)}
            placeholder="Add a personal annotation…"
            rows={3}
            className="w-full text-sm px-2.5 py-2 rounded-lg outline-none resize-none"
            style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
          />
        ) : item.personal_note ? (
          <p className="text-sm leading-relaxed italic" style={{ color: "var(--c-ink-muted)" }}>{item.personal_note}</p>
        ) : (
          <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>No note — click edit to add one</p>
        )}
      </div>
      {displayContent && (
        <div>
          <p className="text-[10px] font-semibold font-mono uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>Content</p>
          <div
            className="text-sm leading-relaxed rounded-lg p-4 overflow-hidden"
            style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border-faint)", color: "var(--c-ink)" }}
          >
            {looksLikeHtml(shownContent) ? (
              <div className="text-sm leading-relaxed space-y-1">
                {parse(shownContent, htmlParseOptions)}
              </div>
            ) : (
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
                  pre: ({ children }) => <>{children}</>,
                  code: ({ children, className }) => {
                    const isBlock = !!className
                    return isBlock
                      ? <pre className="text-xs p-2 rounded overflow-x-auto my-2" style={{ backgroundColor: "#1a1a1a", color: "#e2e2e2", whiteSpace: "pre-wrap" }}><code>{children}</code></pre>
                      : <code className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-amber)" }}>{children}</code>
                  },
                  a: ({ href, children }) => (
                    <a href={href} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--c-moss)" }}>{children}</a>
                  ),
                }}
              >
                {shownContent}
              </ReactMarkdown>
            )}
          </div>
          {isLong && (
            <button
              onClick={() => setShowFull(!showFull)}
              className="mt-1.5 flex items-center gap-1 text-xs"
              style={{ color: "var(--c-ink-faint)" }}
            >
              {showFull
                ? <><ChevronUp size={12} /> Show less</>
                : <><ChevronDown size={12} /> Show full ({Math.round(displayContent.length / 5)} words)</>
              }
            </button>
          )}
        </div>
      )}
      {/* ─── Backlinks section ─── */}
      {backlinks.length > 0 && (
        <div className="space-y-1.5 pt-3 border-t" style={{ borderColor: "var(--c-border-faint)" }}>
          <span className="tars-label">Referenced by</span>
          <div className="space-y-1">
            {backlinks.map(link => {
              const isNavable = link.source_type === "knowledge_item" && onNavigateToItem
              const isContact = link.source_type === "contact"
              const title = link.source_title ?? link.source_id
              return (
                <div
                  key={link.id}
                  className="flex items-center gap-2 text-xs py-1 rounded-md px-1 transition-colors"
                  style={{ cursor: (isNavable || isContact) ? "pointer" : "default" }}
                  onClick={() => {
                    if (isNavable) onNavigateToItem(link.source_id)
                    else if (isContact) router.push(`/contacts?id=${link.source_id}`)
                  }}
                  onMouseEnter={e => { if (isNavable || isContact) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface-2)" }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = "" }}
                >
                  <span className="tars-label" style={{ color: "var(--c-moss)", flexShrink: 0 }}>{link.source_type.replace("_", " ")}</span>
                  <span className="flex-1 truncate" style={{ color: "var(--c-ink)" }}>{title}</span>
                  {(isNavable || isContact) && <ArrowUpRight size={11} style={{ color: "var(--c-ink-faint)", flexShrink: 0 }} />}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="pt-3 border-t text-[10px] space-y-0.5" style={{ borderColor: "var(--c-border-faint)", color: "var(--c-ink-faint)" }}>
        <p>Saved {new Date(item.saved_at).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</p>
        {item.access_count > 0 && <p>Referenced by TARS {item.access_count}×</p>}
        {item.source_author && <p>By {item.source_author}</p>}
      </div>
    </div>
  )

  const footerActions = (
    <div
      className="shrink-0 border-t flex items-center gap-2 px-4 py-3 overflow-x-auto"
      style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}
    >
      <button
        onClick={() => { if (item) router.push(`/chat?load=${item.id}`) }}
        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg font-medium whitespace-nowrap shrink-0"
        style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
      >
        <MessageSquare size={13} />
        Chat
      </button>
      <button
        onClick={copyContent}
        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg whitespace-nowrap shrink-0"
        style={{ backgroundColor: "var(--c-canvas)", color: "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}
      >
        {copied ? <Check size={12} style={{ color: "var(--c-moss)" }} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        onClick={handleAddToTask}
        disabled={addingTask}
        className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg transition-colors whitespace-nowrap shrink-0"
        style={{
          backgroundColor: taskAdded ? "var(--c-moss-soft)" : "var(--c-canvas)",
          color: taskAdded ? "var(--c-moss)" : "var(--c-ink-muted)",
          border: `1px solid ${taskAdded ? "color-mix(in srgb, var(--c-moss) 30%, transparent)" : "var(--c-border)"}`,
        }}
      >
        {addingTask ? <Loader2 size={12} className="animate-spin" /> : taskAdded ? <Check size={12} /> : <ListTodo size={12} />}
        {taskAdded ? "Added!" : "Task"}
      </button>
      {item?.url && !item.url.startsWith("fireflies://") && (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg whitespace-nowrap shrink-0"
          style={{ backgroundColor: "var(--c-canvas)", color: "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}
        >
          <ExternalLink size={12} />
          Open
        </a>
      )}
      {isDocument && (
        <span className="text-[10px] ml-1 whitespace-nowrap shrink-0" style={{ color: "var(--c-ink-faint)" }}>
          {wordCount} {wordCount === 1 ? "word" : "words"}
        </span>
      )}
      <div className="flex-1" />
      <button onClick={deleteItem} className="p-2 rounded-md shrink-0" style={{ color: "var(--c-ink-faint)" }} title="Delete">
        <Trash2 size={15} />
      </button>
    </div>
  )

  // ─── Mobile: full-screen page ────────────────────────────────────────────────

  if (isMobile) {
    if (!itemId) return null
    return (
      <div
        className="fixed inset-0 z-50 flex flex-col"
        style={{ background: "var(--c-canvas)" }}
      >
        {/* Mobile header */}
        <div
          className="shrink-0 flex items-center gap-2 px-3 border-b"
          style={{
            borderColor: "var(--c-border)",
            background: "var(--c-surface)",
            paddingTop: "max(env(safe-area-inset-top), 0.75rem)",
            paddingBottom: "0.75rem",
          }}
        >
          {/* Back button */}
          <button
            onClick={onClose}
            className="shrink-0 flex items-center justify-center rounded-full w-8 h-8"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink)" }}
          >
            <ChevronLeft size={18} />
          </button>

          {/* Type chip */}
          <div className="flex items-center gap-1 shrink-0" style={{ color: "var(--c-ink-faint)" }}>
            <TypeIcon type={item?.type ?? ""} size={12} />
            <span className="text-[10px] font-mono uppercase tracking-wider font-medium">{typeLabel(item?.type ?? "")}</span>
          </div>

          {/* Title */}
          {headerTitle}

          {/* Right controls */}
          {saveStatusBadge}
          {starToggle}
          {editToggle}
        </div>

        {/* Body */}
        {bodyContent}

        {/* Footer */}
        {footerActions}
      </div>
    )
  }

  // ─── Desktop: Dialog modal ───────────────────────────────────────────────────

  return (
    <Dialog open={itemId !== null} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent
        className="w-[80vw] max-w-[80vw] sm:max-w-[80vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0"
          style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 shrink-0" style={{ color: "var(--c-ink-faint)" }}>
              <TypeIcon type={item?.type ?? ""} size={13} />
              <span className="text-[10px] font-mono uppercase tracking-wider font-medium">{typeLabel(item?.type ?? "")}</span>
              {(item?.chunk_count ?? 0) > 0 && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
                  style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}
                >
                  <Layers size={9} /> {item!.chunk_count} chunks
                </span>
              )}
            </div>
            {headerTitle}
          </div>
          <div className="flex items-center gap-1.5 shrink-0 ml-3">
            {saveStatusBadge}
            {starToggle}
            {editToggle}
            <button onClick={onClose} className="p-1.5 rounded-md" style={{ color: "var(--c-ink-faint)" }}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        {bodyContent}

        {/* Footer */}
        {footerActions}
      </DialogContent>
    </Dialog>
  )
}
