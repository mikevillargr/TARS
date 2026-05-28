"use client"

import { useEffect, useState, useCallback } from "react"
import { Calendar, Plus, X, AlertTriangle, Loader2 } from "lucide-react"
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client"

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
  created_at: string
  updated_at: string
}

const COLUMNS = [
  { key: "inbox",       label: "Inbox" },
  { key: "todo",        label: "Todo" },
  { key: "in-progress", label: "In Progress" },
  { key: "done",        label: "Done" },
  { key: "snoozed",     label: "Snoozed" },
] as const

type ColKey = typeof COLUMNS[number]["key"]

function priorityAccent(priority: string): React.CSSProperties {
  const p = priority.toLowerCase()
  if (p === "urgent") return { borderLeft: "3px solid #b8651a" }
  if (p === "high")   return { borderLeft: "3px solid #a04848" }
  return { borderLeft: "3px solid transparent" }
}

function PriorityBadge({ priority }: { priority: string }) {
  const p = priority.toLowerCase()
  if (p === "urgent") return <span className="badge badge-amber" style={{ gap: "0.2rem" }}><AlertTriangle size={9} />Urgent</span>
  if (p === "high")   return <span className="badge badge-rose">High</span>
  if (p === "low")    return <span className="badge badge-neutral">Low</span>
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

function TaskCard({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) {
  const isOverdue = task.due_at && new Date(task.due_at) < new Date() && task.status !== "done"
  return (
    <button
      onClick={onClick}
      className="card w-full text-left flex flex-col gap-2 hover:shadow-md transition-shadow cursor-pointer"
      style={{ padding: "0.625rem 0.75rem 0.625rem 0.625rem", ...priorityAccent(task.priority), outline: selected ? "2px solid #2d5a4f" : "none", outlineOffset: "1px" }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-[#1a1714] leading-snug">{task.title}</span>
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="flex items-center justify-between gap-2">
        {task.source && <span className="badge badge-neutral" style={{ fontSize: "0.65rem" }}>{task.source}</span>}
        {task.due_at && (
          <span className="flex items-center gap-1 text-[11px]" style={{ color: isOverdue ? "#a04848" : "#948a7b" }}>
            <Calendar size={11} />{formatDate(task.due_at)}
          </span>
        )}
      </div>
    </button>
  )
}

export default function TasksPage() {
  const [tasks, setTasks]       = useState<Task[]>([])
  const [selected, setSelected] = useState<Task | null>(null)
  const [loading, setLoading]   = useState(true)
  const [adding, setAdding]     = useState<ColKey | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [saving, setSaving]     = useState(false)

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

  async function moveTask(task: Task, status: ColKey) {
    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t))
    if (selected?.id === task.id) setSelected(prev => prev ? { ...prev, status } : prev)
    try {
      await apiPatch(`/tasks/${task.id}`, { status })
    } catch {
      load()
    }
  }

  async function quickAdd(colKey: ColKey) {
    const title = newTitle.trim()
    if (!title) { setAdding(null); return }
    setSaving(true)
    try {
      const task = await apiPost<Task>("/tasks", { title, status: colKey })
      setTasks(prev => [task, ...prev])
      setNewTitle("")
      setAdding(null)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  async function deleteTask(task: Task) {
    setSelected(null)
    setTasks(prev => prev.filter(t => t.id !== task.id))
    try {
      await apiDelete(`/tasks/${task.id}`)
    } catch { load() }
  }

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: "#f6f3ec" }}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-6 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
          <h1 className="text-lg font-semibold text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>Tasks</h1>
          <button
            onClick={() => { setAdding("inbox"); setNewTitle("") }}
            className="btn-primary"
            style={{ padding: "0.35rem 0.75rem", fontSize: "0.8125rem" }}
          >
            <Plus size={14} /> Task
          </button>
        </div>

        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 size={20} className="animate-spin" style={{ color: "#948a7b" }} />
            </div>
          ) : (
            <div className="flex gap-3 h-full p-4 min-w-max">
              {COLUMNS.map(col => {
                const colTasks = tasks.filter(t => t.status === col.key)
                return (
                  <div key={col.key} className="flex flex-col rounded-xl w-[232px] shrink-0" style={{ backgroundColor: "rgba(239,234,223,0.6)", border: "1px solid #e8e2d4" }}>
                    <div className="px-3 pt-3 pb-2 flex items-center justify-between">
                      <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-[#6b6357]">{col.label}</span>
                      <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold" style={{ backgroundColor: "#d8d2c4", color: "#6b6357" }}>{colTasks.length}</span>
                    </div>

                    <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
                      {colTasks.length === 0 && adding !== col.key && (
                        <div className="rounded-lg border-2 border-dashed flex items-center justify-center h-16 text-xs" style={{ borderColor: "#d8d2c4", color: "#948a7b" }}>
                          No tasks
                        </div>
                      )}
                      {colTasks.map(task => (
                        <TaskCard key={task.id} task={task} selected={selected?.id === task.id} onClick={() => setSelected(p => p?.id === task.id ? null : task)} />
                      ))}

                      {adding === col.key ? (
                        <div className="flex flex-col gap-1.5">
                          <input
                            autoFocus
                            value={newTitle}
                            onChange={e => setNewTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter") quickAdd(col.key); if (e.key === "Escape") { setAdding(null); setNewTitle("") } }}
                            placeholder="Task title…"
                            className="input-field text-xs px-2 py-1.5 w-full"
                          />
                          <div className="flex gap-1">
                            <button onClick={() => quickAdd(col.key)} disabled={saving || !newTitle.trim()} className="btn-primary text-[11px] flex-1 justify-center py-1 disabled:opacity-50">Add</button>
                            <button onClick={() => { setAdding(null); setNewTitle("") }} className="btn-ghost text-[11px] px-2 py-1">Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setAdding(col.key); setNewTitle("") }}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-colors"
                          style={{ color: "#948a7b" }}
                          onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#e8e2d4")}
                          onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                        >
                          <Plus size={12} /> Add task
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <>
          {/* Mobile backdrop — tapping it closes the sheet */}
          <div
            className="lg:hidden fixed inset-0 z-40"
            style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
            onClick={() => setSelected(null)}
          />

          {/* Detail panel:
              Mobile  → fixed bottom sheet with rounded top corners
              Desktop → regular side panel */}
          <div
            className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] rounded-t-2xl overflow-y-auto flex flex-col lg:relative lg:inset-auto lg:z-auto lg:max-h-none lg:w-[300px] lg:border-l lg:rounded-none lg:shrink-0"
            style={{
              borderColor: "#d8d2c4",
              backgroundColor: "#fbfaf6",
              paddingBottom: "env(safe-area-inset-bottom, 0px)",
            }}
          >
            {/* Drag handle — visible on mobile only */}
            <div className="lg:hidden flex justify-center pt-3 pb-1 shrink-0">
              <div className="w-10 h-1 rounded-full" style={{ backgroundColor: "#d8d2c4" }} />
            </div>

            <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: "#d8d2c4" }}>
              <span className="text-sm font-semibold text-[#1a1714]">Task Detail</span>
              <button onClick={() => setSelected(null)} className="p-1 rounded-md transition-colors" style={{ color: "#6b6357" }} onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")} onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}>
                <X size={15} />
              </button>
            </div>

            <div className="p-4 flex flex-col gap-4">
              <h2 className="text-sm font-semibold text-[#1a1714] leading-snug">{selected.title}</h2>

              {selected.description && (
                <p className="text-xs leading-relaxed" style={{ color: "#6b6357" }}>{selected.description}</p>
              )}

              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Status",   value: selected.status.replace("-", " ") },
                  { label: "Priority", value: selected.priority },
                  { label: "Assignee", value: selected.assigned_to ?? "—" },
                  { label: "Source",   value: selected.source ?? "manual" },
                  { label: "Due",      value: selected.due_at ? (formatDate(selected.due_at) ?? "—") : "—" },
                ].map(item => (
                  <div key={item.label}>
                    <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-0.5">{item.label}</div>
                    <div className="text-xs text-[#1a1714] capitalize">{item.value}</div>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-1.5">Move to</div>
                <div className="flex flex-wrap gap-1">
                  {COLUMNS.filter(c => c.key !== selected.status).map(col => (
                    <button
                      key={col.key}
                      onClick={() => moveTask(selected, col.key)}
                      className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors"
                      style={{ backgroundColor: "#efeadf", color: "#6b6357" }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = "#1a1714"; e.currentTarget.style.color = "#fbfaf6" }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = "#efeadf"; e.currentTarget.style.color = "#6b6357" }}
                    >
                      {col.label}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => deleteTask(selected)}
                className="text-xs font-medium transition-colors self-start"
                style={{ color: "#a04848" }}
                onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
              >
                Delete task
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
