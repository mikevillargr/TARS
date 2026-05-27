"use client"

import { useState } from "react"
import {
  Archive,
  Search,
  Grid2x2,
  List,
  Download,
  MessageSquare,
  X,
  FileText,
  Code2,
  FileSpreadsheet,
  FileAudio,
  BarChart2,
  ChevronDown,
} from "lucide-react"
import { MOCK_ARTIFACTS } from "@/lib/mock-ui-data"

type Artifact = typeof MOCK_ARTIFACTS[number]

const TYPE_META: Record<string, { icon: React.ReactNode; bg: string; color: string }> = {
  Document:    { icon: <FileText size={16} />,        bg: "#e3ede9", color: "#2d5a4f" },
  Code:        { icon: <Code2 size={16} />,           bg: "#efeadf", color: "#6b6357" },
  Report:      { icon: <BarChart2 size={16} />,       bg: "#f5e8d5", color: "#b8651a" },
  Transcript:  { icon: <FileAudio size={16} />,       bg: "#f0dcdc", color: "#a04848" },
  Spreadsheet: { icon: <FileSpreadsheet size={16} />, bg: "#e3ede9", color: "#2d5a4f" },
}

function TypeIcon({ type, size = "sm" }: { type: string; size?: "sm" | "lg" }) {
  const meta = TYPE_META[type] ?? TYPE_META.Document
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

function GridCard({ artifact, selected, onClick }: { artifact: Artifact; selected: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="card text-left flex flex-col cursor-pointer transition-shadow hover:shadow-md relative overflow-hidden"
      style={{
        padding: "0.875rem",
        height: "10rem",
        outline: selected ? "2px solid #2d5a4f" : "none",
        outlineOffset: "1px",
      }}
    >
      <div className="flex items-start gap-3 flex-1 min-h-0">
        <TypeIcon type={artifact.type} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[#1a1714] leading-snug line-clamp-2">{artifact.name}</p>
          <p className="text-[11px] text-[#948a7b] mt-0.5 truncate">{artifact.sourceLabel}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: "1px solid #e8e2d4" }}>
        <span className="text-[10px] text-[#948a7b]">{formatDate(artifact.date)}</span>
        <span className="text-[10px] text-[#948a7b]">{artifact.size}</span>
      </div>

      {/* Hover overlay */}
      {hovered && (
        <div
          className="absolute inset-0 flex items-center justify-center gap-2 rounded-lg"
          style={{ backgroundColor: "rgba(251,250,246,0.92)", backdropFilter: "blur(2px)" }}
        >
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "#efeadf", color: "#1a1714" }}
            onClick={e => { e.stopPropagation() }}
          >
            <Download size={13} /> Download
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
            style={{ backgroundColor: "#e3ede9", color: "#2d5a4f" }}
            onClick={e => { e.stopPropagation() }}
          >
            <MessageSquare size={13} /> Chat
          </button>
        </div>
      )}
    </button>
  )
}

export default function ArtifactsPage() {
  const [artifacts]        = useState<Artifact[]>(MOCK_ARTIFACTS)
  const [selected, setSelected] = useState<Artifact | null>(null)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [search, setSearch]    = useState("")
  const [typeFilter]           = useState("All Types")
  const [sourceFilter]         = useState("All Sources")

  const filtered = artifacts.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.sourceLabel.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: "#f6f3ec" }}>
      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-5 py-3 border-b shrink-0"
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: "#efeadf" }}
              >
                <Archive size={17} style={{ color: "#6b6357" }} />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-[#1a1714] leading-tight" style={{ fontFamily: "var(--font-heading), serif" }}>
                  Artifacts
                </h1>
                <p className="text-xs text-[#948a7b] hidden sm:block">
                  Everything TARS produces — drafts, code, reports, transcripts.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setViewMode("grid")}
                className="p-2 rounded-lg transition-colors"
                style={{
                  backgroundColor: viewMode === "grid" ? "#efeadf" : "transparent",
                  color: viewMode === "grid" ? "#1a1714" : "#948a7b",
                }}
              >
                <Grid2x2 size={16} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className="p-2 rounded-lg transition-colors"
                style={{
                  backgroundColor: viewMode === "list" ? "#efeadf" : "transparent",
                  color: viewMode === "list" ? "#1a1714" : "#948a7b",
                }}
              >
                <List size={16} />
              </button>
            </div>
          </div>

          {/* Filters row */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-40">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#948a7b]" />
              <input
                className="input-field w-full"
                style={{ paddingLeft: "2rem", paddingTop: "0.3rem", paddingBottom: "0.3rem", fontSize: "0.8rem" }}
                placeholder="Search artifacts…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {["All Types", "All Sources"].map(label => (
              <button
                key={label}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors"
                style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6", color: "#6b6357" }}
              >
                {label} <ChevronDown size={12} />
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 gap-3 text-center">
              <Archive size={32} style={{ color: "#d8d2c4" }} />
              <div>
                <p className="text-sm font-medium text-[#6b6357]">No artifacts found</p>
                <p className="text-xs text-[#948a7b] mt-0.5">
                  Files generated by TARS in chat, agent jobs, cron reports, and meetings appear here.
                </p>
              </div>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map(artifact => (
                <GridCard
                  key={artifact.id}
                  artifact={artifact}
                  selected={selected?.id === artifact.id}
                  onClick={() => setSelected(prev => prev?.id === artifact.id ? null : artifact)}
                />
              ))}
            </div>
          ) : (
            /* List view */
            <div
              className="rounded-xl overflow-hidden"
              style={{ backgroundColor: "#fbfaf6", border: "1px solid #d8d2c4" }}
            >
              <div
                className="grid text-[0.65rem] font-semibold uppercase tracking-wider px-4 py-2.5"
                style={{
                  gridTemplateColumns: "3fr 1fr 1fr 1fr 80px 100px",
                  backgroundColor: "#efeadf",
                  color: "#948a7b",
                  borderBottom: "1px solid #d8d2c4",
                }}
              >
                {["Name", "Type", "Source", "Project", "Size", "Date"].map(h => (
                  <span key={h}>{h}</span>
                ))}
              </div>
              {filtered.map((artifact, i) => (
                <button
                  key={artifact.id}
                  onClick={() => setSelected(prev => prev?.id === artifact.id ? null : artifact)}
                  className="grid w-full text-left px-4 py-2.5 items-center transition-colors cursor-pointer"
                  style={{
                    gridTemplateColumns: "3fr 1fr 1fr 1fr 80px 100px",
                    borderTop: i > 0 ? "1px solid #e8e2d4" : "none",
                    backgroundColor: selected?.id === artifact.id ? "#f0ece4" : "transparent",
                  }}
                  onMouseEnter={e => { if (selected?.id !== artifact.id) e.currentTarget.style.backgroundColor = "#f6f3ec" }}
                  onMouseLeave={e => { if (selected?.id !== artifact.id) e.currentTarget.style.backgroundColor = "transparent" }}
                >
                  <span className="flex items-center gap-2 truncate">
                    <TypeIcon type={artifact.type} size="sm" />
                    <span className="text-xs font-medium text-[#1a1714] truncate">{artifact.name}</span>
                  </span>
                  <span className="text-xs text-[#6b6357]">{artifact.type}</span>
                  <span className="text-xs text-[#6b6357]">{artifact.source}</span>
                  <span className="text-xs text-[#6b6357] truncate">{artifact.project}</span>
                  <span className="text-xs text-[#948a7b]">{artifact.size}</span>
                  <span className="text-[11px] text-[#948a7b]">
                    {new Date(artifact.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      {selected && (
        <div
          className="w-[320px] border-l flex flex-col shrink-0"
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "#d8d2c4" }}
          >
            <div className="flex items-center gap-2 min-w-0">
              <TypeIcon type={selected.type} />
              <span className="text-sm font-semibold text-[#1a1714] truncate">{selected.name}</span>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md transition-colors shrink-0 ml-1"
              style={{ color: "#6b6357" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {/* Meta */}
            <div className="flex flex-wrap gap-1.5">
              <span className="badge badge-neutral">{selected.type}</span>
              <span className="badge badge-neutral">{selected.source}</span>
              <span className="badge badge-moss">{selected.project}</span>
              <span className="badge badge-neutral">{selected.size}</span>
            </div>

            <div className="text-[11px] text-[#948a7b]">{formatDate(selected.date)}</div>

            {/* Preview */}
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-2">
                Preview
              </div>
              <pre
                className="rounded-lg p-3 text-[11px] font-mono overflow-x-auto leading-relaxed"
                style={{
                  backgroundColor: "#1a1714",
                  color: "#e3ede9",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: "160px",
                  overflowY: "auto",
                }}
              >
                {selected.preview}
              </pre>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                className="btn-secondary flex-1 justify-center"
                style={{ padding: "0.4rem 0.5rem", fontSize: "0.8rem" }}
              >
                <Download size={13} /> Download
              </button>
              <button
                className="btn-primary flex-1 justify-center"
                style={{ padding: "0.4rem 0.5rem", fontSize: "0.8rem" }}
              >
                <MessageSquare size={13} /> Open in Chat
              </button>
            </div>

            {/* Version history */}
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-3">
                Version History
              </div>
              <div className="relative">
                <div
                  className="absolute left-[6px] top-2 bottom-2 w-px"
                  style={{ backgroundColor: "#d8d2c4" }}
                />
                <div className="flex flex-col gap-3">
                  {selected.versions.map((v, i) => (
                    <div key={v.label} className="flex items-start gap-3">
                      <div
                        className="w-3 h-3 rounded-full border-2 shrink-0 mt-0.5 z-10"
                        style={{
                          backgroundColor: i === 0 ? "#2d5a4f" : "#fbfaf6",
                          borderColor: i === 0 ? "#2d5a4f" : "#d8d2c4",
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-[#1a1714]">{v.label}</span>
                          {i === 0 && (
                            <span className="badge badge-moss" style={{ fontSize: "0.6rem" }}>Current</span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#948a7b] mt-0.5">{v.note}</div>
                        <div className="text-[10px] text-[#948a7b]">
                          {new Date(v.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Tags */}
            {selected.tags.length > 0 && (
              <div>
                <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-2">
                  Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.tags.map(tag => (
                    <span key={tag} className="badge badge-neutral" style={{ fontSize: "0.7rem" }}>
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
