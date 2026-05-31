"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import {
  Calendar, Plus, X, AlertTriangle, Loader2, Paperclip,
  Brain, Trash2, GripVertical, ExternalLink, Archive,
} from "lucide-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { useRouter } from "next/navigation"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Task {
  id: string
  title: string
  description: string | null
  status: string
  priority: string
  due_at: string | null
  source: string | null
  source_id: string | null
  assigned_to: string | null
  connector_ref: string | null
  linked_artifacts: string[]
  linked_knowledge: string[]
  created_at: string
  updated_at: string
}

interface ArtifactMeta { id: string; filename: string; type: string }
interface KnowledgeMeta { id: string; source_title: string | null; type: string }

const COLUMNS = [
  { key: "inbox",       label: "Inbox",       color: "var(--c-ink-muted)" },
  { key: "todo",        label: "Todo",         color: "var(--c-moss)" },
  { key: "in-progress", label: "In Progress",  color: "var(--c-amber)" },
  { key: "done",        label: "Done",         color: "var(--c-moss)" },
  { key: "snoozed",     label: "Snoozed",      color: "var(--c-ink-faint)" },
] as const

type ColKey = typeof COLUMNS[number]["key"]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function priorityBorder(priority: string): React.CSSProperties {
  const p = priority.toLowerCase()
  if (p === "urgent") return { borderLeft: "3px solid var(--c-amber)" }
  if (p === "high")   return { borderLeft: "3px solid var(--c-rose)" }
  return { borderLeft: "3px solid transparent" }
}

function PriorityBadge({ priority }: { priority: string }) {
  const p = priority.toLowerCase()
  if (p === "urgent") return <span className="badge badge-amber" style={{ gap: "0.2rem", fontSize: "0.65rem" }}><AlertTriangle size={8} />Urgent</span>
  if (p === "high")   return <span className="badge badge-rose" style={{ fontSize: "0.65rem" }}>High</span>
  if (p === "low")    return <span className="badge badge-neutral" style={{ fontSize: "0.65rem" }}>Low</span>
  return null
}

function formatDate(iso: string | null) {
  if (!iso) return null
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.round((d.getTime() - now.getTime()) / 86400000)
  if (diff === 0)  return "Today"
  if (diff === -1) return "Yesterday"
  if (diff < 0)   return `${Math.abs(diff)}d ago`
  if (diff === 1)  return "Tomorrow"
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ─── TaskCard ─────────────────────────────────────────────────────────────────

function TaskCard({
  task,
  selected,
  onClick,
  onDragStart,
}: {
  task: Task
  selected: boolean
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
}) {
  const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== "done"
  const hasLinks = (task.linked_artifacts?.length ?? 0) + (task.linked_knowledge?.length ?? 0) > 0

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="card w-full text-left flex flex-col gap-2 hover:shadow-md transition-shadow cursor-pointer select-none group relative"
      style={{
        padding: "0.625rem 0.75rem 0.625rem 0.625rem",
        ...priorityBorder(task.priority),
        outline: selected ? "2px solid var(--c-moss)" : "none",
        outlineOffset: "1px",
        cursor: "grab",
      }}
    >
      {/* Drag handle — shown on hover */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-40 transition-opacity">
        <GripVertical size={13} style={{ color: "var(--c-ink-faint)" }} />
      </div>

      <div className="flex items-start justify-between gap-2 pr-4">
        <span className="text-sm font-medium leading-snug min-w-0" style={{ color: "var(--c-ink)" }}>{task.title}</span>
        <PriorityBadge priority={task.priority} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {task.source && (
            <span className="badge badge-neutral" style={{ fontSize: "0.6rem" }}>{task.source}</span>
          )}
          {hasLinks && (
            <span className="flex items-center gap-0.5" style={{ color: "var(--c-ink-faint)" }}>
              <Paperclip size={9} />
              <span style={{ fontSize: "0.6rem" }}>{(task.linked_artifacts?.length ?? 0) + (task.linked_knowledge?.length ?? 0)}</span>
            </span>
          )}
        </div>
        {task.due_at && (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: isOverdue ? "var(--c-rose)" : "var(--c-ink-faint)" }}>
            <Calendar size={10} />{formatDate(task.due_at)}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Task Detail Modal ─────────────────────────────────────────────────────────

function TaskModal({
  task,
  onClose,
  onUpdate,
  onDelete,
}: {
  task: Task
  onClose: () => void
  onUpdate: (updated: Task) => void
  onDelete: (id: string) => void
}) {
  const router = useRouter()
  const [editing, setEditing]       = useState(false)
  const [title, setTitle]           = useState(task.title)
  const [description, setDesc]      = useState(task.description ?? "")
  const [priority, setPriority]     = useState(task.priority)
  const [status, setStatus]         = useState(task.status)
  const [dueAt, setDueAt]           = useState(task.due_at ? task.due_at.slice(0, 10) : "")
  const [saving, setSaving]         = useState(false)
  const confirm                     = useConfirm()
  const [artMetas, setArtMetas]     = useState<ArtifactMeta[]>([])
  const [kbMetas, setKbMetas]       = useState<KnowledgeMeta[]>([])
  const [linkedArts, setLinkedArts] = useState<string[]>(task.linked_artifacts ?? [])
  const [linkedKb, setLinkedKb]     = useState<string[]>(task.linked_knowledge ?? [])
  const [showArtPicker, setArtPicker]   = useState(false)
  const [showKbPicker, setKbPicker]     = useState(false)
  const [allArtifacts, setAllArtifacts] = useState<ArtifactMeta[]>([])
  const [allKb, setAllKb]               = useState<KnowledgeMeta[]>([])

  // Fetch linked item metadata on mount
  useEffect(() => {
    if (linkedArts.length > 0) {
      Promise.all(linkedArts.map(id => apiGet<ArtifactMeta>(`/artifacts/${id}`))).then(setArtMetas).catch(() => {})
    }
    if (linkedKb.length > 0) {
      Promise.all(linkedKb.map(id => apiGet<KnowledgeMeta>(`/second-brain/items/${id}`))).then(setKbMetas).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true)
    try {
      const updated = await apiPatch<Task>(`/tasks/${task.id}`, {
        title,
        description: description || null,
        priority,
        status,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
        linked_artifacts: linkedArts,
        linked_knowledge: linkedKb,
      })
      onUpdate(updated)
      setEditing(false)
    } catch (err) { console.error(err) }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete task?",
      description: `"${task.title}" will be permanently removed.`,
      confirmLabel: "Delete",
      tone: "danger",
    })
    if (!ok) return
    await apiDelete(`/tasks/${task.id}`)
    onDelete(task.id)
  }

  async function handleMove(newStatus: ColKey) {
    const updated = await apiPatch<Task>(`/tasks/${task.id}`, { status: newStatus })
    setStatus(newStatus)
    onUpdate(updated)
  }

  async function loadAllArtifacts() {
    if (allArtifacts.length > 0) { setArtPicker(true); return }
    try {
      const data = await apiGet<ArtifactMeta[]>("/artifacts")
      setAllArtifacts(data)
    } catch { /* ignore */ }
    setArtPicker(true)
  }

  async function loadAllKb() {
    if (allKb.length > 0) { setKbPicker(true); return }
    try {
      const data = await apiGet<KnowledgeMeta[]>("/second-brain/items")
      setAllKb(data)
    } catch { /* ignore */ }
    setKbPicker(true)
  }

  function addArtifact(id: string) {
    if (!linkedArts.includes(id)) {
      const newList = [...linkedArts, id]
      setLinkedArts(newList)
      const meta = allArtifacts.find(a => a.id === id)
      if (meta) setArtMetas(p => [...p, meta])
    }
    setArtPicker(false)
  }

  function removeArtifact(id: string) {
    setLinkedArts(p => p.filter(x => x !== id))
    setArtMetas(p => p.filter(x => x.id !== id))
  }

  function addKb(id: string) {
    if (!linkedKb.includes(id)) {
      const newList = [...linkedKb, id]
      setLinkedKb(newList)
      const meta = allKb.find(k => k.id === id)
      if (meta) setKbMetas(p => [...p, meta])
    }
    setKbPicker(false)
  }

  function removeKb(id: string) {
    setLinkedKb(p => p.filter(x => x !== id))
    setKbMetas(p => p.filter(x => x.id !== id))
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ backgroundColor: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        className="fixed inset-x-4 bottom-4 top-16 z-50 rounded-2xl flex flex-col overflow-hidden
                   sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2
                   sm:w-full sm:max-w-xl sm:max-h-[85vh]"
        style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", boxShadow: "0 24px 64px rgba(0,0,0,0.3)" }}
      >
        {/* Modal header */}
        <div className="px-5 py-4 border-b flex items-start gap-3 shrink-0" style={{ borderColor: "var(--c-border)" }}>
          <div className="flex-1 min-w-0">
            {editing ? (
              <input
                autoFocus
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="input-field w-full text-sm font-semibold"
              />
            ) : (
              <h2
                className="text-base font-semibold leading-snug cursor-text"
                style={{ color: "var(--c-ink)" }}
                onClick={() => setEditing(true)}
                title="Click to edit"
              >
                {title}
              </h2>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors shrink-0"
            style={{ color: "var(--c-ink-muted)" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">

          {/* Meta fields grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Status */}
            <div>
              <label className="block text-[0.6rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>Status</label>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="input-field w-full text-xs"
                style={{ padding: "0.3rem 0.5rem" }}
              >
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="block text-[0.6rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>Priority</label>
              <select
                value={priority}
                onChange={e => setPriority(e.target.value)}
                className="input-field w-full text-xs"
                style={{ padding: "0.3rem 0.5rem" }}
              >
                {["urgent", "high", "normal", "low"].map(p => <option key={p} value={p} className="capitalize">{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>

            {/* Due date */}
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-[0.6rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>Due Date</label>
              <input
                type="date"
                value={dueAt}
                onChange={e => setDueAt(e.target.value)}
                className="input-field w-full text-xs"
                style={{ padding: "0.3rem 0.5rem" }}
              />
            </div>

            {/* Source */}
            {task.source && (
              <div>
                <label className="block text-[0.6rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>Source</label>
                <span className="text-xs capitalize" style={{ color: "var(--c-ink)" }}>{task.source}</span>
              </div>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="block text-[0.6rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>Description</label>
            <textarea
              value={description}
              onChange={e => { setDesc(e.target.value); setEditing(true) }}
              rows={3}
              placeholder="Add a description…"
              className="input-field w-full text-xs resize-none"
              style={{ lineHeight: "1.5" }}
            />
          </div>

          {/* Move to column chips */}
          <div>
            <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>Move to</div>
            <div className="flex flex-wrap gap-1.5">
              {COLUMNS.filter(c => c.key !== status).map(col => (
                <button
                  key={col.key}
                  onClick={() => handleMove(col.key)}
                  className="text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors"
                  style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-muted)" }}
                  onMouseEnter={e => { e.currentTarget.style.backgroundColor = "var(--c-moss)"; e.currentTarget.style.color = "var(--c-surface)" }}
                  onMouseLeave={e => { e.currentTarget.style.backgroundColor = "var(--c-surface-2)"; e.currentTarget.style.color = "var(--c-ink-muted)" }}
                >
                  {col.label}
                </button>
              ))}
            </div>
          </div>

          {/* Linked Artifacts */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
                Linked Artifacts
              </div>
              <button
                onClick={loadAllArtifacts}
                className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors"
                style={{ color: "var(--c-moss)" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-moss-soft)")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <Plus size={9} /> Attach
              </button>
            </div>
            {artMetas.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>No artifacts linked yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {artMetas.map(a => (
                  <div key={a.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border-faint)" }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Archive size={12} style={{ color: "var(--c-ink-faint)", flexShrink: 0 }} />
                      <span className="text-xs truncate" style={{ color: "var(--c-ink)" }}>{a.filename}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => router.push("/artifacts")} style={{ color: "var(--c-ink-faint)" }}><ExternalLink size={11} /></button>
                      <button onClick={() => removeArtifact(a.id)} style={{ color: "var(--c-ink-faint)" }}><X size={11} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Artifact picker dropdown */}
            {showArtPicker && (
              <div className="mt-2 rounded-xl border overflow-hidden" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)", boxShadow: "0 4px 20px rgba(0,0,0,0.15)", maxHeight: "200px", overflowY: "auto" }}>
                {allArtifacts.filter(a => !linkedArts.includes(a.id)).length === 0 ? (
                  <div className="px-3 py-3 text-xs" style={{ color: "var(--c-ink-faint)" }}>No artifacts available</div>
                ) : (
                  allArtifacts.filter(a => !linkedArts.includes(a.id)).map(a => (
                    <button key={a.id} onClick={() => addArtifact(a.id)}
                      className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors"
                      style={{ color: "var(--c-ink)" }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <Archive size={11} style={{ flexShrink: 0, color: "var(--c-ink-faint)" }} />
                      <span className="truncate">{a.filename}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Linked Second Brain */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
                Linked Second Brain
              </div>
              <button
                onClick={loadAllKb}
                className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors"
                style={{ color: "var(--c-moss)" }}
                onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-moss-soft)")}
                onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <Plus size={9} /> Attach
              </button>
            </div>
            {kbMetas.length === 0 ? (
              <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>No knowledge items linked yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {kbMetas.map(k => (
                  <div key={k.id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ backgroundColor: "var(--c-surface-2)", border: "1px solid var(--c-border-faint)" }}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Brain size={12} style={{ color: "var(--c-ink-faint)", flexShrink: 0 }} />
                      <span className="text-xs truncate" style={{ color: "var(--c-ink)" }}>{k.source_title ?? "Knowledge item"}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => router.push("/second-brain")} style={{ color: "var(--c-ink-faint)" }}><ExternalLink size={11} /></button>
                      <button onClick={() => removeKb(k.id)} style={{ color: "var(--c-ink-faint)" }}><X size={11} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showKbPicker && (
              <div className="mt-2 rounded-xl border overflow-hidden" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)", boxShadow: "0 4px 20px rgba(0,0,0,0.15)", maxHeight: "200px", overflowY: "auto" }}>
                {allKb.filter(k => !linkedKb.includes(k.id)).length === 0 ? (
                  <div className="px-3 py-3 text-xs" style={{ color: "var(--c-ink-faint)" }}>No knowledge items available</div>
                ) : (
                  allKb.filter(k => !linkedKb.includes(k.id)).map(k => (
                    <button key={k.id} onClick={() => addKb(k.id)}
                      className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-colors"
                      style={{ color: "var(--c-ink)" }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <Brain size={11} style={{ flexShrink: 0, color: "var(--c-ink-faint)" }} />
                      <span className="truncate">{k.source_title ?? "Untitled"}</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="pt-2 border-t" style={{ borderColor: "var(--c-border-faint)" }}>
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors"
              style={{ color: "var(--c-ink-faint)" }}
              onMouseEnter={e => { e.currentTarget.style.color = "var(--c-rose)"; e.currentTarget.style.backgroundColor = "var(--c-rose-soft)" }}
              onMouseLeave={e => { e.currentTarget.style.color = "var(--c-ink-faint)"; e.currentTarget.style.backgroundColor = "transparent" }}
            >
              <Trash2 size={12} /> Delete task
            </button>
          </div>
        </div>

        {/* Footer save */}
        {(editing || priority !== task.priority || status !== task.status || dueAt !== (task.due_at ? task.due_at.slice(0, 10) : "") || JSON.stringify(linkedArts) !== JSON.stringify(task.linked_artifacts ?? []) || JSON.stringify(linkedKb) !== JSON.stringify(task.linked_knowledge ?? [])) && (
          <div className="px-5 py-3 border-t flex justify-end gap-2 shrink-0" style={{ borderColor: "var(--c-border)" }}>
            <button
              onClick={() => { setEditing(false); setTitle(task.title); setDesc(task.description ?? ""); setPriority(task.priority); setStatus(task.status); setDueAt(task.due_at ? task.due_at.slice(0, 10) : ""); setLinkedArts(task.linked_artifacts ?? []); setLinkedKb(task.linked_knowledge ?? []) }}
              className="btn-ghost text-sm"
              style={{ padding: "0.35rem 0.75rem" }}
            >
              Discard
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="btn-primary text-sm disabled:opacity-50"
              style={{ padding: "0.35rem 0.875rem" }}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : null}
              Save
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ─── Column drop zone ─────────────────────────────────────────────────────────

function KanbanColumn({
  col,
  tasks,
  selected,
  onSelect,
  onDragStart,
  onDrop,
  onAdd,
}: {
  col: typeof COLUMNS[number]
  tasks: Task[]
  selected: string | null
  onSelect: (task: Task) => void
  onDragStart: (e: React.DragEvent, task: Task) => void
  onDrop: (colKey: ColKey) => void
  onAdd: (colKey: ColKey, title: string) => void
}) {
  const [over, setOver] = useState(false)
  const [addingTitle, setAddingTitle] = useState("")
  const [addingMode, setAddingMode] = useState(false)

  function commitAdd() {
    const t = addingTitle.trim()
    if (t) onAdd(col.key, t)
    setAddingMode(false)
    setAddingTitle("")
  }

  return (
    <div
      className="flex flex-col rounded-xl w-[232px] shrink-0 transition-colors"
      style={{
        backgroundColor: over ? "color-mix(in srgb, var(--c-moss-soft) 60%, var(--c-canvas))" : "color-mix(in srgb, var(--c-surface-2) 60%, var(--c-canvas))",
        border: over ? "1px solid var(--c-moss)" : "1px solid var(--c-border-faint)",
      }}
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDrop(col.key) }}
    >
      {/* Column header */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <span className="text-[0.7rem] font-semibold uppercase tracking-wider" style={{ color: col.color }}>{col.label}</span>
        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ backgroundColor: "var(--c-border)", color: "var(--c-ink-muted)" }}>{tasks.length}</span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
        {tasks.length === 0 && !addingMode && (
          <div className="rounded-lg border-2 border-dashed flex items-center justify-center h-16 text-xs" style={{ borderColor: "var(--c-border)", color: "var(--c-ink-faint)" }}>
            Drop here
          </div>
        )}
        {tasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            selected={selected === task.id}
            onClick={() => onSelect(task)}
            onDragStart={e => onDragStart(e, task)}
          />
        ))}

        {addingMode ? (
          <div className="flex flex-col gap-1.5">
            <input
              autoFocus
              value={addingTitle}
              onChange={e => setAddingTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") commitAdd()
                if (e.key === "Escape") { setAddingMode(false); setAddingTitle("") }
              }}
              placeholder="Task title…"
              className="input-field text-xs px-2 py-1.5 w-full"
            />
            <div className="flex gap-1">
              <button onClick={commitAdd} className="btn-primary text-[11px] flex-1 justify-center py-1">Add</button>
              <button onClick={() => { setAddingMode(false); setAddingTitle("") }} className="btn-ghost text-[11px] px-2 py-1">Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingMode(true)}
            className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-colors"
            style={{ color: "var(--c-ink-faint)" }}
            onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-border-faint)")}
            onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <Plus size={12} /> Add task
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks, setTasks]         = useState<Task[]>([])
  const [selected, setSelected]   = useState<Task | null>(null)
  const [loading, setLoading]     = useState(true)
  const dragTaskRef               = useRef<Task | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Task[]>("/tasks")
      setTasks(data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleAdd(colKey: ColKey, title: string) {
    const t = title.trim()
    if (!t) return
    try {
      const task = await apiPost<Task>("/tasks", { title: t, status: colKey })
      setTasks(prev => [task, ...prev])
    } catch (err) { console.error(err) }
  }

  function handleDragStart(e: React.DragEvent, task: Task) {
    dragTaskRef.current = task
    e.dataTransfer.effectAllowed = "move"
  }

  async function handleDrop(colKey: ColKey) {
    const task = dragTaskRef.current
    if (!task || task.status === colKey) return
    dragTaskRef.current = null
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: colKey } : t))
    if (selected?.id === task.id) setSelected(prev => prev ? { ...prev, status: colKey } : prev)
    try {
      await apiPatch(`/tasks/${task.id}`, { status: colKey })
    } catch { load() }
  }

  function handleUpdate(updated: Task) {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    setSelected(updated)
  }

  function handleDelete(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id))
    setSelected(null)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden" style={{ backgroundColor: "var(--c-canvas)" }}>
      {/* Header */}
      <div className="px-6 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
        <h1 className="text-lg font-semibold" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>Tasks</h1>
        <button
          onClick={() => handleAdd("inbox", "New task")}
          className="btn-primary"
          style={{ padding: "0.35rem 0.75rem", fontSize: "0.8125rem" }}
        >
          <Plus size={14} /> Task
        </button>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
          </div>
        ) : (
          <div className="flex gap-3 h-full p-4 min-w-max">
            {COLUMNS.map(col => (
              <KanbanColumn
                key={col.key}
                col={col}
                tasks={tasks.filter(t => t.status === col.key)}
                selected={selected?.id ?? null}
                onSelect={setSelected}
                onDragStart={handleDragStart}
                onDrop={handleDrop}
                onAdd={handleAdd}
              />
            ))}
          </div>
        )}
      </div>

      {/* Task detail modal */}
      {selected && (
        <TaskModal
          task={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
