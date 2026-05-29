"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  X, Pencil, Check, Copy, ExternalLink, Trash2,
  MessageSquare, Loader2, Tag, Layers, ChevronDown, ChevronUp,
  Link as LinkIcon, FileText, Mic, File, BookOpen, ListTodo,
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
  const [addingTask, setAddingTask]   = useState(false)
  const [taskAdded, setTaskAdded]     = useState(false)
  const lastSavedContent              = useRef("")
  const lastSavedTitle                = useRef("")
  const [showFull, setShowFull]       = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const isDocument = item?.type === "document" || item?.type === "note"

  useEffect(() => {
    if (!itemId) return
    setLoading(true)
    setItem(null)
    setEditing(false)
    setShowFull(false)
    setConfirmDelete(false)
    setDocMarkdown("")
    setTaskAdded(false)
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
              <span className="text-[10px] uppercase tracking-wider font-medium">{typeLabel(item?.type ?? "")}</span>
              {(item?.chunk_count ?? 0) > 0 && (
                <span
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
                  style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}
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
          </div>

          <div className="flex items-center gap-1.5 shrink-0 ml-3">
            {/* Auto-save status for documents */}
            {isDocument && saveStatus !== "idle" && (
              <span
                className="text-[11px] transition-opacity"
                style={{ color: saveStatus === "saved" ? "var(--c-moss)" : "var(--c-ink-faint)" }}
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
                  style={{ color: "var(--c-ink-faint)" }}
                  title="Edit metadata"
                >
                  <Pencil size={13} />
                </button>
              ) : (
                <button
                  onClick={saveMetadata}
                  disabled={saving}
                  className="p-1.5 rounded-md"
                  style={{ color: "var(--c-moss)" }}
                  title="Save"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                </button>
              )
            )}
            <button onClick={onClose} className="p-1.5 rounded-md" style={{ color: "var(--c-ink-faint)" }}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
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
                style={{ color: "var(--c-moss)" }}
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
                  style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
                >
                  {DOMAINS.map(d => <option key={d}>{d}</option>)}
                </select>
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
                {item.domain && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}>
                    {item.domain}
                  </span>
                )}
                {(item.tags ?? []).map(tag => (
                  <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: "var(--c-canvas)", color: "var(--c-ink-faint)", border: "1px solid var(--c-border-faint)" }}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {/* Search match highlight */}
            {searchChunk && (
              <div className="rounded-lg p-3" style={{ backgroundColor: "var(--c-amber-soft)", border: "1px solid color-mix(in srgb, var(--c-amber) 30%, transparent)" }}>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--c-amber)" }}>
                  Matched passage
                </p>
                <p className="text-xs leading-relaxed" style={{ color: "var(--c-ink)" }}>{searchChunk}</p>
              </div>
            )}

            {/* Personal note */}
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>Your Note</p>
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

            {/* Full content */}
            {displayContent && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>Content</p>
                <div
                  className="text-sm leading-relaxed rounded-lg p-4 overflow-hidden"
                  style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border-faint)", color: "var(--c-ink)" }}
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

            {/* Metadata footer */}
            <div className="pt-3 border-t text-[10px] space-y-0.5" style={{ borderColor: "var(--c-border-faint)", color: "var(--c-ink-faint)" }}>
              <p>Saved {new Date(item.saved_at).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</p>
              {item.access_count > 0 && <p>Referenced by TARS {item.access_count}×</p>}
              {item.source_author && <p>By {item.source_author}</p>}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 border-t px-5 py-3 flex items-center gap-2" style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}>
          <button
            onClick={() => { if (item) router.push(`/chat?load=${item.id}`) }}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
          >
            <MessageSquare size={12} />
            Chat
          </button>
          <button
            onClick={copyContent}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
            style={{ backgroundColor: "var(--c-canvas)", color: "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}
          >
            {copied ? <Check size={11} style={{ color: "var(--c-moss)" }} /> : <Copy size={11} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={handleAddToTask}
            disabled={addingTask}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
            style={{
              backgroundColor: taskAdded ? "var(--c-moss-soft)" : "var(--c-canvas)",
              color: taskAdded ? "var(--c-moss)" : "var(--c-ink-muted)",
              border: `1px solid ${taskAdded ? "color-mix(in srgb, var(--c-moss) 30%, transparent)" : "var(--c-border)"}`,
            }}
            title="Add to Tasks"
          >
            {addingTask
              ? <Loader2 size={11} className="animate-spin" />
              : taskAdded ? <Check size={11} /> : <ListTodo size={11} />
            }
            {taskAdded ? "Added!" : "Task"}
          </button>
          {item?.url && !item.url.startsWith("fireflies://") && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg"
              style={{ backgroundColor: "var(--c-canvas)", color: "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}
            >
              <ExternalLink size={11} />
              Open
            </a>
          )}

          {/* Document word count */}
          {isDocument && (
            <span className="text-[10px] ml-1" style={{ color: "var(--c-ink-faint)" }}>
              {wordCount} {wordCount === 1 ? "word" : "words"}
            </span>
          )}

          <div className="flex-1" />

          {!confirmDelete ? (
            <button onClick={() => setConfirmDelete(true)} className="p-1.5 rounded-md" style={{ color: "var(--c-ink-faint)" }} title="Delete">
              <Trash2 size={14} />
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "var(--c-ink-muted)" }}>Delete?</span>
              <button onClick={deleteItem} className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "var(--c-rose)", color: "#fff" }}>Yes</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "var(--c-canvas)", color: "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}>No</button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
