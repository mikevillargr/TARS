"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Archive, Search, Grid2x2, List, Download, MessageSquare, X,
  FileText, Code2, FileSpreadsheet, FileAudio, BarChart2,
  ChevronDown, Loader2, Trash2, CheckSquare,
} from "lucide-react"
import { apiGet, apiPost, apiDelete } from "@/lib/api-client"

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TYPE_META: Record<string, { icon: React.ReactNode; bg: string; color: string; label: string }> = {
  document:    { icon: <FileText size={16} />,        bg: "var(--c-moss-soft)",  color: "var(--c-moss)",  label: "Document" },
  code:        { icon: <Code2 size={16} />,           bg: "var(--c-surface-2)", color: "var(--c-ink-muted)", label: "Code" },
  report:      { icon: <BarChart2 size={16} />,       bg: "var(--c-amber-soft)", color: "var(--c-amber)", label: "Report" },
  transcript:  { icon: <FileAudio size={16} />,       bg: "var(--c-rose-soft)",  color: "var(--c-rose)",  label: "Transcript" },
  spreadsheet: { icon: <FileSpreadsheet size={16} />, bg: "var(--c-moss-soft)",  color: "var(--c-moss)",  label: "Spreadsheet" },
}

function typeMeta(type: string) {
  return TYPE_META[type.toLowerCase()] ?? TYPE_META.document
}

function TypeIcon({ type, size = "sm" }: { type: string; size?: "sm" | "lg" }) {
  const meta = typeMeta(type)
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

function downloadArtifact(artifact: ArtifactDetail) {
  // Binary artifacts (DOCX, PPTX, PDF) are stored as base64 — use the server download endpoint
  if (artifact.content?.startsWith("base64:")) {
    const a = document.createElement("a")
    a.href = `/api/proxy/artifacts/${artifact.id}/download`
    a.download = artifact.filename
    a.click()
    return
  }
  // Text artifacts — client-side blob download
  const blob = new Blob([artifact.content ?? ""], { type: "text/plain" })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement("a")
  a.href = url; a.download = artifact.filename; a.click()
  URL.revokeObjectURL(url)
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
  const [confirmDel, setConfirmDel] = useState(false)
  const router = useRouter()

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirmDel) { setConfirmDel(true); return }
    try {
      await apiDelete(`/artifacts/${artifact.id}`)
      onDelete(artifact.id)
    } catch (err) { console.error(err) }
  }

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setConfirmDel(false) }}
      className="card text-left flex flex-col cursor-pointer transition-shadow hover:shadow-md relative overflow-hidden"
      style={{ padding: "0.875rem", height: "10rem", outline: selected ? "2px solid var(--c-moss)" : "none", outlineOffset: "1px" }}
    >
      <div className="flex items-start gap-3 flex-1 min-h-0">
        <TypeIcon type={artifact.type} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium leading-snug line-clamp-2" style={{ color: "var(--c-ink)" }}>{artifact.filename}</p>
          <p className="text-[11px] mt-0.5 truncate" style={{ color: "var(--c-ink-faint)" }}>{sourceLabel(artifact.source)}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: "1px solid var(--c-border-faint)" }}>
        <span className="text-[10px]" style={{ color: "var(--c-ink-faint)" }}>{formatDate(artifact.created_at)}</span>
        <span className="text-[10px]" style={{ color: "var(--c-ink-faint)" }}>{formatSize(artifact.size_bytes)}</span>
      </div>

      {hovered && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg flex-wrap p-2"
          style={{ backgroundColor: "color-mix(in srgb, var(--c-surface) 92%, transparent)", backdropFilter: "blur(2px)" }}
        >
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink)" }}
            onClick={e => { e.stopPropagation(); router.push("/chat") }}
          >
            <MessageSquare size={12} /> Chat
          </button>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: confirmDel ? "var(--c-rose)" : "var(--c-rose-soft)", color: confirmDel ? "#fff" : "var(--c-rose)" }}
            onClick={handleDelete}
          >
            <Trash2 size={12} /> {confirmDel ? "Confirm" : "Delete"}
          </button>
        </div>
      )}
    </button>
  )
}

// ─── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  artifactId,
  onClose,
  onDeleted,
}: {
  artifactId: string
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const router = useRouter()
  const [detail, setDetail]           = useState<ArtifactDetail | null>(null)
  const [loading, setLoading]         = useState(true)
  const [confirmDelete, setConfirm]   = useState(false)

  useEffect(() => {
    setLoading(true)
    setDetail(null)
    apiGet<ArtifactDetail>(`/artifacts/${artifactId}`)
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [artifactId])

  async function handleDelete() {
    await apiDelete(`/artifacts/${artifactId}`)
    onDeleted(artifactId)
  }

  const meta = detail ? typeMeta(detail.type) : typeMeta("document")
  const isCode = detail?.type === "code"

  return (
    <div
      className="w-[340px] border-l flex flex-col shrink-0"
      style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: "var(--c-border)" }}>
        <div className="flex items-center gap-2 min-w-0">
          {detail && <TypeIcon type={detail.type} />}
          <span className="text-sm font-semibold truncate" style={{ color: "var(--c-ink)" }}>{detail?.filename ?? "…"}</span>
        </div>
        <button onClick={onClose} className="p-1 rounded-md shrink-0 ml-1 hover:bg-surface-2" style={{ color: "var(--c-ink-muted)" }}>
          <X size={15} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={18} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
        </div>
      ) : !detail ? null : (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Meta badges */}
          <div className="flex flex-wrap gap-1.5">
            <span className="badge badge-neutral" style={{ backgroundColor: meta.bg, color: meta.color }}>{meta.label}</span>
            <span className="badge badge-neutral">{sourceLabel(detail.source)}</span>
            {detail.version > 1 && <span className="badge badge-amber">v{detail.version}</span>}
            <span className="badge badge-neutral">{formatSize(detail.size_bytes)}</span>
          </div>
          <div className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{formatDate(detail.created_at)}</div>

          {/* Tags */}
          {detail.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {detail.tags.map(t => (
                <span key={t} className="badge badge-neutral" style={{ fontSize: "0.7rem" }}>#{t}</span>
              ))}
            </div>
          )}

          {/* Preview */}
          {detail.content && (
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>Preview</div>
              {isCode ? (
                <pre
                  className="rounded-lg p-3 text-[11px] font-mono overflow-x-auto leading-relaxed"
                  style={{ backgroundColor: "#1a1714", color: "#e3ede9", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: "280px", overflowY: "auto" }}
                >
                  {detail.content.slice(0, 3000)}{detail.content.length > 3000 ? "\n…" : ""}
                </pre>
              ) : (
                <div
                  className="rounded-lg p-3 text-xs leading-relaxed overflow-y-auto"
                  style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border-faint)", maxHeight: "280px" }}
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="mb-1.5 last:mb-0" style={{ color: "var(--c-ink)" }}>{children}</p>,
                      h1: ({ children }) => <h1 className="font-semibold text-sm mb-1 mt-2" style={{ color: "var(--c-ink)" }}>{children}</h1>,
                      h2: ({ children }) => <h2 className="font-semibold text-xs mb-1 mt-2" style={{ color: "var(--c-ink)" }}>{children}</h2>,
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      code: ({ children }: any) => <code className="px-1 py-0.5 rounded text-[10px]" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-amber)" }}>{children}</code>,
                    }}
                  >
                    {`${detail.content.slice(0, 2000)}${detail.content.length > 2000 ? "\n\n…" : ""}`}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => detail.content && downloadArtifact(detail)}
              className="btn-secondary flex-1 justify-center"
              style={{ padding: "0.4rem 0.5rem", fontSize: "0.8rem" }}
            >
              <Download size={13} /> Download
            </button>
            <button
              onClick={() => router.push("/chat")}
              className="btn-primary flex-1 justify-center"
              style={{ padding: "0.4rem 0.5rem", fontSize: "0.8rem" }}
            >
              <MessageSquare size={13} /> Open in Chat
            </button>
            <button
              onClick={async () => {
                try {
                  await apiPost("/tasks", {
                    title: `Review: ${detail.filename}`,
                    status: "inbox",
                    linked_artifacts: [detail.id],
                  })
                  router.push("/tasks")
                } catch (err) { console.error(err) }
              }}
              className="btn-secondary flex-1 justify-center"
              style={{ padding: "0.4rem 0.5rem", fontSize: "0.8rem" }}
            >
              <CheckSquare size={13} /> Create Task
            </button>
          </div>

          {/* Delete */}
          <div className="pt-2 border-t" style={{ borderColor: "var(--c-border-faint)" }}>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirm(true)}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md"
                style={{ color: "var(--c-ink-faint)" }}
              >
                <Trash2 size={12} /> Delete artifact
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "var(--c-ink-muted)" }}>Delete permanently?</span>
                <button onClick={handleDelete} className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "var(--c-rose)", color: "#fff" }}>Yes</button>
                <button onClick={() => setConfirm(false)} className="text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}>No</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

const TYPE_FILTERS  = ["All Types", "document", "code", "report", "spreadsheet", "transcript"]
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

        {/* Content */}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map(a => (
                <GridCard
                  key={a.id}
                  artifact={a}
                  selected={selectedId === a.id}
                  onClick={() => setSelectedId(p => p === a.id ? null : a.id)}
                  onDelete={id => { setArtifacts(p => p.filter(x => x.id !== id)); if (selectedId === id) setSelectedId(null) }}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden" style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)" }}>
              <div className="grid text-[0.65rem] font-semibold uppercase tracking-wider px-4 py-2.5"
                style={{ gridTemplateColumns: "3fr 1fr 1fr 80px 100px", backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-faint)", borderBottom: "1px solid var(--c-border)" }}>
                {["Name", "Type", "Source", "Size", "Date"].map(h => <span key={h}>{h}</span>)}
              </div>
              {filtered.map((a, i) => (
                <button key={a.id} onClick={() => setSelectedId(p => p === a.id ? null : a.id)}
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
                    <TypeIcon type={a.type} size="sm" />
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

      {/* Detail panel */}
      {selectedId && (
        <DetailPanel
          artifactId={selectedId}
          onClose={() => setSelectedId(null)}
          onDeleted={id => { setArtifacts(p => p.filter(a => a.id !== id)); setSelectedId(null) }}
        />
      )}
    </div>
  )
}
