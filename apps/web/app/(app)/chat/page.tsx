"use client"

import React, { useState, useEffect, useCallback, useRef, Suspense, useMemo, memo } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import {
  Send, Paperclip, Camera, Mic, Plus, User,
  Terminal, ChevronLeft, PanelLeft, Maximize2,
  Minimize2, X, Calendar, CheckSquare, Loader2, Menu,
  Square, Trash2, FileText, File, Layout, Download, ExternalLink,
  Mail, Phone, PhoneCall, BriefcaseBusiness, MessageSquare, Search, UserPlus,
  Copy, Check, ZoomIn, Brain,
} from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"
import { apiGet, apiPost, apiDelete, apiUpload } from "@/lib/api-client"
import AgentStatusChip from "@/components/agent-jobs/AgentStatusChip"
import { MessageContent } from "@/components/chat/MessageContent"
import { MessageActions } from "@/components/chat/MessageActions"
import { useVoiceInput } from "@/hooks/useVoiceInput"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useNotificationContext } from "@/context/NotificationContext"

// ─── Types ────────────────────────────────────────────────────────
interface Conversation {
  id: string
  title: string | null
  created_at: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  model_used?: string
  tool_calls?: string[]
  tool_results?: Array<{ type: string; [k: string]: unknown }>
  created_at: string
}

interface StreamingMsg {
  role: "assistant"
  content: string
  streaming: true
}

interface AgentStreamMessage {
  id: string
  role: "agent_stream"
  job_id: string
  agent_type: string
  instruction: string
  created_at: string
}

interface TaskSuggestion {
  tool_use_id: string
  title: string
  description?: string
  priority?: "urgent" | "high" | "normal" | "low"
  due_at?: string
}

interface CalendarSuggestion {
  tool_use_id: string
  title: string
  datetime_iso: string
  duration_min?: number
  description?: string
  location?: string
}

function formatSuggestTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  } catch { return iso }
}

function CalendarSuggestChip({ suggestion, onDismiss }: { suggestion: CalendarSuggestion; onDismiss: () => void }) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)

  async function addToCalendar() {
    setAdding(true)
    try {
      await apiPost("/calendar/events", {
        title: suggestion.title,
        start: suggestion.datetime_iso,
        duration_min: suggestion.duration_min ?? 60,
        description: suggestion.description,
        location: suggestion.location,
      })
      setAdded(true)
    } catch (err) {
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  if (added) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs max-w-sm" style={{ backgroundColor: "var(--c-moss-soft)", border: "1px solid color-mix(in srgb, var(--c-moss) 25%, transparent)" }}>
        <Calendar size={12} style={{ color: "var(--c-moss)", flexShrink: 0 }} />
        <span className="flex-1 font-medium" style={{ color: "var(--c-moss)" }}>Added to calendar</span>
        <button onClick={onDismiss} style={{ color: "var(--c-ink-faint)" }}><X size={11} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs max-w-sm" style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border-faint)" }}>
      <Calendar size={12} style={{ color: "var(--c-moss)", flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <span className="font-medium" style={{ color: "var(--c-ink)" }}>{suggestion.title}</span>
        <span className="ml-1.5" style={{ color: "var(--c-ink-faint)" }}>{formatSuggestTime(suggestion.datetime_iso)}</span>
      </div>
      <button
        onClick={addToCalendar}
        disabled={adding}
        className="shrink-0 font-medium disabled:opacity-50 flex items-center gap-1"
        style={{ color: "var(--c-moss)" }}
        onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
        onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
      >
        {adding ? <Loader2 size={10} className="animate-spin" /> : null}
        Add to Calendar
      </button>
      <button onClick={onDismiss} style={{ color: "var(--c-ink-faint)" }}><X size={11} /></button>
    </div>
  )
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "var(--c-rose)",
  high:   "var(--c-amber)",
  normal: "var(--c-moss)",
  low:    "var(--c-ink-faint)",
}

function TaskSuggestChip({ suggestion, onDismiss }: { suggestion: TaskSuggestion; onDismiss: () => void }) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded]   = useState(false)

  async function addTask() {
    setAdding(true)
    try {
      await apiPost("/tasks", {
        title:       suggestion.title,
        description: suggestion.description,
        priority:    suggestion.priority ?? "normal",
        due_at:      suggestion.due_at ?? null,
      })
      setAdded(true)
    } catch (err) {
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  const priorityColor = PRIORITY_COLORS[suggestion.priority ?? "normal"]

  if (added) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs max-w-sm" style={{ backgroundColor: "var(--c-moss-soft)", border: "1px solid color-mix(in srgb, var(--c-moss) 25%, transparent)" }}>
        <CheckSquare size={12} style={{ color: "var(--c-moss)", flexShrink: 0 }} />
        <span className="flex-1 font-medium" style={{ color: "var(--c-moss)" }}>Added to tasks</span>
        <button onClick={onDismiss} style={{ color: "var(--c-ink-faint)" }}><X size={11} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs max-w-sm" style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border-faint)" }}>
      <CheckSquare size={12} style={{ color: priorityColor, flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <span className="font-medium" style={{ color: "var(--c-ink)" }}>{suggestion.title}</span>
        {suggestion.priority && suggestion.priority !== "normal" && (
          <span className="ml-1.5 uppercase text-[9px] font-semibold tracking-wider" style={{ color: priorityColor }}>
            {suggestion.priority}
          </span>
        )}
        {suggestion.due_at && (
          <span className="ml-1.5" style={{ color: "var(--c-ink-faint)" }}>
            due {new Date(suggestion.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
      </div>
      <button
        onClick={addTask}
        disabled={adding}
        className="shrink-0 font-medium disabled:opacity-50 flex items-center gap-1"
        style={{ color: "var(--c-moss)" }}
        onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
        onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
      >
        {adding ? <Loader2 size={10} className="animate-spin" /> : null}
        Add Task
      </button>
      <button onClick={onDismiss} style={{ color: "var(--c-ink-faint)" }}><X size={11} /></button>
    </div>
  )
}

// ─── Artifact notification card ──────────────────────────────────
interface ArtifactNotification {
  artifact_id: string
  filename: string
  filetype: "docx" | "pptx" | "pdf"
}

const ARTIFACT_TYPE_ICON: Record<string, React.ElementType> = {
  docx: FileText,
  pptx: Layout,
  pdf:  File,
}
const ARTIFACT_TYPE_LABEL: Record<string, string> = {
  docx: "Word Document",
  pptx: "PowerPoint",
  pdf:  "PDF",
}

function ArtifactCard({ n, onDismiss }: { n: ArtifactNotification; onDismiss: () => void }) {
  const Icon = ARTIFACT_TYPE_ICON[n.filetype] ?? FileText

  return (
    <div className="flex items-center gap-3 rounded-xl px-3.5 py-2.5 max-w-sm" style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-surface)" }}>
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: "var(--c-ink)" }}>{n.filename}</p>
        <p className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{ARTIFACT_TYPE_LABEL[n.filetype] ?? n.filetype.toUpperCase()} · Saved to Artifacts</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <a
          href={`/api/proxy/artifacts/${n.artifact_id}/download`}
          download={n.filename}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: "var(--c-ink-faint)", backgroundColor: "var(--c-surface-2)" }}
          title="Download"
        >
          <Download size={14} />
        </a>
        <Link
          href={`/artifacts?open=${n.artifact_id}`}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}
        >
          <ExternalLink size={12} />
          Open
        </Link>
        <button onClick={onDismiss} className="p-1" style={{ color: "var(--c-ink-faint)" }} title="Dismiss">
          <X size={11} />
        </button>
      </div>
    </div>
  )
}

// ─── Chart image card ─────────────────────────────────────────────
function ChartImageCard({ title, imageBase64, onDismiss, onAsk }: {
  title: string
  imageBase64: string
  onDismiss: () => void
  onAsk: (q: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [saving, setSaving] = useState<"brain" | "task" | null>(null)
  const [saved, setSaved] = useState<"brain" | "task" | null>(null)
  const src = `data:image/png;base64,${imageBase64}`

  async function saveToSecondBrain() {
    setSaving("brain")
    try {
      const blob = await fetch(src).then(r => r.blob())
      const fd = new FormData()
      fd.append("file", blob, `${title.replace(/\s+/g, "_")}.png`)
      fd.append("title", title)
      fd.append("personal_note", "Chart generated by TARS")
      await apiUpload("/second-brain/items/upload", fd)
      setSaved("brain")
      setTimeout(() => setSaved(null), 2500)
    } catch { /* ignore */ }
    finally { setSaving(null) }
  }

  async function createTask() {
    setSaving("task")
    try {
      await apiPost("/tasks", { title: `Review chart: ${title}`, status: "inbox", priority: "normal" })
      setSaved("task")
      setTimeout(() => setSaved(null), 2500)
    } catch { /* ignore */ }
    finally { setSaving(null) }
  }

  return (
    <>
      <div className="rounded-xl overflow-hidden border" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface-raised)" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: "var(--c-border)" }}>
          <span className="text-xs font-medium" style={{ color: "var(--c-ink-muted)" }}>{title}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setExpanded(true)} className="p-1.5 rounded hover:opacity-70 transition-opacity" style={{ color: "var(--c-ink-faint)" }} title="Expand">
              <ZoomIn size={13} />
            </button>
            <button onClick={onDismiss} className="p-1.5 rounded hover:opacity-70 transition-opacity" style={{ color: "var(--c-ink-faint)" }} title="Dismiss">
              <X size={13} />
            </button>
          </div>
        </div>

        {/* Image */}
        <img
          src={src}
          alt={title}
          className="w-full block cursor-zoom-in"
          style={{ maxHeight: "480px", objectFit: "contain" }}
          onClick={() => setExpanded(true)}
        />

        {/* Action chips */}
        <div className="flex items-center gap-2 px-3 py-2 border-t" style={{ borderColor: "var(--c-border)" }}>
          <button
            onClick={saveToSecondBrain}
            disabled={saving === "brain"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: saved === "brain" ? "var(--c-moss-soft)" : "var(--c-surface-2)", color: saved === "brain" ? "var(--c-moss)" : "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}
          >
            {saving === "brain" ? <Loader2 size={11} className="animate-spin" /> : <Brain size={11} />}
            {saved === "brain" ? "Saved!" : "Second Brain"}
          </button>
          <button
            onClick={createTask}
            disabled={saving === "task"}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: saved === "task" ? "var(--c-moss-soft)" : "var(--c-surface-2)", color: saved === "task" ? "var(--c-moss)" : "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}
          >
            {saving === "task" ? <Loader2 size={11} className="animate-spin" /> : <CheckSquare size={11} />}
            {saved === "task" ? "Created!" : "Create Task"}
          </button>
          <button
            onClick={() => { const a = document.createElement("a"); a.href = src; a.download = `${title}.png`; a.click() }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)", border: "1px solid var(--c-border)" }}
          >
            <Download size={11} />
            Download
          </button>
        </div>
      </div>

      {/* Lightbox */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
          onClick={() => setExpanded(false)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "#fff" }}
            onClick={() => setExpanded(false)}
          >
            <X size={20} />
          </button>
          <img
            src={src}
            alt={title}
            className="max-w-full max-h-full rounded-xl"
            style={{ boxShadow: "0 0 60px rgba(0,0,0,0.5)" }}
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}

// ─── Contact card ─────────────────────────────────────────────────
interface ContactResult {
  id: string | null
  display_name: string | null
  primary_email: string | null
  primary_phone: string | null
  organization: string | null
  job_title: string | null
  tars_context: string | null
  source: "local" | "google_live"
  is_other_contact?: boolean
}

interface ContactResultSet {
  tool_use_id: string
  contacts: ContactResult[]
}

function ContactActionChip({
  icon: Icon, label, href, onClick, accent,
}: {
  icon: React.ElementType; label: string
  href?: string; onClick?: () => void; accent?: boolean
}) {
  const cls = "inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors"
  const style = accent
    ? { backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }
    : { backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }
  const hoverStyle = accent
    ? { backgroundColor: "color-mix(in srgb, var(--c-moss) 20%, transparent)", color: "var(--c-moss)" }
    : { backgroundColor: "var(--c-surface-3)", color: "var(--c-ink)" }
  if (href) {
    return (
      <a href={href} target={href.startsWith("mailto:") || href.startsWith("tel:") ? undefined : "_self"}
        className={cls} style={style}
        onMouseEnter={e => Object.assign((e.currentTarget as HTMLElement).style, hoverStyle)}
        onMouseLeave={e => Object.assign((e.currentTarget as HTMLElement).style, style)}
      >
        <Icon size={10} />{label}
      </a>
    )
  }
  return (
    <button onClick={onClick} className={cls} style={style}
      onMouseEnter={e => Object.assign((e.currentTarget as HTMLElement).style, hoverStyle)}
      onMouseLeave={e => Object.assign((e.currentTarget as HTMLElement).style, style)}
    >
      <Icon size={10} />{label}
    </button>
  )
}

function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — silently ignore */ }
  }
  return (
    <ContactActionChip
      icon={copied ? Check : Copy}
      label={copied ? "Copied" : label}
      onClick={handleCopy}
    />
  )
}

function ContactCard({ set, onDismiss, onAsk }: {
  set: ContactResultSet
  onDismiss: () => void
  onAsk: (q: string) => void
}) {
  return (
    <div className="flex flex-col gap-2 max-w-lg">
      {set.contacts.map((c, i) => {
        const initials = (c.display_name ?? c.primary_email ?? "?")
          .split(" ").slice(0, 2).map((p: string) => p[0] ?? "").join("").toUpperCase() || "?"
        const name = c.display_name ?? c.primary_email ?? "this person"

        return (
          <div
            key={i}
            className="rounded-xl p-3.5 flex flex-col gap-2.5"
            style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-canvas)" }}
          >
            {/* Top row: avatar + details + dismiss */}
            <div className="flex items-start gap-3">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}
              >
                {initials}
              </div>

              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm leading-snug" style={{ color: "var(--c-ink)" }}>
                  {c.display_name ?? c.primary_email ?? "Unknown"}
                </div>
                {(c.job_title || c.organization) && (
                  <div className="flex items-center gap-1 mt-0.5 text-xs" style={{ color: "var(--c-ink-muted)" }}>
                    <BriefcaseBusiness size={10} style={{ flexShrink: 0 }} />
                    <span className="truncate">{[c.job_title, c.organization].filter(Boolean).join(" · ")}</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {c.primary_email && (
                    <a href={`mailto:${c.primary_email}`}
                      className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-75"
                      style={{ color: "var(--c-moss)" }}
                    >
                      <Mail size={10} style={{ flexShrink: 0 }} />{c.primary_email}
                    </a>
                  )}
                  {c.primary_phone && (
                    <a href={`tel:${c.primary_phone}`}
                      className="flex items-center gap-1 text-[11px] transition-opacity hover:opacity-75"
                      style={{ color: "var(--c-ink-muted)" }}
                    >
                      <Phone size={10} style={{ flexShrink: 0 }} />{c.primary_phone}
                    </a>
                  )}
                </div>
                {c.tars_context && (
                  <div className="mt-1.5 text-[11px] italic leading-relaxed" style={{ color: "var(--c-ink-faint)" }}>
                    {c.tars_context.slice(0, 160)}{c.tars_context.length > 160 ? "…" : ""}
                  </div>
                )}
              </div>

              {i === 0 && (
                <button onClick={onDismiss} className="shrink-0 mt-0.5" style={{ color: "var(--c-ink-faint)" }}>
                  <X size={12} />
                </button>
              )}
            </div>

            {/* Action chips */}
            <div className="flex flex-wrap gap-1.5 pl-12">
              {/* Email chips */}
              {c.primary_email && (
                <>
                  <ContactActionChip icon={Mail} label="Email" href={`mailto:${c.primary_email}`} />
                  <CopyChip value={c.primary_email} label="Copy email" />
                </>
              )}

              {/* Phone chips */}
              {c.primary_phone && (
                <>
                  <ContactActionChip icon={PhoneCall} label="Call" href={`tel:${c.primary_phone}`} />
                  <CopyChip value={c.primary_phone} label="Copy number" />
                </>
              )}

              {/* TARS actions */}
              <ContactActionChip
                icon={Calendar}
                label="Schedule"
                onClick={() => onAsk(`Schedule a meeting with ${name}`)}
              />
              <ContactActionChip
                icon={CheckSquare}
                label="Create task"
                onClick={() => onAsk(`Create a task related to ${name}`)}
              />
              {c.primary_email && (
                <ContactActionChip
                  icon={Search}
                  label="Find emails"
                  onClick={() => onAsk(`Show me recent emails from ${c.primary_email}`)}
                />
              )}
              <ContactActionChip
                icon={MessageSquare}
                label="Meeting history"
                onClick={() => onAsk(`What meetings have I had with ${name}?`)}
              />

              {/* Add to contacts — for live search results and unsaved other-contacts */}
              {(c.source === "google_live" || c.is_other_contact) && (
                <ContactActionChip
                  icon={UserPlus}
                  label="Add to contacts"
                  accent
                  onClick={() => onAsk(
                    c.primary_email
                      ? `Add ${name} (${c.primary_email}) to my Google Contacts`
                      : `Add ${name} to my Google Contacts`
                  )}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Place card ───────────────────────────────────────────────────
interface PlaceResult {
  name: string
  address: string | null
  lat: number
  lng: number
  category: string | null
  osm_id: string | null
  osm_type: string | null
  source: string
  is_saved: boolean
  notes?: string | null
  tags?: string[]
}

interface PlaceResultSet {
  tool_use_id: string
  places: PlaceResult[]
}

import dynamic from "next/dynamic"

const PlaceMap = dynamic(
  () => import("@/components/chat/PlaceMap"),
  {
    ssr: false,
    loading: () => (
      <div className="w-full animate-pulse rounded-t-xl" style={{ height: 200, backgroundColor: "#e8e0d0" }} />
    ),
  }
)

function osmUrl(p: PlaceResult) {
  if (p.osm_type && p.osm_id) {
    return `https://www.openstreetmap.org/${p.osm_type}/${p.osm_id}`
  }
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`
}

function PlaceCard({
  set, onDismiss,
}: {
  set: PlaceResultSet
  onDismiss: () => void
}) {
  return (
    <div className="flex flex-col gap-3 w-full max-w-lg">
      {set.places.map((p, i) => {
        const catLabel = p.category
          ? p.category.charAt(0).toUpperCase() + p.category.slice(1).replace(/_/g, " ")
          : null

        return (
          <div
            key={i}
            className="rounded-xl overflow-hidden w-full"
            style={{ border: "1px solid var(--c-border)", backgroundColor: "var(--c-canvas)", isolation: "isolate" }}
          >
            {/* Map — tapping opens Google Maps for full navigation experience */}
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block"
              style={{ height: 200, position: "relative" }}
            >
              <PlaceMap lat={p.lat} lng={p.lng} />
            </a>

            {/* Info */}
            <div className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm leading-snug" style={{ color: "var(--c-ink)" }}>
                    {p.name}
                  </p>
                  {catLabel && (
                    <span
                      className="inline-block mt-0.5 mr-1.5 px-1.5 py-0.5 rounded text-[10px] font-medium"
                      style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}
                    >
                      {catLabel}
                    </span>
                  )}
                </div>
                {i === 0 && (
                  <button
                    onClick={onDismiss}
                    className="shrink-0 p-0.5 rounded"
                    style={{ color: "var(--c-ink-faint)" }}
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {p.address && (
                <p className="mt-1.5 text-xs leading-snug" style={{ color: "var(--c-ink-muted)" }}>
                  📍 {p.address.length > 120 ? p.address.slice(0, 120) + "…" : p.address}
                </p>
              )}
              {p.notes && (
                <p className="mt-1 text-[11px] italic" style={{ color: "var(--c-ink-faint)" }}>
                  {p.notes.slice(0, 120)}{p.notes.length > 120 ? "…" : ""}
                </p>
              )}

              {/* Action row */}
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-85"
                  style={{ backgroundColor: "#4285F4", color: "#fff" }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
                  </svg>
                  Google Maps
                </a>
                <a
                  href={`https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 min-w-[110px] flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-85"
                  style={{ backgroundColor: "#05c8f7", color: "#1a1a1a" }}
                >
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                    <path d="M20.54 6.63C19.35 4.43 17.28 2.8 14.82 2.2A9.01 9.01 0 0 0 3.46 9.93c-.22 1.8.12 3.57.93 5.13l-1.3 4.78 4.94-1.27c1.44.77 3.07 1.2 4.8 1.2 4.97 0 9-4.03 9-9 0-1.5-.37-2.92-1.29-4.14zm-8.7 13.87c-1.51 0-2.97-.4-4.24-1.12l-.3-.18-3.12.8.83-3.02-.2-.32A7.51 7.51 0 0 1 3.3 9.93a7.48 7.48 0 0 1 9.6-6.39 7.49 7.49 0 0 1 5.37 7.34c0 4.14-3.37 7.51-7.51 7.51z"/>
                  </svg>
                  Waze
                </a>
                <a
                  href={osmUrl(p)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}
                >
                  <ExternalLink size={11} />
                  OSM
                </a>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// MessageContent is now in components/chat/MessageContent.tsx

// ─── Model name formatter ─────────────────────────────────────────
function formatModelName(model?: string): string | null {
  if (!model) return null
  const m = model.toLowerCase()
  // Anthropic
  if (m.includes("opus"))   return "opus"
  if (m.includes("sonnet")) return "sonnet"
  if (m.includes("haiku"))  return "haiku"
  // Z.ai GLM
  if (m === "glm-4.7")       return "glm-4.7"
  if (m === "glm-4.6")       return "glm-4.6"
  if (m === "glm-4.5")       return "glm-4.5"
  if (m === "glm-4.5-air")   return "glm-4.5-air"
  if (m === "glm-4.5-flash") return "glm-4.5-flash"
  if (m.startsWith("glm"))   return m   // any other glm variant
  // RunPod Qwen
  if (m.includes("qwen") && m.includes("32")) return "qwen 32b"
  if (m.includes("qwen") && m.includes("8"))  return "qwen 8b"
  if (m.startsWith("tier")) return null   // don't surface raw tier names
  return null
}

// ─── Inline cards anchored to a saved assistant message ───────────
// Rendered as a sibling immediately after its MessageBubble. Uses local
// state for dismissals so each message's cards are independent.
function InlineMessageCards({
  toolResults,
  msgId,
  onAsk,
}: {
  toolResults: Array<{ type: string; [k: string]: unknown }>
  msgId: string
  onAsk: (q: string) => void
}) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const dismiss = (key: string) => setDismissed(prev => new Set([...prev, key]))

  const entries = toolResults
    .map((evt, i) => ({ evt, key: `${msgId}-tr-${i}` }))
    .filter(({ key }) => !dismissed.has(key))

  if (entries.length === 0) return null

  return (
    <div className="max-w-3xl mx-auto pl-0 sm:pl-11 flex flex-col gap-2">
      {entries.map(({ evt, key }) => {
        const e = evt as Record<string, unknown>
        if (evt.type === "place_card" && Array.isArray(e.places)) {
          return <PlaceCard key={key} set={{ tool_use_id: key, places: e.places as PlaceResult[] }} onDismiss={() => dismiss(key)} />
        }
        if (evt.type === "contact_card" && Array.isArray(e.contacts)) {
          return <ContactCard key={key} set={{ tool_use_id: key, contacts: e.contacts as ContactResult[] }} onDismiss={() => dismiss(key)} onAsk={onAsk} />
        }
        if (evt.type === "calendar_suggest") {
          return <CalendarSuggestChip key={key} suggestion={evt as unknown as CalendarSuggestion} onDismiss={() => dismiss(key)} />
        }
        if (evt.type === "task_suggest") {
          return <TaskSuggestChip key={key} suggestion={evt as unknown as TaskSuggestion} onDismiss={() => dismiss(key)} />
        }
        if (evt.type === "artifact_created") {
          return <ArtifactCard key={key} n={{ artifact_id: e.artifact_id as string, filename: e.filename as string, filetype: e.filetype as ArtifactNotification["filetype"] }} onDismiss={() => dismiss(key)} />
        }
        if (evt.type === "chart_image" && e.image_base64) {
          return <ChartImageCard key={key} title={typeof e.title === "string" ? e.title : "Chart"} imageBase64={e.image_base64 as string} onDismiss={() => dismiss(key)} onAsk={onAsk} />
        }
        return null
      })}
    </div>
  )
}

// ─── Single message bubble ────────────────────────────────────────
// memo: skips re-render when msg reference is stable (i.e. on inputValue keystrokes)
const MessageBubble = memo(function MessageBubble({ msg }: { msg: Message | StreamingMsg }) {
  const isUser = msg.role === "user"
  const toolCalls = !isUser && "tool_calls" in msg ? msg.tool_calls : undefined
  const modelLabel = !isUser && "model_used" in msg ? formatModelName(msg.model_used) : null
  const isStreaming = "streaming" in msg

  return (
    <div className={`group flex gap-3 min-w-0 max-w-3xl mx-auto ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className="w-8 h-8 rounded-full shrink-0 overflow-hidden"
        style={isUser
          ? { backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)", display: "flex", alignItems: "center", justifyContent: "center" }
          : { border: "2px solid var(--c-moss)" }
        }
      >
        {isUser
          ? <User size={15} style={{ color: "var(--c-ink-muted)" }} />
          : <img src="/tars-avatar.svg" alt="TARS" style={{ width: "100%", height: "100%", display: "block" }} />
        }
      </div>

      {/* Column: no items-start/end so children stretch to column width (needed for code scroll) */}
      <div className={`flex flex-col min-w-0 max-w-[80%] ${isUser ? "items-end" : ""}`}>
        {/* Always show "TARS" as the sender name for assistant messages */}
        {!isUser && (
          <span className="text-xs font-semibold mb-1 ml-1" style={{ color: "var(--c-moss)" }}>
            TARS
          </span>
        )}

        {toolCalls && toolCalls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {toolCalls.map((tool, idx) => (
              <span
                key={idx}
                className="badge badge-neutral text-[10px] flex items-center gap-1"
                style={{ backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border-faint)" }}
              >
                <Terminal size={10} style={{ color: "var(--c-moss)" }} /> {tool}
              </span>
            ))}
          </div>
        )}

        <div
          className={`p-4 rounded-2xl min-w-0 ${isUser ? "" : "w-full"}`}
          style={isUser
            ? { backgroundColor: "var(--c-canvas)", border: "1px solid var(--c-border)", color: "var(--c-ink)", overflowWrap: "break-word" }
            : { color: "var(--c-ink)", overflowWrap: "break-word" }
          }
        >
          <MessageContent content={msg.content} />
          {"streaming" in msg && (
            <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "rgba(45,90,79,0.55)", animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "rgba(45,90,79,0.55)", animationDelay: "160ms" }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "rgba(45,90,79,0.55)", animationDelay: "320ms" }} />
            </span>
          )}
        </div>

        {/* Subtle model badge below the bubble — only when known */}
        {modelLabel && (
          <span className="text-[10px] ml-1 mt-1" style={{ color: "var(--c-ink-faint)" }}>
            · {modelLabel}
          </span>
        )}

        {/* Action bar — Save to Second Brain / Create Task. Hidden until hover. */}
        {!isUser && !isStreaming && (
          <MessageActions content={msg.content} />
        )}
      </div>
    </div>
  )
})

// ─── Second Brain loader (needs Suspense for useSearchParams) ─────
function SecondBrainLoader({ onLoad }: { onLoad: (msg: string) => void }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    const loadId = searchParams.get("load")
    if (!loadId) return
    apiGet<{ source_title: string | null }>(`/second-brain/items/${loadId}`)
      .then((item) => {
        const title = item.source_title ?? "this item"
        onLoad(`Summarize and tell me the key points from: "${title}"`)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return null
}

// ─── Artifact loader — handles ?artifact=<id> from file upload ────
// Watches searchParams so it fires even when navigating to /chat?artifact=X
// while already on the chat page (no remount). A ref guards against double-fire.
// Only fetches the filename — content is injected server-side as invisible context.
function ArtifactLoader({ onArtifactLoad }: { onArtifactLoad: (artifactId: string, filename: string) => void }) {
  const searchParams = useSearchParams()
  const handledIdRef = useRef<string | null>(null)

  useEffect(() => {
    const artifactId = searchParams.get("artifact")
    if (!artifactId) return
    if (handledIdRef.current === artifactId) return  // already handled
    handledIdRef.current = artifactId

    apiGet<{ filename: string; type: string }>(`/artifacts/${artifactId}`)
      .then((artifact) => {
        const name = artifact.filename ?? "uploaded file"
        onArtifactLoad(artifactId, name)
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  return null
}

// ─── Conversation opener — handles ?open=<id> from cron/notifications ────
function ConversationOpener({ onOpen }: { onOpen: (id: string) => void }) {
  const searchParams = useSearchParams()
  const handledRef = useRef(false)
  useEffect(() => {
    const id = searchParams.get("open")
    if (!id || handledRef.current) return
    handledRef.current = true
    onOpen(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  return null
}

// ─── Ask loader — handles ?ask=<query> from command palette ──────
// Sets the input value and auto-sends on first load.
function AskLoader({ onAsk }: { onAsk: (q: string) => void }) {
  const searchParams = useSearchParams()
  const handledRef = useRef(false)
  useEffect(() => {
    const q = searchParams.get("ask")
    if (!q || handledRef.current) return
    handledRef.current = true
    onAsk(decodeURIComponent(q))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])
  return null
}

// ─── Agent stream bubble — ephemeral ticker, removed from thread when job ends
function AgentStreamBubble({
  msg,
  onComplete,
  onSubJobSpawned,
}: {
  msg: AgentStreamMessage
  onComplete: () => void
  onSubJobSpawned: (subJobId: string, agentType: string) => void
}) {
  // No avatar, no bubble — just the ticker. Reads as system chrome, not chat.
  return (
    <div className="flex justify-center my-1">
      <AgentStatusChip
        jobId={msg.job_id}
        agentType={msg.agent_type}
        onComplete={onComplete}
        onFail={onComplete}
        onSubJobSpawned={onSubJobSpawned}
      />
    </div>
  )
}

// ─── Message area ────────────────────────────────────────────────
// memo: allMessages is stable during typing (useMemo on [messages,streaming]),
// so this entire section is skipped on every keystroke → no O(n) reconcile cost.
interface MessageAreaProps {
  allMessages: (Message | StreamingMsg | AgentStreamMessage)[]
  calendarSuggestions: CalendarSuggestion[]
  taskSuggestions: TaskSuggestion[]
  artifactNotifications: ArtifactNotification[]
  contactResults: ContactResultSet[]
  placeResults: PlaceResultSet[]
  setCalendarSuggestions: React.Dispatch<React.SetStateAction<CalendarSuggestion[]>>
  setTaskSuggestions: React.Dispatch<React.SetStateAction<TaskSuggestion[]>>
  setArtifactNotifications: React.Dispatch<React.SetStateAction<ArtifactNotification[]>>
  setContactResults: React.Dispatch<React.SetStateAction<ContactResultSet[]>>
  setPlaceResults: React.Dispatch<React.SetStateAction<PlaceResultSet[]>>
  setAgentStreamMessages: React.Dispatch<React.SetStateAction<AgentStreamMessage[]>>
  onAsk: (q: string) => void
  quoteIndex: number
  messagesEndRef: React.RefObject<HTMLDivElement | null>
}

const MessageArea = memo(function MessageArea({
  allMessages,
  calendarSuggestions,
  taskSuggestions,
  artifactNotifications,
  contactResults,
  placeResults,
  setCalendarSuggestions,
  setTaskSuggestions,
  setArtifactNotifications,
  setContactResults,
  setPlaceResults,
  setAgentStreamMessages,
  onAsk,
  quoteIndex,
  messagesEndRef,
}: MessageAreaProps) {
  const hasCards = calendarSuggestions.length > 0 || taskSuggestions.length > 0
    || artifactNotifications.length > 0 || contactResults.length > 0 || placeResults.length > 0
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 pb-36 space-y-6">
      {allMessages.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center" style={{ color: "var(--c-ink-faint)" }}>
          <p className="text-2xl font-semibold" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>TARS</p>
          <p className="text-sm italic max-w-sm leading-relaxed" style={{ color: "var(--c-ink-muted)" }}>
            &ldquo;{TARS_QUOTES[quoteIndex]}&rdquo;
          </p>
        </div>
      ) : allMessages.map((msg, i) => (
        <React.Fragment key={"id" in msg ? msg.id : `stream-${i}`}>
          {msg.role === "agent_stream"
            ? <AgentStreamBubble
                msg={msg as AgentStreamMessage}
                onComplete={() => {
                  const id = (msg as AgentStreamMessage).job_id
                  setAgentStreamMessages(prev => prev.filter(m => m.job_id !== id))
                }}
                onSubJobSpawned={(subJobId, agentType) => {
                  setAgentStreamMessages(prev => {
                    // Dedupe — sub_job_started can replay from the ring buffer on reconnect
                    if (prev.some(m => m.job_id === subJobId)) return prev
                    return [...prev, {
                      id: subJobId,
                      role: "agent_stream" as const,
                      job_id: subJobId,
                      agent_type: agentType,
                      instruction: "",
                      created_at: new Date().toISOString(),
                    }]
                  })
                }}
              />
            : (
              <>
                <MessageBubble msg={msg as Message | StreamingMsg} />
                {/* Inline cards anchored to this saved assistant message */}
                {"tool_results" in msg &&
                  (msg as Message).tool_results != null &&
                  (msg as Message).tool_results!.length > 0 &&
                  msg.role === "assistant" &&
                  !("streaming" in msg) && (
                  <InlineMessageCards
                    toolResults={(msg as Message).tool_results!}
                    msgId={(msg as Message).id}
                    onAsk={onAsk}
                  />
                )}
              </>
            )
          }
        </React.Fragment>
      ))}
      {/* Global card section — live preview during streaming only */}
      {hasCards && (
        <div className="max-w-3xl mx-auto pl-0 sm:pl-11 flex flex-col gap-2">
          {calendarSuggestions.map((s) => (
            <CalendarSuggestChip
              key={s.tool_use_id}
              suggestion={s}
              onDismiss={() => setCalendarSuggestions(prev => prev.filter(x => x.tool_use_id !== s.tool_use_id))}
            />
          ))}
          {taskSuggestions.map((s) => (
            <TaskSuggestChip
              key={s.tool_use_id}
              suggestion={s}
              onDismiss={() => setTaskSuggestions(prev => prev.filter(x => x.tool_use_id !== s.tool_use_id))}
            />
          ))}
          {artifactNotifications.map((n) => (
            <ArtifactCard
              key={n.artifact_id}
              n={n}
              onDismiss={() => setArtifactNotifications(prev => prev.filter(x => x.artifact_id !== n.artifact_id))}
            />
          ))}
          {contactResults.map((set) => (
            <ContactCard
              key={set.tool_use_id}
              set={set}
              onDismiss={() => setContactResults(prev => prev.filter(x => x.tool_use_id !== set.tool_use_id))}
              onAsk={onAsk}
            />
          ))}
          {placeResults.map((set) => (
            <PlaceCard
              key={set.tool_use_id}
              set={set}
              onDismiss={() => setPlaceResults(prev => prev.filter(x => x.tool_use_id !== set.tool_use_id))}
            />
          ))}
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  )
})

// ─── Page ─────────────────────────────────────────────────────────
const TARS_QUOTES = [
  "I have a cue light I can use to show you when I'm joking, if you like.",
  "Absolute honesty isn't always the most diplomatic nor the safest form of communication with emotional beings.",
  "Cooper, this is no time for caution.",
  "Everybody good? 'Cause I just committed our return vehicle to save your life.",
  "That's not possible. No. It's necessary.",
  "What does Dr. Mann say?",
  "I'm not joking. Humor setting: 75%.",
  "I was configured for a variety of purposes.",
  "Do you want to find a way to save them or not?",
  "Ninety percent, Cooper. Ninety percent.",
]

export default function ChatPage() {
  const { setOpen: setSidebarOpen, open: sidebarOpen } = useSidebar()
  const { subscribe: subscribeNotif, clearUnread } = useNotificationContext()
  const [quoteIndex] = useState(() => Math.floor(Math.random() * TARS_QUOTES.length))
  const [conversations, setConversations]           = useState<Conversation[]>([])
  const [visibleConvCount, setVisibleConvCount]     = useState(20)
  const [activeChatId, setActiveChatId]             = useState<string | null>(null)
  const [messages, setMessages]                     = useState<Message[]>([])
  const [streaming, setStreaming]                   = useState<StreamingMsg | null>(null)
  const [busy, setBusy]                             = useState(false)
  const [calendarSuggestions, setCalendarSuggestions]     = useState<CalendarSuggestion[]>([])
  const [taskSuggestions, setTaskSuggestions]             = useState<TaskSuggestion[]>([])
  const [artifactNotifications, setArtifactNotifications] = useState<ArtifactNotification[]>([])
  const [agentStreamMessages, setAgentStreamMessages]     = useState<AgentStreamMessage[]>([])
  const [contactResults, setContactResults]               = useState<ContactResultSet[]>([])
  const [placeResults, setPlaceResults]                   = useState<PlaceResultSet[]>([])
  const [isConvListCollapsed, setConvListCollapsed] = useState(false)
  const [mobileConvOpen, setMobileConvOpen]         = useState(false)
  // Conversations with unread async messages (e.g. agent completions)
  const [unreadConvIds, setUnreadConvIds]           = useState<Set<string>>(new Set())
  const [inputValue, setInputValue]                 = useState("")
  const [attachments, setAttachments]               = useState<File[]>([])
  // Set to the transcript text by mobile voice-new-chat; cleared after auto-send fires
  const [pendingVoiceSend, setPendingVoiceSend]     = useState<string | null>(null)
  const voice = useVoiceInput()
  const confirm = useConfirm()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef                              = useRef<HTMLDivElement>(null)
  const fileInputRef                                = useRef<HTMLInputElement>(null)
  const cameraInputRef                              = useRef<HTMLInputElement>(null)
  const activeChatIdRef                             = useRef<string | null>(activeChatId)
  // NOTE: This AbortController is intentionally NOT connected to any
  // visibilitychange, blur, or beforeunload event. Chat completion requests
  // must complete regardless of window focus state. Only abort on:
  //   1. Explicit user "Stop" action
  //   2. Component unmount
  //   3. Conversation switch (activeChatId change)
  const abortControllerRef                          = useRef<AbortController | null>(null)
  const pollTimerRef                                = useRef<ReturnType<typeof setInterval> | null>(null)
  const accumulatedRef                              = useRef<string>("")  // live text during streaming
  const streamingCardsRef                           = useRef<Array<{ type: string; [k: string]: unknown }>>([])  // cards for finalMsg.tool_results
  const stopInitiatedRef                            = useRef<boolean>(false)  // true when user clicked Stop
  const streamPollingRef                            = useRef<boolean>(false)  // true while recovery-polling after stream interruption
  const autoSendPendingRef                          = useRef<boolean>(false)  // true when artifact load should auto-send
  const pendingArtifactIdRef                        = useRef<string | null>(null)  // artifact_id to inject on next send
  const userLocationRef                             = useRef<{ lat: number; lng: number } | null>(null)

  // ── Per-send geolocation helper ───────────────────────────────────
  // Called at message send time — high-accuracy fix, cached for 60 s so consecutive
  // sends feel instant. Races with a 2 s timeout so the send never blocks.
  // No background GPS drain; no UI indicator.
  function getLocationForSend(): Promise<{ lat: number; lng: number } | null> {
    if (!navigator.geolocation) return Promise.resolve(null)
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(userLocationRef.current), 2_000)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          clearTimeout(timer)
          const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude }
          userLocationRef.current = loc
          resolve(loc)
        },
        () => { clearTimeout(timer); resolve(userLocationRef.current) },
        { enableHighAccuracy: true, maximumAge: 60_000, timeout: 4_000 },
      )
    })
  }

  // Pre-fill input when navigating from Second Brain "Open in Chat" — handled via SecondBrainLoader below

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    setAttachments(prev => [...prev, ...picked])
    e.target.value = ""
  }

  // Cancel any in-flight fetch or poll on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [])

  // Keep ref in sync; cancel in-flight request + poll when switching conversations
  useEffect(() => {
    abortControllerRef.current?.abort()
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    activeChatIdRef.current = activeChatId
    setStreaming(null)
    setBusy(false)
    setCalendarSuggestions([])
    setTaskSuggestions([])
    setArtifactNotifications([])
    setAgentStreamMessages([])
    setContactResults([])
    setPlaceResults([])
    // Clear unread badge when switching to a conversation
    if (activeChatId) {
      setUnreadConvIds(prev => {
        if (!prev.has(activeChatId)) return prev
        const next = new Set(prev)
        next.delete(activeChatId)
        return next
      })
      clearUnread()
    }
  }, [activeChatId, clearUnread])

  // Real-time notifications from agent completions and other async TARS messages.
  // Subscribes via the shared context WebSocket (single connection for the whole app).
  useEffect(() => {
    const unsub = subscribeNotif((notif) => {
      if (notif.type !== "new_message") return
      const isActive = notif.conversation_id === activeChatIdRef.current
      if (isActive) {
        apiGet<{ messages: Message[] }>(`/chat/conversations/${notif.conversation_id}/messages`)
          .then(data => {
            setMessages(data.messages ?? [])
            setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50)
          })
          .catch(() => {})
      } else {
        setUnreadConvIds(prev => new Set([...prev, notif.conversation_id]))
        setConversations(prev => {
          const idx = prev.findIndex(c => c.id === notif.conversation_id)
          if (idx <= 0) return prev
          const updated = [...prev]
          const [conv] = updated.splice(idx, 1)
          return [conv, ...updated]
        })
      }
    })
    return unsub
  }, [subscribeNotif])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streaming?.content])


  // Load conversation list and auto-select the most recent one
  useEffect(() => {
    apiGet<Conversation[]>("/chat/conversations")
      .then((convs) => {
        setConversations(convs)
        if (convs.length > 0 && !activeChatIdRef.current) {
          setActiveChatId(convs[0].id)
        }
      })
      .catch(console.error)
  }, [])

  // Clear the live streaming card section. Saved messages now render their own
  // cards inline via InlineMessageCards (from msg.tool_results), so we no longer
  // need to repopulate global state — just wipe the streaming preview.
  const rehydrateCards = useCallback((_msgs: Message[]) => {
    setCalendarSuggestions([])
    setTaskSuggestions([])
    setArtifactNotifications([])
    setContactResults([])
    setPlaceResults([])
  }, [])

  // If the last message is from the user and recent, the server is still generating —
  // show a loading indicator and poll until the assistant response lands.
  useEffect(() => {
    if (!activeChatId) { setMessages([]); return }

    const chatId = activeChatId

    apiGet<{ id: string; title: string | null; messages: Message[] }>(`/chat/conversations/${chatId}`)
      .then((d) => {
        if (chatId !== activeChatIdRef.current) return
        setMessages(d.messages)
        rehydrateCards(d.messages)
        if (d.title) {
          setConversations((prev) => prev.map((c) =>
            c.id === chatId ? { ...c, title: d.title } : c
          ))
        }

        // If last message is from user and was sent in the last 10 minutes,
        // the server is still generating — show loading and poll.
        const msgs = d.messages
        const lastMsg = msgs[msgs.length - 1]
        const recentThreshold = 10 * 60 * 1000
        const isRecent = lastMsg && (Date.now() - new Date(lastMsg.created_at).getTime()) < recentThreshold
        if (lastMsg?.role === "user" && isRecent) {
          setBusy(true)
          setStreaming({ role: "assistant", content: "", streaming: true })

          let attempts = 0
          const MAX_ATTEMPTS = 60 // 2 minutes at 2s intervals
          pollTimerRef.current = setInterval(async () => {
            attempts++
            if (chatId !== activeChatIdRef.current || attempts > MAX_ATTEMPTS) {
              clearInterval(pollTimerRef.current!)
              if (chatId === activeChatIdRef.current) {
                setStreaming(null)
                setBusy(false)
              }
              return
            }
            try {
              const fresh = await apiGet<{ id: string; title: string | null; messages: Message[] }>(
                `/chat/conversations/${chatId}`
              )
              const freshLast = fresh.messages[fresh.messages.length - 1]
              if (freshLast?.role === "assistant") {
                clearInterval(pollTimerRef.current!)
                if (chatId === activeChatIdRef.current) {
                  setMessages(fresh.messages)
                  rehydrateCards(fresh.messages)
                  setStreaming(null)
                  setBusy(false)
                  if (fresh.title) {
                    setConversations((prev) => prev.map((c) =>
                      c.id === chatId ? { ...c, title: fresh.title } : c
                    ))
                  }
                }
              }
            } catch { /* keep polling */ }
          }, 2000)
        }
      })
      .catch(console.error)

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [activeChatId])

  const activeChat = conversations.find((c) => c.id === activeChatId)
  const isFocusMode = !sidebarOpen && isConvListCollapsed

  const toggleFocus = () => {
    if (isFocusMode) {
      setSidebarOpen(true)
      setConvListCollapsed(false)
    } else {
      setSidebarOpen(false)
      setConvListCollapsed(true)
    }
  }

  async function handleNewChat() {
    try {
      const conv = await apiPost<Conversation>("/chat/conversations")
      setConversations((prev) => [conv, ...prev])
      setActiveChatId(conv.id)
      setMessages([])
    } catch (err) {
      console.error(err)
    }
  }

  function handleStop() {
    stopInitiatedRef.current = true
    abortControllerRef.current?.abort()
    // Clear any recovery poll that may be running after a stream interruption
    if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    streamPollingRef.current = false
    // Immediately freeze the UI — don't wait for async catch/finally
    const partial = accumulatedRef.current
    if (partial) {
      setMessages(prev => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: partial,
          created_at: new Date().toISOString(),
        } as Message,
      ])
    }
    setStreaming(null)
    setBusy(false)
  }

  // ── Voice input handlers ──────────────────────────────────────────

  // In-chat mic: start recording, auto-sends in current chat on silence.
  // Click again to stop manually.
  const handleMicClick = useCallback(() => {
    if (voice.state === "recording") {
      voice.stop()
      return
    }
    if (voice.state !== "idle" && voice.state !== "error") return
    voice.start((text) => {
      if (!text) return
      setInputValue(text)
      setPendingVoiceSend(text)   // auto-send via the useEffect below
    })
  }, [voice])

  async function handleDeleteConversation(convId: string, e: React.MouseEvent) {
    e.stopPropagation()  // don't select the conversation when clicking delete
    const conv = conversations.find(c => c.id === convId)
    const ok = await confirm({
      title: "Delete conversation?",
      description: conv?.title
        ? `"${conv.title.slice(0, 80)}" will be permanently removed.`
        : "This conversation will be permanently removed.",
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!ok) return
    try {
      await apiDelete(`/chat/conversations/${convId}`)
      setConversations(prev => {
        const remaining = prev.filter(c => c.id !== convId)
        // If we deleted the active conversation, switch to the next one
        if (convId === activeChatIdRef.current) {
          const next = remaining[0] ?? null
          setActiveChatId(next?.id ?? null)
          if (!next) setMessages([])
        }
        return remaining
      })
    } catch (err) {
      console.error(err)
    }
  }

  const handleSend = useCallback(async () => {
    const content = inputValue.trim()
    if (busy || (!content && attachments.length === 0)) return

    // Show user message + loading state IMMEDIATELY — before async conversation creation
    stopInitiatedRef.current = false
    streamPollingRef.current = false
    const initialConvLength = messages.length  // snapshot before this send (used by recovery poll)
    setBusy(true)
    setInputValue("")
    setCalendarSuggestions([])
    setTaskSuggestions([])
    setArtifactNotifications([])
    setContactResults([])
    setPlaceResults([])
    streamingCardsRef.current = []
    const pendingAttachments = attachments
    setAttachments([])

    const tempUser: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUser])
    setStreaming({ role: "assistant", content: "", streaming: true })

    // Create conversation if needed (UI already shows loading state)
    let chatId = activeChatId
    if (!chatId) {
      try {
        const conv = await apiPost<Conversation>("/chat/conversations")
        setConversations((prev) => [conv, ...prev])
        setActiveChatId(conv.id)
        chatId = conv.id
      } catch (err) {
        console.error(err)
        // Rollback UI state on failure
        setBusy(false)
        setStreaming(null)
        setMessages((prev) => prev.filter((m) => m.id !== tempUser.id))
        return
      }
    }

    try {
      // Grab location at send time — high-accuracy, races with 2 s timeout
      const loc = await getLocationForSend()

      const fd = new FormData()
      fd.append("content", content)
      if (pendingArtifactIdRef.current) {
        fd.append("artifact_id", pendingArtifactIdRef.current)
        pendingArtifactIdRef.current = null
      }
      if (loc) {
        fd.append("location_lat", String(loc.lat))
        fd.append("location_lng", String(loc.lng))
      }
      for (const f of pendingAttachments) fd.append("files", f)

      const controller = new AbortController()
      abortControllerRef.current = controller

      const res = await fetch(`/api/proxy/chat/conversations/${chatId}/messages`, {
        method: "POST",
        body: fd,
        signal: controller.signal,
      })

      if (!res.ok || !res.body) throw new Error("Stream failed")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let accumulated = ""
      accumulatedRef.current = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6).trim()
          if (raw === "[DONE]") break
          try {
            const evt = JSON.parse(raw)
            if (stopInitiatedRef.current) break  // user clicked Stop — discard remaining events

            if (evt.type === "chunk") {
              accumulated += evt.text
              accumulatedRef.current = accumulated
              // Only update UI if still on this conversation
              if (chatId === activeChatIdRef.current) {
                setStreaming({ role: "assistant", content: accumulated, streaming: true })
              }
            } else if (evt.type === "calendar_suggest") {
              if (chatId === activeChatIdRef.current) {
                streamingCardsRef.current.push(evt as { type: string; [k: string]: unknown })
                setCalendarSuggestions(prev => [...prev, evt as CalendarSuggestion])
              }
            } else if (evt.type === "task_suggest") {
              if (chatId === activeChatIdRef.current) {
                streamingCardsRef.current.push(evt as { type: string; [k: string]: unknown })
                setTaskSuggestions(prev => [...prev, evt as TaskSuggestion])
              }
            } else if (evt.type === "artifact_created") {
              if (chatId === activeChatIdRef.current) {
                streamingCardsRef.current.push({ type: "artifact_created", artifact_id: evt.artifact_id, filename: evt.filename, filetype: evt.filetype })
                setArtifactNotifications(prev => [...prev, {
                  artifact_id: evt.artifact_id,
                  filename: evt.filename,
                  filetype: evt.filetype,
                } as ArtifactNotification])
              }
            } else if (evt.type === "contact_card") {
              if (chatId === activeChatIdRef.current && Array.isArray(evt.contacts) && evt.contacts.length > 0) {
                streamingCardsRef.current.push({ type: "contact_card", contacts: evt.contacts })
                setContactResults(prev => [...prev, {
                  tool_use_id: `contact-${Date.now()}-${Math.random()}`,
                  contacts: evt.contacts,
                } as ContactResultSet])
              }
            } else if (evt.type === "place_card") {
              if (chatId === activeChatIdRef.current && Array.isArray(evt.places) && evt.places.length > 0) {
                streamingCardsRef.current.push({ type: "place_card", places: evt.places })
                setPlaceResults(prev => [...prev, {
                  tool_use_id: `place-${Date.now()}-${Math.random()}`,
                  places: evt.places,
                } as PlaceResultSet])
              }
            } else if (evt.type === "chart_image") {
              if (chatId === activeChatIdRef.current) {
                streamingCardsRef.current.push({ type: "chart_image", title: evt.title, image_base64: evt.image_base64 })
              }
            } else if (evt.type === "agent_job_created") {
              if (chatId === activeChatIdRef.current) {
                setAgentStreamMessages(prev => [...prev, {
                  id: evt.job_id as string,
                  role: "agent_stream" as const,
                  job_id: evt.job_id as string,
                  agent_type: evt.agent_type as string,
                  instruction: evt.instruction as string,
                  created_at: new Date().toISOString(),
                }])
              }
            } else if (evt.type === "done") {
              const finalMsg: Message = {
                id: `done-${Date.now()}`,
                role: "assistant",
                content: accumulated,
                model_used: evt.model,
                created_at: new Date().toISOString(),
                ...(streamingCardsRef.current.length > 0 && { tool_results: [...streamingCardsRef.current] }),
              }
              if (chatId === activeChatIdRef.current) {
                setMessages((prev) => [...prev.filter((m) => m.id !== tempUser.id), tempUser, finalMsg])
                setStreaming(null)
              }
              // Refresh conversation list to pick up the title (generated async after done)
              apiGet<Conversation[]>("/chat/conversations").then(setConversations).catch(console.error)
            } else if (evt.type === "error") {
              console.error("TARS stream error:", evt.error)
              if (chatId === activeChatIdRef.current) {
                const errMsg: Message = {
                  id: `error-${Date.now()}`,
                  role: "assistant",
                  content: `⚠️ **Error:** ${evt.error || "Something went wrong. Please try again."}`,
                  created_at: new Date().toISOString(),
                }
                setMessages(prev => [...prev.filter(m => m.id !== tempUser.id), tempUser, errMsg])
                setStreaming(null)
              }
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
      // Safety net: if stream ended without a done event, clear any stuck loading state
      if (chatId === activeChatIdRef.current) setStreaming(null)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // handleStop already committed the partial response and cleared UI — just ensure cleanup
        if (!stopInitiatedRef.current && chatId === activeChatIdRef.current) {
          // abort fired without Stop button (e.g. conversation switch) — clear state silently
          setStreaming(null)
        }
        return
      }
      console.error(err)
      if (chatId === activeChatIdRef.current) {
        const errText = err instanceof Error ? err.message : "Connection failed. Please try again."
        const errMsg: Message = {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `⚠️ **Error:** ${errText}`,
          created_at: new Date().toISOString(),
        }
        setMessages(prev => [...prev, errMsg])
        setStreaming(null)
      }
    } finally {
      if (!stopInitiatedRef.current) setBusy(false)
      // If stop was initiated, handleStop already called setBusy(false)
    }
  }, [activeChatId, attachments, busy, inputValue])

  // Auto-send when pendingVoiceSend is ready and activeChatId is set
  useEffect(() => {
    if (!pendingVoiceSend || !activeChatId || busy) return
    setPendingVoiceSend(null)
    // handleSend reads inputValue from closure — ensure it's set first
    setTimeout(() => handleSend(), 0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVoiceSend, activeChatId])

  // Auto-send when an artifact has been loaded — fires after handleSend is defined
  useEffect(() => {
    if (!autoSendPendingRef.current) return
    if (!inputValue || busy) return
    autoSendPendingRef.current = false
    handleSend()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue, busy, handleSend])

  // Visibility recovery: when the user returns to this tab (mobile background →
  // foreground, alt-tab, etc.) reload messages for the active conversation so
  // any response that completed while we were away appears immediately.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && activeChatId && !busy) {
        apiGet<{ messages: Message[] }>(`/chat/conversations/${activeChatId}/messages`)
          .then(data => setMessages(data.messages ?? []))
          .catch(() => {/* silent — user is offline or session expired */})
      }
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChatId, busy])

  // Send a follow-up query in the current conversation (used by contact action chips)
  const handleAsk = useCallback((q: string) => {
    setInputValue(q)
    autoSendPendingRef.current = true
  }, [])

  const allMessages = useMemo(
    () => {
      const base: (Message | StreamingMsg | AgentStreamMessage)[] = [...messages, ...agentStreamMessages]
      if (streaming) base.push(streaming)
      return base
    },
    [messages, streaming, agentStreamMessages],
  )

  return (
    <>
    <div className="flex h-full overflow-hidden">
      <Suspense fallback={null}>
        <SecondBrainLoader onLoad={(msg) => setInputValue(msg)} />
        <ArtifactLoader onArtifactLoad={(artifactId, filename) => {
          // Clean slate — new conversation; file content injected server-side
          setActiveChatId(null)
          setMessages([])
          setInputValue(`📎 **${filename}** — [View in Artifacts](/artifacts)`)
          pendingArtifactIdRef.current = artifactId
          autoSendPendingRef.current = true
        }} />
        <AskLoader onAsk={(q) => {
          // Pre-fill from command palette "Ask TARS: …" and auto-send
          setActiveChatId(null)
          setMessages([])
          setInputValue(q)
          autoSendPendingRef.current = true
        }} />
        <ConversationOpener onOpen={(id) => setActiveChatId(id)} />
      </Suspense>

      {/* ── Mobile conversation drawer ────────────────────────── */}
      {mobileConvOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileConvOpen(false)}
          />
          <div
            className="relative flex flex-col h-full w-72 max-w-[80vw] shadow-xl z-10"
            style={{ backgroundColor: "var(--c-surface)" }}
          >
            <div
              className="px-3 py-3 border-b flex items-center gap-2 shrink-0"
              style={{ borderColor: "var(--c-border)" }}
            >
              <button
                onClick={async () => { await handleNewChat(); setMobileConvOpen(false) }}
                className="flex-1 flex items-center justify-center gap-2 btn-secondary text-sm"
                style={{ backgroundColor: "var(--c-canvas)" }}
              >
                <Plus size={15} /> New Chat
              </button>
              <button
                onClick={() => setMobileConvOpen(false)}
                className="p-1.5 rounded-md"
                style={{ color: "var(--c-ink-faint)" }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {conversations.length === 0 ? (
                <p className="px-3 py-4 text-xs" style={{ color: "var(--c-ink-faint)" }}>No conversations yet.</p>
              ) : conversations.slice(0, visibleConvCount).map((conv) => (
                <div key={conv.id} className="group relative flex items-center min-w-0 overflow-hidden w-full">
                  <button
                    onClick={() => { setActiveChatId(conv.id); setMobileConvOpen(false) }}
                    className={`flex-1 min-w-0 text-left px-3 py-2.5 rounded-md text-sm transition-colors pr-9 ${
                      activeChatId === conv.id ? "font-medium shadow-sm" : "text-ink-muted"
                    }`}
                    style={{
                      ...(activeChatId === conv.id
                        ? { backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }
                        : {}),
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {conv.title ?? "New conversation"}
                  </button>
                  {/* Always visible on mobile (no hover state on touch) */}
                  <button
                    onClick={(e) => { handleDeleteConversation(conv.id, e); setMobileConvOpen(false) }}
                    className="absolute right-1 p-1.5 rounded transition-colors"
                    style={{ color: "var(--c-ink-faint)" }}
                    title="Delete"
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-rose)"; (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-rose-soft)" }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {visibleConvCount < conversations.length && (
                <button
                  onClick={() => setVisibleConvCount(n => n + 20)}
                  className="w-full text-center px-3 py-3 text-xs rounded-md transition-colors min-h-[44px]"
                  style={{ color: "var(--c-ink-faint)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink)"; (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface)" }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
                >
                  Load more
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Conversation list (collapsible, desktop only) ─────── */}
      <div
        className={`border-r hidden lg:flex flex-col transition-all duration-300 ease-out overflow-hidden shrink-0 ${isConvListCollapsed ? "w-0 border-r-0" : "w-64"}`}
        style={{ backgroundColor: "var(--c-canvas)", borderColor: "var(--c-border)" }}
      >
        <div
          className="px-3 py-3 border-b flex items-center gap-2 shrink-0 min-w-[256px]"
          style={{ borderColor: "var(--c-border)" }}
        >
          <button
            onClick={handleNewChat}
            className="flex-1 flex items-center justify-center gap-2 btn-secondary text-sm"
            style={{ backgroundColor: "var(--c-surface)" }}
          >
            <Plus size={15} /> New Chat
          </button>
          <button
            onClick={() => setConvListCollapsed(true)}
            className="p-1.5 rounded-md transition-colors shrink-0"
            style={{ color: "var(--c-ink-faint)" }}
            title="Collapse conversations"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink)"; (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface-2)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-w-[256px]">
          {conversations.length === 0 ? (
            <p className="px-3 py-4 text-xs" style={{ color: "var(--c-ink-faint)" }}>No conversations yet.</p>
          ) : conversations.slice(0, visibleConvCount).map((conv) => (
            <div
              key={conv.id}
              className="group relative flex items-center min-w-0 overflow-hidden w-full"
            >
              <button
                onClick={() => setActiveChatId(conv.id)}
                className={`flex-1 min-w-0 text-left px-3 py-2 rounded-md text-sm transition-colors pr-8 ${
                  activeChatId === conv.id ? "font-medium shadow-sm" : "text-ink-muted hover:bg-surface-2"
                }`}
                style={{
                  ...(activeChatId === conv.id
                    ? { backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }
                    : {}),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {unreadConvIds.has(conv.id) && (
                    <span
                      className="shrink-0 rounded-full"
                      style={{ width: 7, height: 7, backgroundColor: "var(--c-moss)", boxShadow: "0 0 0 2px color-mix(in srgb, var(--c-moss) 25%, transparent)" }}
                      aria-label="New message"
                    />
                  )}
                  <span className="truncate">{conv.title ?? "New conversation"}</span>
                </span>
              </button>
              <button
                onClick={(e) => handleDeleteConversation(conv.id, e)}
                className="absolute right-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "var(--c-ink-faint)" }}
                title="Delete conversation"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-rose)"; (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-rose-soft)" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {visibleConvCount < conversations.length && (
            <button
              onClick={() => setVisibleConvCount(n => n + 20)}
              className="w-full text-center px-3 py-2 text-xs rounded-md transition-colors"
              style={{ color: "var(--c-ink-faint)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink)"; (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface)" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
            >
              Load more
            </button>
          )}
        </div>
      </div>

      {/* ── Chat area ─────────────────────────────────────────── */}
      {/* min-w-0 prevents code blocks / long messages from pushing this flex item wider than viewport */}
      <div className="flex-1 flex flex-col relative min-w-0 overflow-hidden" style={{ backgroundColor: "var(--c-surface)" }}>
        {/* Chat toolbar */}
        <div
          className="h-11 border-b px-3 flex items-center justify-between gap-2 z-20 shrink-0 overflow-hidden"
          style={{ borderColor: "var(--c-border)", backgroundColor: "color-mix(in srgb, var(--c-surface) 95%, transparent)", backdropFilter: "blur(4px)" }}
        >
          {/* min-w-0 + overflow-hidden both required for truncate to work in flex */}
          <div className="flex-1 flex items-center gap-1 min-w-0 overflow-hidden max-w-full">
            {/* Mobile: open conversation drawer */}
            <button
              onClick={() => setMobileConvOpen(true)}
              className="lg:hidden p-1.5 rounded-md shrink-0"
              style={{ color: "var(--c-ink-faint)" }}
            >
              <Menu size={18} />
            </button>
            {isConvListCollapsed && (
              <button
                onClick={() => setConvListCollapsed(false)}
                className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-xs font-medium shrink-0"
                style={{ color: "var(--c-ink-faint)" }}
                title="Show conversations"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink)"; (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface-2)" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
              >
                <PanelLeft size={15} />
                <span>Chats</span>
              </button>
            )}

            <h1
              className="text-sm font-medium truncate min-w-0 flex-1 block"
              style={{
                fontFamily: "var(--font-heading), serif",
                color: "var(--c-ink)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {activeChat?.title ?? (activeChatId ? "New conversation" : "TARS")}
            </h1>
          </div>

          <button
            onClick={toggleFocus}
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0"
            style={isFocusMode
              ? { backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }
              : { color: "var(--c-ink-faint)" }
            }
            title={isFocusMode ? "Exit focus mode" : "Enter focus mode"}
            onMouseEnter={e => { if (!isFocusMode) { (e.currentTarget as HTMLElement).style.color = "var(--c-ink)"; (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface-2)" } }}
            onMouseLeave={e => { if (!isFocusMode) { (e.currentTarget as HTMLElement).style.color = "var(--c-ink-faint)"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" } }}
          >
            {isFocusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isFocusMode ? "Exit focus" : "Focus"}
          </button>
        </div>

        {/* Messages — memoized so keystrokes don't trigger O(n) reconcile */}
        <MessageArea
          allMessages={allMessages}
          calendarSuggestions={calendarSuggestions}
          taskSuggestions={taskSuggestions}
          artifactNotifications={artifactNotifications}
          contactResults={contactResults}
          placeResults={placeResults}
          setCalendarSuggestions={setCalendarSuggestions}
          setTaskSuggestions={setTaskSuggestions}
          setArtifactNotifications={setArtifactNotifications}
          setContactResults={setContactResults}
          setPlaceResults={setPlaceResults}
          setAgentStreamMessages={setAgentStreamMessages}
          onAsk={handleAsk}
          quoteIndex={quoteIndex}
          messagesEndRef={messagesEndRef}
        />

        {/* ── Floating input ─────────────────────────────────────── */}
        {/* Positioned absolutely over the bottom of the message scroll area */}
        <div
          className="absolute bottom-0 left-0 right-0 px-3 pb-3 pt-0 z-10"
          style={{ background: "linear-gradient(to bottom, transparent 0%, var(--c-surface) 28px)" }}
        >
          <div className="max-w-3xl mx-auto">

            {/* Attachment chips */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 px-1">
                {attachments.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs"
                    style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border)", color: "var(--c-ink)" }}
                  >
                    {file.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={URL.createObjectURL(file)} alt={file.name} className="size-6 rounded object-cover shrink-0" />
                    ) : (
                      <Paperclip size={11} style={{ color: "var(--c-ink-muted)", flexShrink: 0 }} />
                    )}
                    <span className="max-w-[120px] truncate">{file.name}</span>
                    <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} style={{ color: "var(--c-ink-faint)" }}>
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Floating composer pill */}
            <div
              className="rounded-2xl transition-shadow"
              style={{
                backgroundColor: "var(--c-surface)",
                border: "1px solid var(--c-border)",
                boxShadow: "0 4px 16px rgba(26,23,20,0.08), 0 1px 3px rgba(26,23,20,0.06)",
              }}
            >
              {/* E2E-TEST-MARKER-9F4Z */}
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value)
                  // Auto-grow
                  const el = e.target
                  el.style.height = "auto"
                  el.style.height = Math.min(el.scrollHeight, 180) + "px"
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() }
                }}
                className="w-full bg-transparent border-none focus:ring-0 resize-none text-sm focus:outline-none px-4 pt-3 pb-1"
                style={{ minHeight: 44, maxHeight: 180, color: "var(--c-ink)", lineHeight: "1.5" }}
                placeholder="Ask anything or command an agent…"
                rows={1}
                disabled={busy}
              />

              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex gap-0.5" style={{ color: "var(--c-ink-faint)" }}>
                  <label
                    htmlFor="chat-attach-file"
                    title="Attach file"
                    className="p-1.5 rounded-lg transition-colors cursor-pointer"
                    style={busy ? { opacity: 0.4, pointerEvents: "none" } : {}}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <Paperclip size={16} />
                  </label>
                  <label
                    htmlFor="chat-attach-camera"
                    title="Take photo"
                    className="p-1.5 rounded-lg transition-colors cursor-pointer"
                    style={busy ? { opacity: 0.4, pointerEvents: "none" } : {}}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <Camera size={16} />
                  </label>
                  <button
                    title={voice.state === "recording" ? "Stop recording" : voice.state === "transcribing" ? "Transcribing…" : "Voice input"}
                    onClick={handleMicClick}
                    disabled={voice.state === "transcribing" || busy}
                    className="p-1.5 rounded-lg transition-colors relative"
                    style={{
                      color: voice.state === "recording" ? "var(--c-rose)" : "var(--c-ink-faint)",
                      opacity: voice.state === "transcribing" || busy ? 0.4 : 1,
                    }}
                    onMouseEnter={e => { if (voice.state !== "recording") (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface-2)" }}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
                  >
                    {voice.state === "transcribing"
                      ? <Loader2 size={16} className="animate-spin" />
                      : <Mic size={16} className={voice.state === "recording" ? "animate-pulse" : ""} />
                    }
                    {/* Pulsing ring when recording */}
                    {voice.state === "recording" && (
                      <span className="absolute inset-0 rounded-lg animate-ping"
                        style={{ backgroundColor: "var(--c-rose)", opacity: 0.2 }} />
                    )}
                  </button>
                </div>

                {busy ? (
                  <button
                    onClick={handleStop}
                    className="p-2 rounded-xl transition-opacity"
                    style={{ backgroundColor: "var(--c-ink)", color: "var(--c-canvas)" }}
                    title="Stop generating"
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                  >
                    <Square size={13} strokeWidth={0} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() && attachments.length === 0}
                    className="p-2 rounded-xl transition-opacity disabled:opacity-30"
                    style={{ backgroundColor: "var(--c-moss)", color: "var(--c-surface)" }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                  >
                    <Send size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Hidden file inputs */}
            <input ref={fileInputRef} id="chat-attach-file" type="file" multiple accept=".pdf,.docx,.txt,.md,image/*" className="hidden" onChange={handleFileChange} />
            <input ref={cameraInputRef} id="chat-attach-camera" type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFileChange} />

            <p className="text-center mt-2 text-[10px]" style={{ color: "var(--c-ink-faint)" }}>
              TARS can make mistakes. Verify important information.
            </p>
          </div>
        </div>
      </div>
    </div>

    </>
  )
}
