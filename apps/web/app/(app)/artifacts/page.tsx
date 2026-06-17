"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Archive, Search, Grid2x2, List, Download, MessageSquare, X,
  FileText, Code2, FileSpreadsheet, FileAudio, BarChart2,
  ChevronDown, Loader2, Trash2, Eye, Brain, ListTodo, Check, Image,
  BookOpen, LayoutList, AlignLeft, Table,
} from "lucide-react"
import { apiGet, apiDelete } from "@/lib/api-client"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { Dialog, DialogContent } from "@/components/ui/dialog"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Artifact {
  id: string
  filename: string
  type: string
  source: string
  source_id: string | null
  project_ref: string | null
  tags: string[]
  size_bytes: number
  version: number
  parent_id: string | null
  created_at: string
}

interface ArtifactDetail extends Artifact {
  content: string | null
}

interface PreviewResult {
  text: string
  type: "docx" | "pptx" | "text" | "binary" | "image"
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { icon: React.ReactNode; bg: string; color: string; label: string }> = {
  document:    { icon: <FileText size={16} />,        bg: "var(--c-moss-soft)",  color: "var(--c-moss)",      label: "Document" },
  code:        { icon: <Code2 size={16} />,           bg: "var(--c-surface-2)", color: "var(--c-ink-muted)", label: "Code" },
  report:      { icon: <BarChart2 size={16} />,       bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "Report" },
  transcript:  { icon: <FileAudio size={16} />,       bg: "var(--c-rose-soft)",  color: "var(--c-rose)",      label: "Transcript" },
  spreadsheet: { icon: <FileSpreadsheet size={16} />, bg: "var(--c-moss-soft)",  color: "var(--c-moss)",      label: "Spreadsheet" },
  image:       { icon: <Image size={16} />,           bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "Image" },
}

// Extension → icon/color. Takes precedence over type-based lookup.
const EXT_META: Record<string, { icon: React.ReactNode; bg: string; color: string; label: string }> = {
  // Documents
  pdf:   { icon: <BookOpen size={16} />,      bg: "var(--c-rose-soft)",  color: "var(--c-rose)",      label: "PDF" },
  docx:  { icon: <FileText size={16} />,      bg: "var(--c-moss-soft)",  color: "var(--c-moss)",      label: "Word" },
  doc:   { icon: <FileText size={16} />,      bg: "var(--c-moss-soft)",  color: "var(--c-moss)",      label: "Word" },
  pptx:  { icon: <LayoutList size={16} />,    bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "Slides" },
  ppt:   { icon: <LayoutList size={16} />,    bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "Slides" },
  // Spreadsheets
  xlsx:  { icon: <FileSpreadsheet size={16} />, bg: "var(--c-moss-soft)", color: "var(--c-moss)",     label: "Excel" },
  xls:   { icon: <FileSpreadsheet size={16} />, bg: "var(--c-moss-soft)", color: "var(--c-moss)",     label: "Excel" },
  csv:   { icon: <Table size={16} />,           bg: "var(--c-moss-soft)", color: "var(--c-moss)",     label: "CSV" },
  // Images
  png:   { icon: <Image size={16} />,         bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "PNG" },
  jpg:   { icon: <Image size={16} />,         bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "JPEG" },
  jpeg:  { icon: <Image size={16} />,         bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "JPEG" },
  gif:   { icon: <Image size={16} />,         bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "GIF" },
  webp:  { icon: <Image size={16} />,         bg: "var(--c-amber-soft)", color: "var(--c-amber)",     label: "WebP" },
  // Plain text / markdown
  md:    { icon: <AlignLeft size={16} />,     bg: "var(--c-surface-2)",  color: "var(--c-ink-muted)", label: "Markdown" },
  txt:   { icon: <AlignLeft size={16} />,     bg: "var(--c-surface-2)",  color: "var(--c-ink-muted)", label: "Text" },
}

function fileMeta(filename: string, type: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  return EXT_META[ext] ?? TYPE_META[type.toLowerCase()] ?? TYPE_META.document
}

function typeMeta(type: string) {
  return TYPE_META[type.toLowerCase()] ?? TYPE_META.document
}

function TypeIcon({ type, filename = "", size = "sm" }: { type: string; filename?: string; size?: "sm" | "lg" }) {
  const meta = filename ? fileMeta(filename, type) : typeMeta(type)
  const dim  = size === "lg" ? "w-10 h-10 text-base" : "w-8 h-8 text-sm"
  return (
    <span
      className={`${dim} rounded-lg flex items-center justify-center shrink-0`}
      style={{ backgroundColor: meta.bg, color: meta.color }}
    >
      {meta.icon}
    </span>
  )
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function sourceLabel(source: string) {
  return { chat: "Chat", agent_job: "Agent Job", cron: "Cron", meeting: "Meeting", upload: "Upload" }[source] ?? source
}

function isBinaryArtifact(detail: ArtifactDetail | null) {
  return detail?.content?.startsWith("base64:") ?? false
}

function isPdf(detail: ArtifactDetail | null) {
  return detail?.filename?.toLowerCase().endsWith(".pdf") ?? false
}

function isDocx(detail: ArtifactDetail | null) {
  return detail?.filename?.toLowerCase().endsWith(".docx") ?? false
}

function isPptx(detail: ArtifactDetail | null) {
  return detail?.filename?.toLowerCase().endsWith(".pptx") ?? false
}

function isXlsx(detail: ArtifactDetail | null) {
  const name = detail?.filename?.toLowerCase() ?? ""
  return name.endsWith(".xlsx") || name.endsWith(".xls")
}

const _IMG_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp"])

function isImageArtifact(detail: ArtifactDetail | null) {
  if (!detail) return false
  if (detail.type === "image") return true
  const ext = detail.filename?.split(".").pop()?.toLowerCase() ?? ""
  return _IMG_EXTS.has(ext)
}

// ─── Grid card ────────────────────────────────────────────────────────────────

function GridCard({
  artifact,
  selected,
  onClick,
  onDelete,
}: {
  artifact: Artifact
  selected: boolean
  onClick: () => void
  onDelete: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const router = useRouter()
  const confirm = useConfirm()

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    const ok = await confirm({
      title: "Delete artifact?",
      description: `"${artifact.filename}" will be permanently removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!ok) return
    try {
      await apiDelete(`/artifacts/${artifact.id}`)
      onDelete(artifact.id)
    } catch (err) { console.error(err) }
  }

  const isImg = artifact.type === "image"

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="card text-left flex flex-col cursor-pointer transition-shadow hover:shadow-md relative overflow-hidden"
      style={{ padding: isImg ? 0 : "0.875rem", height: "10rem", outline: selected ? "2px solid var(--c-moss)" : "none", outlineOffset: "1px" }}
    >
      {isImg ? (
        /* Image thumbnail fills the card */
        <div className="flex-1 min-h-0 w-full overflow-hidden rounded-t-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/proxy/artifacts/${artifact.id}/view`}
            alt={artifact.filename}
            className="w-full h-full object-cover"
            style={{ maxHeight: "7rem" }}
          />
        </div>
      ) : (
        <div className="flex items-start gap-3 flex-1 min-h-0">
          <TypeIcon type={artifact.type} filename={artifact.filename} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: "var(--c-ink)" }}>{artifact.filename}</p>
            <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--c-ink-faint)" }}>{sourceLabel(artifact.source)}</p>
          </div>
        </div>
      )}
      <div
        className="flex items-center justify-between pt-2 mt-2"
        style={{
          borderTop: "1px solid var(--c-border-faint)",
          padding: isImg ? "0.375rem 0.625rem" : undefined,
        }}
      >
        <span className="text-[10px] truncate max-w-[60%]" style={{ color: "var(--c-ink-faint)" }}>
          {isImg ? artifact.filename.replace(/\.[^/.]+$/, "") : formatDate(artifact.created_at)}
        </span>
        <span className="text-[10px]" style={{ color: "var(--c-ink-faint)" }}>{isImg ? formatDate(artifact.created_at) : formatSize(artifact.size_bytes)}</span>
      </div>

      {hovered && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg flex-wrap p-2"
          style={{ backgroundColor: "color-mix(in srgb, var(--c-surface) 92%, transparent)", backdropFilter: "blur(2px)" }}
        >
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink)" }}
            onClick={e => { e.stopPropagation(); onClick() }}
          >
            <Eye size={12} /> Preview
          </button>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink)" }}
            onClick={e => { e.stopPropagation(); router.push("/chat") }}
          >
            <MessageSquare size={12} /> Chat
          </button>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}
            onClick={handleDelete}
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}
    </button>
  )
}

// ─── Artifact Modal ───────────────────────────────────────────────────────────

type PreviewTab = "preview" | "info"

function ArtifactModal({
  artifactId,
  onClose,
  onDeleted,
}: {
  artifactId: string | null
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const [detail, setDetail]           = useState<ArtifactDetail | null>(null)
  const [loading, setLoading]         = useState(false)
  const [activeTab, setActiveTab]     = useState<PreviewTab>("preview")
  const [preview, setPreview]         = useState<PreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const prevIdRef = useRef<string | null>(null)

  // ── Save to Second Brain ──────────────────────────────────────────
  const [savingBrain, setSavingBrain] = useState(false)
  const [brainSaved, setBrainSaved]   = useState(false)

  async function handleSaveToBrain() {
    if (!detail) return
    setSavingBrain(true)
    try {
      let content = detail.content ?? ""
      // Binary artifacts: extract text via /preview endpoint
      if (content.startsWith("base64:")) {
        if (isPdf(detail) || isDocx(detail) || isPptx(detail) || isXlsx(detail)) {
          const p = await fetch(`/api/proxy/artifacts/${detail.id}/preview`).then(r => r.json()) as PreviewResult
          content = p.text ?? `${detail.filename}\n(No text extracted)`
        } else if (isImageArtifact(detail)) {
          content = `Image: ${detail.filename}\nSource: ${sourceLabel(detail.source)}\nUploaded: ${formatDate(detail.created_at)}`
        } else {
          content = `${detail.filename}\nType: ${detail.type}\nSource: ${sourceLabel(detail.source)}`
        }
      }
      await fetch("/api/proxy/second-brain/ingest/document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          title: detail.filename.replace(/\.[^/.]+$/, ""),
          tags: ["artifact", detail.type],
          domain: "work",
        }),
      })
      setBrainSaved(true)
      setTimeout(() => setBrainSaved(false), 2500)
    } catch (err) { console.error(err) }
    finally { setSavingBrain(false) }
  }

  // ── Add to Tasks ──────────────────────────────────────────────────
  const [addingTask, setAddingTask]   = useState(false)
  const [taskAdded, setTaskAdded]     = useState(false)

  async function handleAddToTask() {
    if (!detail) return
    setAddingTask(true)
    try {
      await fetch("/api/proxy/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Review: ${detail.filename}`,
          description: `Artifact generated on ${formatDate(detail.created_at)} via ${sourceLabel(detail.source)}.\n\n[Open in Artifacts](/artifacts?open=${detail.id})`,
          status: "inbox",
          priority: "normal",
        }),
      })
      setTaskAdded(true)
      setTimeout(() => setTaskAdded(false), 2500)
    } catch (err) { console.error(err) }
    finally { setAddingTask(false) }
  }

  useEffect(() => {
    if (!artifactId || artifactId === prevIdRef.current) return
    prevIdRef.current = artifactId
    setLoading(true)
    setDetail(null)
    setPreview(null)
    setActiveTab("preview")

    apiGet<ArtifactDetail>(`/artifacts/${artifactId}`)
      .then(async (d) => {
        setDetail(d)
        setLoading(false)

        // Fetch preview for binary artifacts (DOCX / PPTX / XLSX)
        // PDF handled by iframe; images handled by <img>; code / text displayed directly
        const isImageFile = isImageArtifact(d)
        if (d.content?.startsWith("base64:") && !d.filename?.toLowerCase().endsWith(".pdf") && !isImageFile) {
          setPreviewLoading(true)
          try {
            const p = await fetch(`/api/proxy/artifacts/${artifactId}/preview`)
              .then(r => r.json()) as PreviewResult
            setPreview(p)
          } catch { /* silently fall back */ }
          finally { setPreviewLoading(false) }
        }
      })
      .catch(err => { console.error(err); setLoading(false) })
  }, [artifactId])

  // Reset state when modal closes or switches artifact
  useEffect(() => {
    if (!artifactId) {
      prevIdRef.current = null
      setDetail(null)
      setPreview(null)
      setBrainSaved(false)
      setTaskAdded(false)
    }
  }, [artifactId])

  async function handleDelete() {
    if (!artifactId) return
    const ok = await confirm({
      title: "Delete artifact?",
      description: detail?.filename
        ? `"${detail.filename}" will be permanently removed.`
        : "This artifact will be permanently removed.",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!ok) return
    await apiDelete(`/artifacts/${artifactId}`)
    onDeleted(artifactId)
    onClose()
  }

  const meta = detail ? fileMeta(detail.filename, detail.type) : typeMeta("document")
  const isCode = detail?.type === "code"
  const isBinary = isBinaryArtifact(detail)
  const showImagePreview = isBinary && isImageArtifact(detail)
  const showPdfFrame = isBinary && isPdf(detail)
  const showExtractedPreview = isBinary && (isDocx(detail) || isPptx(detail) || isXlsx(detail))

  return (
    <Dialog open={artifactId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent
        showCloseButton={false}
        className="w-full h-[100dvh] rounded-none border-0 p-0 gap-0 overflow-hidden flex flex-col sm:w-[80vw] sm:max-w-[80vw] sm:h-[90vh] sm:rounded-xl sm:border"
        style={{ backgroundColor: "var(--c-surface)", border: undefined }}
      >
        {/* ── Header ── */}
        {/* Mobile: two rows — (icon + filename + close) then (tabs + actions) */}
        {/* Desktop: single row                                                 */}
        <div
          className="flex flex-col gap-1.5 px-4 py-3 border-b shrink-0 sm:flex-row sm:items-center sm:gap-3 sm:px-5 sm:py-3.5"
          style={{ borderColor: "var(--c-border)" }}
        >
          {/* Row 1: icon + filename/subtitle + mobile-close */}
          <div className="flex items-center gap-2 min-w-0">
            {detail && <TypeIcon type={detail.type} filename={detail.filename} size="sm" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: "var(--c-ink)" }}>
                {detail?.filename ?? "…"}
              </p>
              {detail && (
                <p className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
                  {meta.label} · {sourceLabel(detail.source)} · {formatSize(detail.size_bytes)}
                  {detail.version > 1 && ` · v${detail.version}`}
                </p>
              )}
            </div>
            {/* Close — mobile only (desktop close is in the actions row) */}
            <button
              onClick={onClose}
              className="sm:hidden p-1.5 rounded-lg shrink-0 transition-colors"
              style={{ color: "var(--c-ink-faint)" }}
              title="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Row 2 on mobile / continuation on desktop: tabs + action buttons */}
          <div className="flex items-center gap-1 sm:gap-2 sm:ml-auto shrink-0">
            {/* Tab switcher */}
            <div
              className="flex items-center gap-0.5 rounded-lg p-0.5 text-xs flex-1 sm:flex-none"
              style={{ backgroundColor: "var(--c-surface-2)" }}
            >
              {(["preview", "info"] as PreviewTab[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 sm:flex-none px-3 py-1 rounded-md font-medium capitalize transition-colors"
                  style={{
                    backgroundColor: activeTab === tab ? "var(--c-surface)" : "transparent",
                    color: activeTab === tab ? "var(--c-ink)" : "var(--c-ink-faint)",
                    boxShadow: activeTab === tab ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 shrink-0">
            {/* Save to Second Brain */}
            <button
              onClick={handleSaveToBrain}
              disabled={savingBrain || !detail}
              className="p-2 rounded-lg transition-colors"
              style={{
                color: brainSaved ? "var(--c-moss)" : "var(--c-ink-faint)",
                backgroundColor: brainSaved ? "var(--c-moss-soft)" : "transparent",
              }}
              title="Save to Second Brain"
              onMouseEnter={e => { if (!brainSaved) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface-2)" }}
              onMouseLeave={e => { if (!brainSaved) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
            >
              {savingBrain ? <Loader2 size={15} className="animate-spin" /> : brainSaved ? <Check size={15} /> : <Brain size={15} />}
            </button>

            {/* Add to Tasks */}
            <button
              onClick={handleAddToTask}
              disabled={addingTask || !detail}
              className="p-2 rounded-lg transition-colors"
              style={{
                color: taskAdded ? "var(--c-moss)" : "var(--c-ink-faint)",
                backgroundColor: taskAdded ? "var(--c-moss-soft)" : "transparent",
              }}
              title="Add to Tasks"
              onMouseEnter={e => { if (!taskAdded) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface-2)" }}
              onMouseLeave={e => { if (!taskAdded) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
            >
              {addingTask ? <Loader2 size={15} className="animate-spin" /> : taskAdded ? <Check size={15} /> : <ListTodo size={15} />}
            </button>

            <a
              href={detail ? `/api/proxy/artifacts/${detail.id}/download` : "#"}
              download={detail?.filename}
              className="p-2 rounded-lg transition-colors"
              style={{ color: "var(--c-ink-faint)", backgroundColor: "transparent" }}
              title="Download"
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <Download size={15} />
            </a>
            <button
              onClick={() => { onClose(); router.push(`/chat?artifact=${detail?.id}`) }}
              className="p-2 rounded-lg transition-colors"
              style={{ color: "var(--c-ink-faint)", backgroundColor: "transparent" }}
              title="Open in Chat"
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <MessageSquare size={15} />
            </button>
            <button
              onClick={onClose}
              className="hidden sm:flex p-2 rounded-lg transition-colors"
              style={{ color: "var(--c-ink-faint)", backgroundColor: "transparent" }}
              title="Close"
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
            </div>{/* end action buttons */}
          </div>{/* end row-2 */}
        </div>{/* end header */}

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={22} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
            </div>
          ) : !detail ? null : activeTab === "preview" ? (
            /* ── Preview tab ── */
            <div className="h-full flex flex-col">
              {showImagePreview ? (
                /* Image — rendered natively */
                <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/proxy/artifacts/${detail.id}/view`}
                    alt={detail.filename}
                    className="max-w-full max-h-full object-contain rounded-lg"
                    style={{ maxHeight: "70vh" }}
                  />
                </div>
              ) : showPdfFrame ? (
                /* PDF — rendered natively by the browser */
                <iframe
                  src={`/api/proxy/artifacts/${detail.id}/view`}
                  className="flex-1 w-full"
                  style={{ minHeight: "520px", border: "none" }}
                  title={detail.filename}
                />
              ) : showExtractedPreview ? (
                /* DOCX / PPTX — extracted text rendered as markdown */
                <div className="flex-1 overflow-y-auto p-6">
                  {previewLoading ? (
                    <div className="flex items-center justify-center py-10">
                      <Loader2 size={18} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
                    </div>
                  ) : preview ? (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}
                        components={{
                          h1: ({ children }) => <h1 className="text-base font-semibold mb-2 mt-4 first:mt-0" style={{ color: "var(--c-ink)" }}>{children}</h1>,
                          h2: ({ children }) => <h2 className="text-sm font-semibold mb-1.5 mt-3 first:mt-0" style={{ color: "var(--c-ink)" }}>{children}</h2>,
                          h3: ({ children }) => <h3 className="text-sm font-medium mb-1 mt-2" style={{ color: "var(--c-ink)" }}>{children}</h3>,
                          p: ({ children }) => <p className="text-sm leading-relaxed mb-2 last:mb-0" style={{ color: "var(--c-ink)" }}>{children}</p>,
                          ul: ({ children }) => <ul className="text-sm space-y-0.5 my-1.5 pl-4 list-disc" style={{ color: "var(--c-ink)" }}>{children}</ul>,
                          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          code: ({ children }: any) => <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-amber)" }}>{children}</code>,
                        }}
                      >
                        {preview.text || "*No text content extracted.*"}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 gap-2">
                      <p className="text-sm" style={{ color: "var(--c-ink-faint)" }}>Preview not available. Download to view.</p>
                    </div>
                  )}
                </div>
              ) : isCode ? (
                /* Code — monospace block */
                <div className="flex-1 overflow-auto p-4">
                  <pre
                    className="rounded-xl p-4 text-[12px] font-mono leading-relaxed overflow-x-auto"
                    style={{ backgroundColor: "#1a1714", color: "#e3ede9", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
                  >
                    {detail.content ?? ""}
                  </pre>
                </div>
              ) : detail.content ? (
                /* Text / Markdown */
                <div className="flex-1 overflow-y-auto p-6">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}
                    components={{
                      h1: ({ children }) => <h1 className="text-lg font-semibold mb-2 mt-4 first:mt-0" style={{ color: "var(--c-ink)" }}>{children}</h1>,
                      h2: ({ children }) => <h2 className="text-base font-semibold mb-1.5 mt-3 first:mt-0" style={{ color: "var(--c-ink)" }}>{children}</h2>,
                      h3: ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2" style={{ color: "var(--c-ink)" }}>{children}</h3>,
                      p: ({ children }) => <p className="text-sm leading-relaxed mb-2 last:mb-0" style={{ color: "var(--c-ink)" }}>{children}</p>,
                      ul: ({ children }) => <ul className="text-sm space-y-1 my-2 pl-4 list-disc" style={{ color: "var(--c-ink)" }}>{children}</ul>,
                      ol: ({ children }) => <ol className="text-sm space-y-1 my-2 pl-4 list-decimal" style={{ color: "var(--c-ink)" }}>{children}</ol>,
                      li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                      table: ({ children }) => (
                        <div className="my-3 overflow-x-auto rounded-lg" style={{ border: "1px solid var(--c-border)" }}>
                          <table className="text-sm w-full">{children}</table>
                        </div>
                      ),
                      thead: ({ children }) => <thead style={{ backgroundColor: "var(--c-surface-2)" }}>{children}</thead>,
                      th: ({ children }) => <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--c-ink-muted)", borderBottom: "1px solid var(--c-border)" }}>{children}</th>,
                      td: ({ children }) => <td className="px-3 py-2 text-sm" style={{ borderBottom: "1px solid var(--c-border-faint)" }}>{children}</td>,
                      blockquote: ({ children }) => (
                        <blockquote className="my-2 pl-3 py-1 text-sm italic" style={{ borderLeft: "3px solid var(--c-moss)", color: "var(--c-ink-muted)" }}>{children}</blockquote>
                      ),
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      code: ({ children }: any) => <code className="px-1.5 py-0.5 rounded text-[0.8em] font-mono" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-amber)", border: "1px solid var(--c-border)" }}>{children}</code>,
                    }}
                  >
                    {detail.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 gap-2">
                  <p className="text-sm" style={{ color: "var(--c-ink-faint)" }}>No preview available.</p>
                </div>
              )}
            </div>
          ) : (
            /* ── Info tab ── */
            <div className="p-5 flex flex-col gap-4">
              {/* Badges */}
              <div className="flex flex-wrap gap-1.5">
                <span className="badge badge-neutral" style={{ backgroundColor: meta.bg, color: meta.color }}>{meta.label}</span>
                <span className="badge badge-neutral">{sourceLabel(detail.source)}</span>
                {detail.version > 1 && <span className="badge badge-amber">v{detail.version}</span>}
                <span className="badge badge-neutral">{formatSize(detail.size_bytes)}</span>
              </div>

              <div className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
                Created {formatDate(detail.created_at)}
              </div>

              {detail.project_ref && (
                <div>
                  <p className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider mb-1" style={{ color: "var(--c-ink-faint)" }}>Project</p>
                  <p className="text-sm" style={{ color: "var(--c-ink)" }}>{detail.project_ref}</p>
                </div>
              )}

              {detail.tags.length > 0 && (
                <div>
                  <p className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.tags.map(t => (
                      <span key={t} className="badge badge-neutral" style={{ fontSize: "0.7rem" }}>#{t}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 pt-2">
                <a
                  href={`/api/proxy/artifacts/${detail.id}/download`}
                  download={detail.filename}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink)", border: "1px solid var(--c-border)" }}
                >
                  <Download size={13} /> Download
                </a>
                <button
                  onClick={() => { onClose(); router.push(`/chat?artifact=${detail.id}`) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
                >
                  <MessageSquare size={13} /> Open in Chat
                </button>
                <button
                  onClick={handleSaveToBrain}
                  disabled={savingBrain}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: brainSaved ? "var(--c-moss-soft)" : "var(--c-surface-2)",
                    color: brainSaved ? "var(--c-moss)" : "var(--c-ink)",
                    border: `1px solid ${brainSaved ? "color-mix(in srgb, var(--c-moss) 25%, transparent)" : "var(--c-border)"}`,
                  }}
                >
                  {savingBrain ? <Loader2 size={13} className="animate-spin" /> : brainSaved ? <Check size={13} /> : <Brain size={13} />}
                  {brainSaved ? "Saved!" : "Save to Brain"}
                </button>
                <button
                  onClick={handleAddToTask}
                  disabled={addingTask}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: taskAdded ? "var(--c-moss-soft)" : "var(--c-surface-2)",
                    color: taskAdded ? "var(--c-moss)" : "var(--c-ink)",
                    border: `1px solid ${taskAdded ? "color-mix(in srgb, var(--c-moss) 25%, transparent)" : "var(--c-border)"}`,
                  }}
                >
                  {addingTask ? <Loader2 size={13} className="animate-spin" /> : taskAdded ? <Check size={13} /> : <ListTodo size={13} />}
                  {taskAdded ? "Added!" : "Add to Tasks"}
                </button>
              </div>

              {/* Delete */}
              <div className="pt-3 border-t" style={{ borderColor: "var(--c-border-faint)" }}>
                <button
                  onClick={handleDelete}
                  className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md"
                  style={{ color: "var(--c-ink-faint)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-rose)" }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)" }}
                >
                  <Trash2 size={12} /> Delete artifact
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Deep-link handler (needs Suspense for useSearchParams) ──────────────────

function DeepLinkHandler({ onOpen }: { onOpen: (id: string) => void }) {
  const searchParams = useSearchParams()
  const handledRef = useRef<string | null>(null)

  useEffect(() => {
    const id = searchParams.get("open")
    if (!id || handledRef.current === id) return
    handledRef.current = id
    onOpen(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  return null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TYPE_FILTERS  = ["All Types", "document", "image", "code", "report", "spreadsheet", "transcript"]
const SOURCE_FILTERS = ["All Sources", "chat", "agent_job", "cron", "meeting", "upload"]

export default function ArtifactsPage() {
  const [artifacts, setArtifacts]   = useState<Artifact[]>([])
  const [loading, setLoading]       = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewMode, setViewMode]     = useState<"grid" | "list">("grid")
  const [search, setSearch]         = useState("")
  const [typeFilter, setTypeFilter] = useState("All Types")
  const [srcFilter, setSrcFilter]   = useState("All Sources")
  const [showTypeMenu, setTypeMenu] = useState(false)
  const [showSrcMenu, setSrcMenu]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (typeFilter !== "All Types") params.set("type", typeFilter)
      if (srcFilter !== "All Sources") params.set("source", srcFilter)
      const qs = params.toString()
      const data = await apiGet<Artifact[]>(`/artifacts${qs ? `?${qs}` : ""}`)
      setArtifacts(data)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [typeFilter, srcFilter])

  useEffect(() => { load() }, [load])

  const filtered = artifacts.filter(a =>
    a.filename.toLowerCase().includes(search.toLowerCase()) ||
    a.source.toLowerCase().includes(search.toLowerCase()) ||
    (a.project_ref ?? "").toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-1 overflow-hidden bg-canvas">
      {/* Deep-link handler — opens modal when ?open=<id> is in URL */}
      <Suspense fallback={null}>
        <DeepLinkHandler onOpen={(id) => setSelectedId(id)} />
      </Suspense>

      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b shrink-0" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-surface-2)" }}>
                <Archive size={17} style={{ color: "var(--c-ink-muted)" }} />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>Artifacts</h1>
                <p className="text-xs hidden sm:block" style={{ color: "var(--c-ink-faint)" }}>Everything TARS produces — drafts, code, reports, transcripts.</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setViewMode("grid")} className="p-2 rounded-lg transition-colors"
                style={{ backgroundColor: viewMode === "grid" ? "var(--c-surface-2)" : "transparent", color: viewMode === "grid" ? "var(--c-ink)" : "var(--c-ink-faint)" }}><Grid2x2 size={16} /></button>
              <button onClick={() => setViewMode("list")} className="p-2 rounded-lg transition-colors"
                style={{ backgroundColor: viewMode === "list" ? "var(--c-surface-2)" : "transparent", color: viewMode === "list" ? "var(--c-ink)" : "var(--c-ink-faint)" }}><List size={16} /></button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-40">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--c-ink-faint)" }} />
              <input className="input-field w-full" style={{ paddingLeft: "2rem", paddingTop: "0.3rem", paddingBottom: "0.3rem", fontSize: "0.8rem" }} placeholder="Search artifacts…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>

            {/* Type filter */}
            <div className="relative">
              <button onClick={() => { setTypeMenu(p => !p); setSrcMenu(false) }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium"
                style={{
                  borderColor: "var(--c-border)",
                  backgroundColor: typeFilter !== "All Types" ? "var(--c-moss-soft)" : "var(--c-surface)",
                  color: typeFilter !== "All Types" ? "var(--c-moss)" : "var(--c-ink-muted)",
                }}>
                {typeFilter === "All Types" ? "All Types" : typeMeta(typeFilter).label} <ChevronDown size={12} />
              </button>
              {showTypeMenu && (
                <div className="absolute top-full mt-1 left-0 z-20 rounded-lg border shadow-lg overflow-hidden"
                  style={{ backgroundColor: "var(--c-surface)", borderColor: "var(--c-border)", minWidth: "140px" }}>
                  {TYPE_FILTERS.map(f => (
                    <button key={f} onClick={() => { setTypeFilter(f); setTypeMenu(false) }}
                      className="w-full text-left px-3 py-2 text-xs transition-colors"
                      style={{
                        color: f === typeFilter ? "var(--c-moss)" : "var(--c-ink)",
                        fontWeight: f === typeFilter ? 500 : 400,
                        backgroundColor: "transparent",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      {f === "All Types" ? "All Types" : typeMeta(f).label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Source filter */}
            <div className="relative">
              <button onClick={() => { setSrcMenu(p => !p); setTypeMenu(false) }}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium"
                style={{
                  borderColor: "var(--c-border)",
                  backgroundColor: srcFilter !== "All Sources" ? "var(--c-moss-soft)" : "var(--c-surface)",
                  color: srcFilter !== "All Sources" ? "var(--c-moss)" : "var(--c-ink-muted)",
                }}>
                {srcFilter === "All Sources" ? "All Sources" : sourceLabel(srcFilter)} <ChevronDown size={12} />
              </button>
              {showSrcMenu && (
                <div className="absolute top-full mt-1 left-0 z-20 rounded-lg border shadow-lg overflow-hidden"
                  style={{ backgroundColor: "var(--c-surface)", borderColor: "var(--c-border)", minWidth: "140px" }}>
                  {SOURCE_FILTERS.map(f => (
                    <button key={f} onClick={() => { setSrcFilter(f); setSrcMenu(false) }}
                      className="w-full text-left px-3 py-2 text-xs transition-colors"
                      style={{ color: f === srcFilter ? "var(--c-moss)" : "var(--c-ink)", fontWeight: f === srcFilter ? 500 : 400, backgroundColor: "transparent" }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      {f === "All Sources" ? "All Sources" : sourceLabel(f)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content — always full-width; modal handles detail */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-16"><Loader2 size={22} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} /></div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
              <Archive size={32} style={{ color: "var(--c-border)" }} />
              <div>
                <p className="text-sm font-medium" style={{ color: "var(--c-ink-muted)" }}>No artifacts yet</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>Files generated by TARS in chat, agent jobs, cron reports, and meetings appear here automatically.</p>
              </div>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {filtered.map(a => (
                <GridCard
                  key={a.id}
                  artifact={a}
                  selected={selectedId === a.id}
                  onClick={() => setSelectedId(a.id)}
                  onDelete={id => { setArtifacts(p => p.filter(x => x.id !== id)); if (selectedId === id) setSelectedId(null) }}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
              <div className="grid text-[0.65rem] font-semibold font-mono uppercase tracking-wider px-4 py-2.5"
                style={{ gridTemplateColumns: "3fr 1fr 1fr 80px 100px", backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-faint)", borderBottom: "1px solid var(--c-border)" }}>
                {["Name", "Type", "Source", "Size", "Date"].map(h => <span key={h}>{h}</span>)}
              </div>
              {filtered.map((a, i) => (
                <button key={a.id} onClick={() => setSelectedId(a.id)}
                  className="grid w-full text-left px-4 py-2.5 items-center transition-colors cursor-pointer"
                  style={{
                    gridTemplateColumns: "3fr 1fr 1fr 80px 100px",
                    borderTop: i > 0 ? `1px solid var(--c-border-faint)` : "none",
                    backgroundColor: selectedId === a.id ? "var(--c-canvas)" : "transparent",
                  }}
                  onMouseEnter={e => { if (selectedId !== a.id) e.currentTarget.style.backgroundColor = "var(--c-surface-2)" }}
                  onMouseLeave={e => { if (selectedId !== a.id) e.currentTarget.style.backgroundColor = "transparent" }}
                >
                  <span className="flex items-center gap-2 truncate">
                    <TypeIcon type={a.type} filename={a.filename} size="sm" />
                    <span className="text-xs font-medium truncate" style={{ color: "var(--c-ink)" }}>{a.filename}</span>
                  </span>
                  <span className="text-xs" style={{ color: "var(--c-ink-muted)" }}>{typeMeta(a.type).label}</span>
                  <span className="text-xs" style={{ color: "var(--c-ink-muted)" }}>{sourceLabel(a.source)}</span>
                  <span className="text-xs" style={{ color: "var(--c-ink-faint)" }}>{formatSize(a.size_bytes)}</span>
                  <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Artifact detail modal */}
      <ArtifactModal
        artifactId={selectedId}
        onClose={() => setSelectedId(null)}
        onDeleted={id => { setArtifacts(p => p.filter(a => a.id !== id)); setSelectedId(null) }}
      />
    </div>
  )
}
