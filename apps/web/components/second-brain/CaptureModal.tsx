"use client"

import { useState } from "react"
import { X, Link as LinkIcon, FileText, Loader2, ChevronDown } from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { apiPost } from "@/lib/api-client"
import { TiptapEditor } from "./TiptapEditor"

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

export interface CaptureModalProps {
  open: boolean
  onClose: () => void
  onSaved: (item: KnowledgeItem) => void
  defaultTab?: "url" | "document"
}

const DOMAINS = ["work", "personal", "cycling", "client", "health"]

export function CaptureModal({ open, onClose, onSaved, defaultTab = "url" }: CaptureModalProps) {
  const [tab, setTab] = useState<"url" | "document">(defaultTab)
  // URL tab
  const [captureUrl, setCaptureUrl] = useState("")
  // Document tab
  const [docTitle, setDocTitle] = useState("")
  const [docMarkdown, setDocMarkdown] = useState("")
  // Shared metadata
  const [captureNote, setCaptureNote] = useState("")
  const [captureTags, setCaptureTags] = useState("")
  const [captureDomain, setCaptureDomain] = useState("work")
  const [showMeta, setShowMeta] = useState(false)
  // State
  const [ingesting, setIngesting] = useState(false)
  const [ingestError, setIngestError] = useState("")

  const canSave = tab === "url"
    ? captureUrl.trim().length > 0
    : docTitle.trim().length > 0 && docMarkdown.trim().length > 0

  async function handleSave() {
    setIngestError("")
    setIngesting(true)
    try {
      const tags = captureTags.split(",").map(t => t.trim()).filter(Boolean)
      let item: KnowledgeItem
      if (tab === "url") {
        item = await apiPost<KnowledgeItem>("/second-brain/ingest/url", {
          url: captureUrl.trim(),
          personal_note: captureNote,
          tags,
          domain: captureDomain,
        })
      } else {
        item = await apiPost<KnowledgeItem>("/second-brain/ingest/document", {
          content: docMarkdown,
          title: docTitle.trim(),
          personal_note: captureNote,
          tags,
          domain: captureDomain,
        })
      }
      onSaved(item)
      handleClose()
    } catch (e: unknown) {
      setIngestError(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setIngesting(false)
    }
  }

  function handleClose() {
    // Reset state
    setCaptureUrl(""); setDocTitle(""); setDocMarkdown("")
    setCaptureNote(""); setCaptureTags(""); setCaptureDomain("work")
    setShowMeta(false); setIngestError("")
    setTab(defaultTab)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleClose() }}>
      <DialogContent
        className="max-w-[95vw] w-full h-[95vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b shrink-0" style={{ borderColor: "#d8d2c4" }}>
          <div className="flex items-center gap-3">
            <span className="font-serif text-base font-medium" style={{ color: "#1a1714" }}>Quick Capture</span>
            {/* Tab switcher */}
            <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: "#f0ebe1" }}>
              {([
                { id: "url", label: "URL", icon: LinkIcon },
                { id: "document", label: "Document", icon: FileText },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all"
                  style={tab === id
                    ? { background: "#fff", color: "#1a1714", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }
                    : { color: "#948a7b" }
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
            style={{ color: "#948a7b" }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — scrollable for URL tab, flex-1 for Document tab */}
        {tab === "url" ? (
          <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-wider font-medium mb-1.5" style={{ color: "#948a7b" }}>
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
        ) : (
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
                style={{ color: "#1a1714", fontFamily: "var(--font-heading), serif" }}
              />
            </div>
            {/* Editor */}
            <div className="flex-1 min-h-0 overflow-hidden border-t" style={{ borderColor: "#e8e2d4" }}>
              <TiptapEditor
                content=""
                onChange={setDocMarkdown}
                placeholder="Start writing, or type '/' for commands…"
                autoFocus={false}
                resetKey="new"
              />
            </div>
            {/* Metadata accordion */}
            <div className="border-t px-5 py-2 shrink-0" style={{ borderColor: "#e8e2d4" }}>
              <MetadataFields
                note={captureNote} onNoteChange={setCaptureNote}
                tags={captureTags} onTagsChange={setCaptureTags}
                domain={captureDomain} onDomainChange={setCaptureDomain}
                show={showMeta} onToggle={() => setShowMeta(p => !p)}
              />
            </div>
          </div>
        )}

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t shrink-0"
          style={{ borderColor: "#d8d2c4", background: "#faf8f4" }}
        >
          <div>
            {ingestError && (
              <p className="text-xs" style={{ color: "#a04848" }}>{ingestError}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} className="btn-ghost text-sm">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!canSave || ingesting}
              className="flex items-center gap-1.5 text-sm disabled:opacity-50"
              style={{
                background: "#2d5a4f", color: "#fff",
                padding: "0.375rem 1rem", borderRadius: "0.5rem",
                fontWeight: 500,
              }}
            >
              {ingesting ? <Loader2 size={13} className="animate-spin" /> : null}
              {tab === "url" ? "Scrape & Save" : "Save Document"}
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
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 text-xs mb-2 transition-colors"
        style={{ color: "#948a7b" }}
      >
        <ChevronDown size={12} style={{ transform: show ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        Metadata {show ? "" : "(optional)"}
      </button>
      {show && (
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "#948a7b" }}>
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
              <label className="block text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "#948a7b" }}>
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
              <label className="block text-[10px] uppercase tracking-wider font-medium mb-1" style={{ color: "#948a7b" }}>
                Domain
              </label>
              <select
                value={domain}
                onChange={e => onDomainChange(e.target.value)}
                className="input-field w-full"
              >
                {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
