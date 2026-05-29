"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  X, Pencil, Check, Copy, ExternalLink, Trash2,
  MessageSquare, Loader2, Tag, Layers, ChevronDown, ChevronUp,
  Link as LinkIcon, FileText, Mic, File, BookOpen,
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { apiGet, apiPatch, apiDelete } from "@/lib/api-client"
import { TiptapEditor } from "./TiptapEditor"

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
  saved_at: string
}

interface KnowledgeItemDetail extends KnowledgeItem {
  clean_content: string | null
  chunk_count: number
}

export interface ItemDetailModalProps {
  itemId: string | null
  onClose: () => void
  onDeleted: (id: string) => void
  onUpdated: (item: KnowledgeItem) => void
  searchChunk?: string | null
}

const DOMAINS = ["work", "personal", "cycling", "client", "health"]

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
  searchChunk,
}: ItemDetailModalProps) {
  const router = useRouter()
  const [item, setItem]               = useState<KnowledgeItemDetail | null>(null)
  const [loading, setLoading]         = useState(false)
  const [editing, setEditing]         = useState(false)
  const [editTitle, setEditTitle]     = useState("")
  const [editNote, setEditNote]       = useState("")
  const [editTags, setEditTags]       = useState("")
  const [editDomain, setEditDomain]   = useState("work")
  const [docMarkdown, setDocMarkdown] = useState("")
  const [wordCount, setWordCount]     = useState(0)
  const [saving, setSaving]           = useState(false)
  const [saveStatus, setSaveStatus]   = useState<"idle" | "saving" | "saved">("idle")
  const [copied, setCopied]           = useState(false)
  const lastSavedContent              = useRef("")
  const lastSavedTitle                = useRef("")
  const [showFull, setShowFull]       = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isDocument = item?.type === "document"

  useEffect(() => {
    if (!itemId) return
    setLoading(true)
    setItem(null)
    setEditing(false)
    setShowFull(false)
    setConfirmDelete(false)
    setDocMarkdown("")
    apiGet<KnowledgeItemDetail>(`/second-brain/items/${itemId}`)
      .then((d) => {
        setItem(d)
        setEditTitle(d.source_title ?? "")
        setEditNote(d.personal_note ?? "")
        setEditTags((d.tags ?? []).join(", "))
        setEditDomain(d.domain ?? "work")
        if (d.type === "document") {
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

  async function saveDocument() {
    if (!item) return
    setSaving(true)
    try {
      const updated = await apiPatch<KnowledgeItemDetail>(`/second-brain/items/${item.id}`, {
        source_title: editTitle || null,
        personal_note: editNote || null,
        tags: editTags.split(",").map(t => t.trim()).filter(Boolean),
        domain: editDomain,
        clean_content: docMarkdown,
      })
      setItem(updated)
      onUpdated(updated)
      lastSavedContent.current = docMarkdown
      lastSavedTitle.current = editTitle
      setSaveStatus("saved")
      setTimeout(() => setSaveStatus(s => s === "saved" ? "idle" : s), 2000)
    } catch (err) {
      console.error(err)
      setSaveStatus("idle")
    } finally {
      setSaving(false)
    }
  }

  // Auto-save for document items — debounced 1.5s after last keystroke
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!item || !isDocument) return
    if (docMarkdown === lastSavedContent.current && editTitle === lastSavedTitle.current) return
    setSaveStatus("saving")
    const t = setTimeout(() => { saveDocument() }, 1500)
    return () => clearTimeout(t)
  }, [docMarkdown, editTitle])

  async function copyContent() {
    const text = item?.clean_content ?? item?.summary ?? ""
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function deleteItem() {
    if (!item) return
    await apiDelete(`/second-brain/items/${item.id}`)
    onDeleted(item.id)
    onClose()
  }

  const displayContent = item ? (item.clean_content ?? item.summary ?? "") : ""
  const isLong = displayContent.length > 1200
  const shownContent = isLong && !showFull ? displayContent.slice(0, 1200) + "…" : displayContent

  return (
    <Dialog open={itemId !== null} onOpenChange={(isOpen) => { if (!isOpen) onClose() }}>
      <DialogContent
        className="w-[80vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 border-b shrink-0"
          style={{ borderColor: "#d8d2c4", background: "#faf8f4" }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="flex items-center gap-1.5 shrink-0" style={{ color: "#948a7b" }}>
              <TypeIcon type={item?.type ?? ""} size={13} />
              <span className="text-[10px] uppercase tracking-wider font-medium">{typeLabel(item?.type ?? "")}</span>
              {(item?.chunk_count ?? 0) > 0 && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
                  style={{ backgroundColor: "#efeadf", color: "#6b6357" }}
                >
                  <Layers size={9} /> {item!.chunk_count} chunks
                </span>
              )}
            </div>
            {/* Editable title — always shown in header */}
            <div className="flex-1 min-w-0 ml-1">
              {(isDocument || editing) ? (
                <input
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  placeholder="Untitled document"
                  className="w-full bg-transparent border-none outline-none text-sm font-semibold truncate"
                  style={{ color: "#1a1714", fontFamily: "var(--font-heading), serif" }}
                />
              ) : (
                <h2
                  className="text-sm font-semibold truncate"
                  style={{ color: "#1a1714", fontFamily: "var(--font-heading), serif" }}
                >
                  {item?.source_title ?? item?.url ?? "Untitled"}
                </h2>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-3">
            {/* Auto-save status for documents */}
            {isDocument && saveStatus !== "idle" && (
              <span
                className="text-[11px] transition-opacity"
                style={{ color: saveStatus === "saved" ? "#2d5a4f" : "#948a7b" }}
              >
                {saveStatus === "saving" ? "Saving…" : "Saved ✓"}
              </span>
            )}
            {/* Non-document: pencil toggle */}
            {!isDocument && (
              !editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="p-1.5 rounded-md transition-colors hover:bg-surface-2"
                  style={{ color: "#948a7b" }}
                  title="Edit metadata"
                >
                  <Pencil size={13} />
                </button>
              ) : (
                <button
                  onClick={saveMetadata}
                  disabled={saving}
                  className="p-1.5 rounded-md"
                  style={{ color: "#2d5a4f" }}
                  title="Save"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </button>
              )
            )}
            <button onClick={onClose} className="p-1.5 rounded-md" style={{ color: "#948a7b" }}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "#948a7b" }} />
          </div>
        ) : !item ? null : isDocument ? (
          /* ── Document edit mode ─────────────────────────────── */
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <TiptapEditor
              content={item.clean_content ?? ""}
              resetKey={item.id}
              onChange={setDocMarkdown}
              onWordCount={setWordCount}
              placeholder="Start writing…"
            />
          </div>
        ) : (
          /* ── Read-only content (url / note / meeting) ────────── */
          <div className="flex-1 overflow-y-auto p-5 space-y-4" data-selectable>

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
                  onChange={e => setEditDomain(e.target.value)}
                  className="text-xs px-2 py-1.5 rounded-lg outline-none w-full"
                  style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                >
                  {DOMAINS.map(d => <option key={d}>{d}</option>)}
                </select>
                <div className="relative">
                  <Tag size={11} className="absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "#948a7b" }} />
                  <input
                    value={editTags}
                    onChange={e => setEditTags(e.target.value)}
                    placeholder="tag1, tag2, tag3"
                    className="w-full text-xs pl-6 pr-2 py-1.5 rounded-lg outline-none"
                    style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {item.domain && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "#efeadf", color: "#6b6357" }}>
                    {item.domain}
                  </span>
                )}
                {(item.tags ?? []).map(tag => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "#f6f3ec", color: "#948a7b", border: "1px solid #e8e2d4" }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Search match highlight */}
            {searchChunk && (
              <div className="rounded-lg p-3" style={{ backgroundColor: "#fffbe6", border: "1px solid #f0e68c" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "#92740a" }}>
                  Matched passage
                </p>
                <p className="text-xs leading-relaxed" style={{ color: "#4a3a00" }}>{searchChunk}</p>
              </div>
            )}

            {/* Personal note */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#948a7b" }}>Your Note</p>
              {editing ? (
                <textarea
                  value={editNote}
                  onChange={e => setEditNote(e.target.value)}
                  placeholder="Add a personal annotation…"
                  rows={3}
                  className="w-full text-sm px-2.5 py-2 rounded-lg outline-none resize-none"
                  style={{ backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }}
                />
              ) : item.personal_note ? (
                <p className="text-sm leading-relaxed italic" style={{ color: "#6b6357" }}>{item.personal_note}</p>
              ) : (
                <p className="text-xs" style={{ color: "#c4bdb2" }}>No note — click edit to add one</p>
              )}
            </div>

            {/* Full content */}
            {displayContent && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "#948a7b" }}>Content</p>
                <div
                  className="text-sm leading-relaxed rounded-lg p-4 overflow-hidden"
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
                    className="mt-1.5 flex items-center gap-1 text-xs"
                    style={{ color: "#948a7b" }}
                  >
                    {showFull
                      ? <><ChevronUp size={12} /> Show less</>
                      : <><ChevronDown size={12} /> Show full ({Math.round(displayContent.length / 5)} words)</>
                    }
                  </button>
                )}
              </div>
            )}

            {/* Metadata footer */}
            <div className="pt-3 border-t text-[10px] space-y-0.5" style={{ borderColor: "#e8e2d4", color: "#948a7b" }}>
              <p>Saved {new Date(item.saved_at).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</p>
              {item.access_count > 0 && <p>Referenced by TARS {item.access_count}×</p>}
              {item.source_author && <p>By {item.source_author}</p>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 border-t px-5 py-3 flex items-center gap-2" style={{ borderColor: "#d8d2c4", background: "#faf8f4" }}>
          <button
            onClick={() => { if (item) router.push(`/chat?load=${item.id}`) }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ backgroundColor: "#2d5a4f", color: "#fff" }}
          >
            <MessageSquare size={12} />
            Chat
          </button>
          <button
            onClick={copyContent}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
            style={{ backgroundColor: "#f6f3ec", color: "#6b6357", border: "1px solid #d8d2c4" }}
          >
            {copied ? <Check size={11} style={{ color: "#2d5a4f" }} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
          {item?.url && !item.url.startsWith("fireflies://") && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: "#f6f3ec", color: "#6b6357", border: "1px solid #d8d2c4" }}
            >
              <ExternalLink size={11} />
              Open
            </a>
          )}

          {/* Document word count */}
          {isDocument && (
            <span className="text-[10px] ml-1" style={{ color: "#948a7b" }}>
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
          )}

          <div className="flex-1" />

          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="p-1.5 rounded-md" style={{ color: "#c4bdb2" }} title="Delete">
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "#6b6357" }}>Delete?</span>
              <button onClick={deleteItem} className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "#dc2626", color: "#fff" }}>Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "#f6f3ec", color: "#6b6357", border: "1px solid #d8d2c4" }}>No</button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
