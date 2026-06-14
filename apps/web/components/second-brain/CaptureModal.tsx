"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  X, Link as LinkIcon, FileText, Loader2, ChevronDown,
  Upload, Camera, File as FileIcon, Plus, Check,
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { apiPost, apiUpload } from "@/lib/api-client"
import { useDomains, invalidateDomains, fetchDomains } from "@/hooks/useDomains"
import { TiptapEditor } from "./TiptapEditor"

const DOMAIN_PALETTE = [
  "#6B7280", "#3B82F6", "#8B5CF6", "#10B981",
  "#F59E0B", "#EF4444", "#EC4899", "#14B8A6",
  "#F97316", "#6366F1", "#84CC16", "#78716C",
]

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

interface ArtifactResult {
  id: string
  filename: string
  type: string
  source: string
  size_bytes: number
  created_at: string
}

export interface CaptureModalProps {
  open: boolean
  onClose: () => void
  onSaved?: (item: KnowledgeItem) => void
  defaultTab?: "url" | "document" | "file"
  initialTitle?: string
}

const ACCEPTED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/msword",
  "image/jpeg", "image/png", "image/webp", "image/gif",
  "text/*",
].join(",")

const ACCEPT_ALL =
  ".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx," +
  ".jpg,.jpeg,.png,.webp,.gif,.heic," +
  ".txt,.md,.csv,.json,.jsonl,.yaml,.yml,.toml," +
  ".py,.ts,.tsx,.js,.jsx,.go,.rs,.java,.rb,.sh,.sql,.css,.html,.xml"

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function CaptureModal({ open, onClose, onSaved, defaultTab = "document", initialTitle = "" }: CaptureModalProps) {
  const router = useRouter()
  const [tab, setTab] = useState<"url" | "document" | "file">(defaultTab)
  // URL tab
  const [captureUrl, setCaptureUrl] = useState("")
  // Document tab
  const [docTitle, setDocTitle] = useState(initialTitle)
  const [docMarkdown, setDocMarkdown] = useState("")
  // File tab
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  // Shared metadata — empty string = auto-classify
  const [captureNote, setCaptureNote] = useState("")
  const [captureTags, setCaptureTags] = useState("")
  const [captureDomain, setCaptureDomain] = useState("")
  const [showMeta, setShowMeta] = useState(false)

  // State
  const [ingesting, setIngesting] = useState(false)
  const [ingestError, setIngestError] = useState("")

  const canSave =
    tab === "url"
      ? captureUrl.trim().length > 0
      : tab === "document"
      ? docTitle.trim().length > 0 && docMarkdown.trim().length > 0
      : selectedFile !== null

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file)
    setIngestError("")
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => setDragOver(false), [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFileSelect(file)
  }, [handleFileSelect])

  async function handleSave() {
    setIngestError("")
    setIngesting(true)
    try {
      if (tab === "url") {
        const tags = captureTags.split(",").map(t => t.trim()).filter(Boolean)
        const item = await apiPost<KnowledgeItem>("/second-brain/ingest/url", {
          url: captureUrl.trim(),
          personal_note: captureNote,
          tags,
          domain: captureDomain || null,
        })
        onSaved?.(item)
        handleClose()

      } else if (tab === "document") {
        const tags = captureTags.split(",").map(t => t.trim()).filter(Boolean)
        const item = await apiPost<KnowledgeItem>("/second-brain/ingest/document", {
          content: docMarkdown,
          title: docTitle.trim(),
          personal_note: captureNote,
          tags,
          domain: captureDomain || null,
        })
        onSaved?.(item)
        handleClose()

      } else if (tab === "file" && selectedFile) {
        const formData = new FormData()
        formData.append("file", selectedFile)
        const artifact = await apiUpload<ArtifactResult>("/artifacts/ingest", formData)
        handleClose()
        // Navigate to a new chat with the artifact as context
        router.push(`/chat?artifact=${artifact.id}`)
      }
    } catch (e: unknown) {
      setIngestError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setIngesting(false)
    }
  }

  function handleClose() {
    setCaptureUrl(""); setDocTitle(""); setDocMarkdown("")
    setCaptureNote(""); setCaptureTags(""); setCaptureDomain("work")
    setShowMeta(false); setIngestError("")
    setSelectedFile(null); setDragOver(false)
    setTab(defaultTab)
    onClose()
  }

  const saveLabel =
    tab === "url" ? "Scrape & Save" :
    tab === "document" ? "Save Document" :
    "Process File"

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose() }}>
      <DialogContent
        className="w-[96vw] max-w-[96vw] sm:w-[80vw] sm:max-w-[80vw] h-[90vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0" style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-serif text-base font-medium shrink-0" style={{ color: "var(--c-ink)" }}>Capture</span>
            {/* Tab switcher */}
            <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "var(--c-surface-2)" }}>
              {([
                { id: "url", label: "URL", icon: LinkIcon },
                { id: "document", label: "Doc", icon: FileText },
                { id: "file", label: "File", icon: Upload },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                  style={tab === id
                    ? { background: "var(--c-surface)", color: "var(--c-ink)", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }
                    : { color: "var(--c-ink-faint)" }
                  }
                >
                  <Icon size={11} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-md transition-colors hover:bg-surface-2"
            style={{ color: "var(--c-ink-faint)" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        {tab === "url" ? (
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider font-medium mb-1.5" style={{ color: "var(--c-ink-faint)" }}>
                URL
              </label>
              <input
                autoFocus
                type="url"
                value={captureUrl}
                onChange={e => setCaptureUrl(e.target.value)}
                onKeyDown={e => e.key === "Enter" && canSave && handleSave()}
                placeholder="https://…"
                className="input-field w-full"
              />
            </div>
            <MetadataFields
              note={captureNote} onNoteChange={setCaptureNote}
              tags={captureTags} onTagsChange={setCaptureTags}
              domain={captureDomain} onDomainChange={setCaptureDomain}
              show={showMeta} onToggle={() => setShowMeta(p => !p)}
            />
          </div>

        ) : tab === "document" ? (
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Title */}
            <div className="px-5 pt-4 pb-2 shrink-0">
              <input
                autoFocus
                type="text"
                value={docTitle}
                onChange={e => setDocTitle(e.target.value)}
                placeholder="Document title…"
                className="w-full text-lg font-semibold bg-transparent border-none outline-none"
                style={{ color: "var(--c-ink)", fontFamily: "var(--font-heading), serif" }}
              />
            </div>
            {/* Editor */}
            <div className="flex-1 min-h-0 overflow-hidden border-t" style={{ borderColor: "var(--c-border-faint)" }}>
              <TiptapEditor
                content=""
                onChange={setDocMarkdown}
                placeholder="Start writing, or type '/' for commands…"
                autoFocus={false}
                resetKey="new"
              />
            </div>
            {/* Metadata accordion */}
            <div className="border-t px-5 py-2 shrink-0" style={{ borderColor: "var(--c-border-faint)" }}>
              <MetadataFields
                note={captureNote} onNoteChange={setCaptureNote}
                tags={captureTags} onTagsChange={setCaptureTags}
                domain={captureDomain} onDomainChange={setCaptureDomain}
                show={showMeta} onToggle={() => setShowMeta(p => !p)}
              />
            </div>
          </div>

        ) : (
          /* File tab */
          <div className="flex-1 flex flex-col px-5 py-5 gap-4 overflow-y-auto">
            {selectedFile ? (
              /* File selected — show preview card */
              <div
                className="flex items-start gap-4 rounded-xl p-4 border"
                style={{ background: "var(--c-canvas)", borderColor: "var(--c-border)" }}
              >
                <div
                  className="flex items-center justify-center w-12 h-12 rounded-lg shrink-0"
                  style={{ background: "var(--c-moss-soft)" }}
                >
                  <FileIcon size={22} style={{ color: "var(--c-moss)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate" style={{ color: "var(--c-ink)" }}>
                    {selectedFile.name}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>
                    {formatBytes(selectedFile.size)} · {selectedFile.type || "unknown type"}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedFile(null)}
                  className="p-1 rounded-md"
                  style={{ color: "var(--c-ink-faint)" }}
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              /* Drop zone */
              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                className="flex-1 flex flex-col items-center justify-center rounded-xl border-2 border-dashed gap-4 cursor-pointer min-h-[220px] transition-colors"
                style={{
                  borderColor: dragOver ? "var(--c-moss)" : "var(--c-border)",
                  background: dragOver ? "var(--c-moss-soft)" : "var(--c-surface)",
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center"
                  style={{ background: dragOver ? "var(--c-moss)" : "var(--c-border-faint)" }}
                >
                  <Upload size={24} style={{ color: dragOver ? "var(--c-surface)" : "var(--c-ink-faint)" }} />
                </div>
                <div className="text-center">
                  <p className="font-medium text-sm" style={{ color: "var(--c-ink)" }}>
                    Drop a file here, or click to browse
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--c-ink-faint)" }}>
                    PDF, DOCX, PPTX, XLSX, images, code files, and more
                  </p>
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors"
                style={{ borderColor: "var(--c-border)", color: "var(--c-ink)", background: "var(--c-surface)" }}
              >
                <FileIcon size={15} />
                Browse Files
              </button>
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-colors"
                style={{ borderColor: "var(--c-border)", color: "var(--c-ink)", background: "var(--c-surface)" }}
              >
                <Camera size={15} />
                Take Photo
              </button>
            </div>

            {/* What happens next */}
            {!selectedFile && (
              <div
                className="rounded-lg px-4 py-3 text-xs"
                style={{ background: "var(--c-moss-soft)", color: "var(--c-moss)" }}
              >
                <p className="font-medium mb-0.5">After uploading</p>
                <p style={{ color: "var(--c-moss)" }}>
                  TARS will extract the content and open a new chat so you can ask questions, get summaries, or take action on it.
                </p>
              </div>
            )}

            {/* Hidden inputs */}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ALL}
              className="sr-only"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFileSelect(f)
                e.target.value = ""
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) handleFileSelect(f)
                e.target.value = ""
              }}
            />
          </div>
        )}

        {/* Footer */}
        <div
          className="px-4 py-3 border-t shrink-0"
          style={{ borderColor: "var(--c-border)", background: "var(--c-surface)" }}
        >
          {/* Status messages */}
          {(ingestError || (tab === "file" && ingesting)) && (
            <p className="text-xs mb-2" style={{ color: ingestError ? "var(--c-rose)" : "var(--c-ink-faint)" }}>
              {ingestError || "Processing file — this may take a moment…"}
            </p>
          )}
          {/* Buttons — row on sm+, full-width stacked on mobile */}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              onClick={handleClose}
              className="btn-ghost text-sm w-full sm:w-auto"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!canSave || ingesting}
              className="flex items-center justify-center gap-1.5 text-sm disabled:opacity-50 w-full sm:w-auto"
              style={{
                background: "var(--c-moss)", color: "var(--c-surface)",
                padding: "0.5rem 1.25rem", borderRadius: "0.5rem",
                fontWeight: 500,
              }}
            >
              {ingesting ? <Loader2 size={13} className="animate-spin" /> : null}
              {saveLabel}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Shared metadata fields ───────────────────────────────────────────────────

function MetadataFields({
  note, onNoteChange, tags, onTagsChange, domain, onDomainChange, show, onToggle,
}: {
  note: string; onNoteChange: (v: string) => void
  tags: string; onTagsChange: (v: string) => void
  domain: string; onDomainChange: (v: string) => void
  show: boolean; onToggle: () => void
}) {
  const { domains, reload } = useDomains()
  const [addingDomain, setAddingDomain] = useState(false)
  const [newName, setNewName]           = useState("")
  const [newColor, setNewColor]         = useState("#6366F1")
  const [creating, setCreating]         = useState(false)

  const activeDomain = domains.find(d => d.name === domain)

  async function createDomain() {
    if (!newName.trim() || creating) return
    setCreating(true)
    try {
      await apiPost("/domains", { name: newName.trim(), color: newColor })
      invalidateDomains()
      await fetchDomains()
      await reload()
      onDomainChange(newName.trim())
      setAddingDomain(false)
      setNewName("")
      setNewColor("#6366F1")
    } catch (e) { console.error(e) }
    finally { setCreating(false) }
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-xs mb-2 transition-colors"
        style={{ color: "var(--c-ink-faint)" }}
      >
        <ChevronDown size={12} style={{ transform: show ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        Metadata {show ? "" : "(optional)"}
      </button>
      {show && (
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-mono uppercase tracking-wider font-medium mb-1" style={{ color: "var(--c-ink-faint)" }}>
              Personal note
            </label>
            <textarea
              value={note}
              onChange={e => onNoteChange(e.target.value)}
              placeholder="Why are you saving this?"
              rows={2}
              className="input-field w-full resize-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider font-medium mb-1" style={{ color: "var(--c-ink-faint)" }}>
                Tags
              </label>
              <input
                value={tags}
                onChange={e => onTagsChange(e.target.value)}
                placeholder="tag1, tag2"
                className="input-field w-full"
              />
            </div>
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-wider font-medium mb-1" style={{ color: "var(--c-ink-faint)" }}>
                Domain
              </label>

              {addingDomain ? (
                /* Inline new domain creator */
                <div className="rounded-lg border p-2 space-y-2" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-canvas)" }}>
                  <div className="flex flex-wrap gap-1">
                    {DOMAIN_PALETTE.map(hex => (
                      <button
                        key={hex}
                        type="button"
                        onClick={() => setNewColor(hex)}
                        className="rounded-full transition-transform"
                        style={{
                          width: 14, height: 14,
                          backgroundColor: hex,
                          outline: newColor === hex ? `2px solid ${hex}` : "none",
                          outlineOffset: 2,
                          transform: newColor === hex ? "scale(1.2)" : "scale(1)",
                        }}
                      />
                    ))}
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <span className="rounded-full shrink-0" style={{ width: 8, height: 8, backgroundColor: newColor }} />
                    <input
                      autoFocus
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); createDomain() } if (e.key === "Escape") { setAddingDomain(false); setNewName("") } }}
                      placeholder="Domain name…"
                      className="input-field flex-1 text-xs"
                      style={{ padding: "0.2rem 0.4rem", height: "1.6rem" }}
                    />
                    <button
                      type="button"
                      onClick={createDomain}
                      disabled={!newName.trim() || creating}
                      className="p-1 rounded disabled:opacity-40"
                      style={{ backgroundColor: "var(--c-moss)", color: "#fff" }}
                    >
                      {creating ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                    </button>
                    <button type="button" onClick={() => { setAddingDomain(false); setNewName("") }} className="p-1 rounded" style={{ color: "var(--c-ink-faint)" }}>
                      <X size={11} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  {activeDomain && (
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 rounded-full pointer-events-none" style={{ width: 8, height: 8, backgroundColor: activeDomain.color }} />
                  )}
                  <select
                    value={domain}
                    onChange={e => {
                      if (e.target.value === "__new__") { setAddingDomain(true); return }
                      onDomainChange(e.target.value)
                    }}
                    className="input-field w-full"
                    style={{ paddingLeft: activeDomain ? "1.5rem" : undefined }}
                  >
                    <option value="">Auto-detect</option>
                    {domains.map(d => <option key={d.name} value={d.name}>{d.name}</option>)}
                    <option value="__new__">+ New domain…</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
