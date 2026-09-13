"use client"

import { useCallback, useRef, useState } from "react"
import Link from "next/link"
import {
  ChevronDown, Download, ExternalLink, File, FileCode2, FileSpreadsheet,
  FileText, Image as ImageIcon, Layout, Loader2, X,
} from "lucide-react"

import { DataTable } from "./DataTable"
import { MessageContent } from "./MessageContent"

/**
 * A file TARS made, judged without leaving the conversation that made it.
 *
 * The card used to be a receipt: a filename, a download button, a link out. To
 * find out whether the report was any good you left chat, opened Artifacts,
 * found it, and opened it — four steps to answer "is this right?" about
 * something produced two seconds ago in front of you.
 *
 * Reference: Manus, the closest analogue (an agent that generates files inside a
 * chat). Its inline file card is compact and expands rather than opening a
 * panel. That matters here specifically: TARS's right-panel slot is already
 * contested by the browser observation panel, so a third surface would fight
 * for the same space. The preview is bounded and scrolls internally — an 8,000
 * character dump inline would wreck the conversation's own scroll.
 *
 * What it refuses to do is pretend. A real binary gets an honest "no preview",
 * not a wall of decoded noise — the same test the browser artifacts settled on:
 * if Mike cannot read it, do not put it in front of him claiming he can.
 */

export interface ArtifactRef {
  artifact_id: string
  filename: string
  filetype?: string
}

interface PreviewData {
  text: string
  type: "text" | "docx" | "pptx" | "image" | "binary"
}

const ICONS: Record<string, typeof FileText> = {
  docx: FileText, doc: FileText, pdf: File, pptx: Layout, ppt: Layout,
  xlsx: FileSpreadsheet, xls: FileSpreadsheet, csv: FileSpreadsheet,
  png: ImageIcon, jpg: ImageIcon, jpeg: ImageIcon, gif: ImageIcon, webp: ImageIcon,
  md: FileText, txt: FileText,
  py: FileCode2, ts: FileCode2, tsx: FileCode2, js: FileCode2, json: FileCode2,
  sh: FileCode2, sql: FileCode2, html: FileCode2, css: FileCode2, yml: FileCode2,
}

const LABELS: Record<string, string> = {
  docx: "Word document", doc: "Word document", pdf: "PDF", pptx: "Presentation",
  ppt: "Presentation", xlsx: "Spreadsheet", xls: "Spreadsheet", csv: "CSV",
  md: "Markdown", txt: "Text",
}

const CODE_EXTS = new Set([
  "py", "ts", "tsx", "js", "jsx", "json", "sh", "sql", "html", "css", "yml",
  "yaml", "toml", "xml", "go", "rs", "java", "rb", "php", "c", "cpp",
])

function extOf(filename: string): string {
  return filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : ""
}

/** RFC4180-ish: quoted fields, escaped quotes, commas and newlines inside them. */
function parseCsv(text: string): { headers: string[]; rows: string[][] } | null {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
      continue
    }
    if (c === '"') { quoted = true; continue }
    if (c === ",") { row.push(field); field = ""; continue }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field); field = ""
      rows.push(row); row = []
      continue
    }
    field += c
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row) }

  const clean = rows.filter(r => r.some(c => c.trim() !== ""))
  if (clean.length < 2) return null
  return { headers: clean[0], rows: clean.slice(1) }
}

export function ArtifactPreviewCard({
  artifact,
  onDismiss,
}: {
  artifact: ArtifactRef
  onDismiss?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const fetched = useRef(false)

  const ext = extOf(artifact.filename) || (artifact.filetype ?? "")
  const Icon = ICONS[ext] ?? FileText
  const label = LABELS[ext] ?? (ext ? ext.toUpperCase() : "File")
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)

  const load = useCallback(async () => {
    if (fetched.current) return
    fetched.current = true
    setLoading(true)
    try {
      const res = await fetch(`/api/proxy/artifacts/${artifact.artifact_id}/preview`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch {
      // Say what happened. A silent empty body reads as "the file is empty",
      // which is a different and much more alarming fact than "fetch failed".
      setError("Could not load a preview. The file is still in Artifacts.")
    } finally {
      setLoading(false)
    }
  }, [artifact.artifact_id])

  // Loaded from the click, not from an effect on `open`. Expanding IS the
  // event; routing it through a render pass only adds a cascading render.
  const toggle = () => {
    setOpen(o => !o)
    if (!open) void load()
  }

  return (
    <div
      className="rounded-xl overflow-hidden w-full max-w-2xl"
      style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-surface)" }}
    >
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}
        >
          <Icon size={16} />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: "var(--c-ink)" }}>
            {artifact.filename}
          </p>
          <p className="tars-label tars-label--muted">{label} · SAVED TO ARTIFACTS</p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={toggle}
            className="tars-label flex items-center gap-1 px-2 py-1.5 rounded-lg"
            style={{ color: open ? "var(--c-moss)" : "var(--c-ink-faint)" }}
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : (
              <ChevronDown
                size={11}
                style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 180ms" }}
              />
            )}
            PREVIEW
          </button>
          <a
            href={`/api/proxy/artifacts/${artifact.artifact_id}/download`}
            download={artifact.filename}
            className="p-1.5 rounded-lg"
            style={{ color: "var(--c-ink-faint)", backgroundColor: "var(--c-surface-2)" }}
            title="Download"
          >
            <Download size={13} />
          </a>
          <Link
            href={`/artifacts?open=${artifact.artifact_id}`}
            className="p-1.5 rounded-lg"
            style={{ color: "var(--c-ink-faint)", backgroundColor: "var(--c-surface-2)" }}
            title="Open in Artifacts"
          >
            <ExternalLink size={13} />
          </Link>
          {onDismiss && (
            <button onClick={onDismiss} className="p-1" style={{ color: "var(--c-ink-faint)" }} title="Dismiss">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {open && (
        <div style={{ borderTop: "1px solid var(--c-border-faint)", backgroundColor: "var(--c-canvas)" }}>
          <PreviewBody
            artifact={artifact}
            ext={ext}
            isImage={isImage}
            data={data}
            error={error}
            loading={loading}
          />
        </div>
      )}
    </div>
  )
}

/** Hoisted: a component defined inside the card would be a new type on every
 *  render, remounting the preview and refetching it. */
function PreviewBody({
  artifact, ext, isImage, data, error, loading,
}: {
  artifact: ArtifactRef
  ext: string
  isImage: boolean
  data: PreviewData | null
  error: string | null
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="px-3.5 py-4 tars-label tars-label--muted flex items-center gap-2">
        <Loader2 size={11} className="animate-spin" /> READING FILE
      </div>
    )
  }
  if (error) {
    return <div className="px-3.5 py-3 text-sm" style={{ color: "var(--c-ink-muted)" }}>{error}</div>
  }
  if (!data) return null

  if (isImage || data.type === "image") {
    return (
      <div className="p-3">
        {/* Bordered, on its own surface: a page archive is usually a screenshot
            of something mostly white, which against the canvas looks like a
            blank box where an image failed rather than an image that loaded. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/proxy/artifacts/${artifact.artifact_id}/view`}
          alt={artifact.filename}
          style={{
            maxWidth: "100%", maxHeight: 420, borderRadius: 6, display: "block",
            margin: "0 auto", backgroundColor: "var(--c-surface-2)",
            border: "1px solid var(--c-border-faint)",
          }}
        />
      </div>
    )
  }

  const text = (data.text ?? "").trim()

  if (!text) {
    // The honest end of the range. Decoding a .pptx into visible bytes would be
    // worse than saying nothing: it looks like content and is not.
    return (
      <div className="px-3.5 py-3 text-sm" style={{ color: "var(--c-ink-muted)" }}>
        No preview for this file type. Download it or open it in Artifacts.
      </div>
    )
  }

  // A CSV is a table, and the table renderer already earns its keep — this makes
  // a downloaded invoice sortable in the same place it arrived.
  if (ext === "csv") {
    const parsed = parseCsv(text)
    if (parsed) {
      return (
        <div className="px-2 py-1" style={{ maxHeight: 420, overflowY: "auto" }}>
          <DataTable headers={parsed.headers} rows={parsed.rows} title={artifact.filename.replace(/\.csv$/i, "")} />
        </div>
      )
    }
  }

  if (CODE_EXTS.has(ext)) {
    return (
      <pre
        className="px-3.5 py-3 text-xs overflow-auto"
        style={{ maxHeight: 420, color: "var(--c-ink)", fontFamily: "var(--font-mono)", margin: 0 }}
      >
        {text}
      </pre>
    )
  }

  return (
    <div className="px-3.5 py-1" style={{ maxHeight: 420, overflowY: "auto" }}>
      {(data.type === "docx" || data.type === "pptx") && (
        <p className="tars-label tars-label--muted pt-2.5">TEXT EXTRACT · FORMATTING NOT SHOWN</p>
      )}
      <MessageContent content={text} />
    </div>
  )
}
