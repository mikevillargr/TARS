"use client"

import { useState } from "react"
import { Calendar, Filter, Plus, SlidersHorizontal, X, AlertTriangle } from "lucide-react"
import { MOCK_TASKS } from "@/lib/mock-ui-data"

type Task = typeof MOCK_TASKS[number]

const COLUMNS = [
  { key: "inbox",       label: "Inbox" },
  { key: "todo",        label: "Todo" },
  { key: "in-progress", label: "In Progress" },
  { key: "done",        label: "Done" },
  { key: "snoozed",     label: "Snoozed" },
] as const

function priorityAccent(priority: string): React.CSSProperties {
  if (priority === "Urgent") return { borderLeft: "3px solid #b8651a" }
  if (priority === "High")   return { borderLeft: "3px solid #a04848" }
  return { borderLeft: "3px solid transparent" }
}

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "Urgent") {
    return (
      <span className="badge badge-amber" style={{ gap: "0.2rem" }}>
        <AlertTriangle size={9} />
        Urgent
      </span>
    )
  }
  if (priority === "High")   return <span className="badge badge-rose">High</span>
  if (priority === "Low")    return <span className="badge badge-neutral">Low</span>
  return null
}

function formatDate(d: string | null) {
  if (!d) return null
  const date = new Date(d)
  const today = new Date("2026-05-27")
  const diff = Math.round((date.getTime() - today.getTime()) / 86400000)
  if (diff === 0)  return "Today"
  if (diff === -1) return "Yesterday"
  if (diff < 0)   return `${Math.abs(diff)}d ago`
  if (diff === 1)  return "Tomorrow"
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function TaskCard({ task, selected, onClick }: { task: Task; selected: boolean; onClick: () => void }) {
  const isOverdue =
    task.dueDate && new Date(task.dueDate) < new Date("2026-05-27") && task.status !== "done"

  return (
    <button
      onClick={onClick}
      className="card w-full text-left flex flex-col gap-2 hover:shadow-md transition-shadow cursor-pointer"
      style={{
        padding: "0.625rem 0.75rem 0.625rem 0.625rem",
        ...priorityAccent(task.priority),
        outline: selected ? "2px solid #2d5a4f" : "none",
        outlineOffset: "1px",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-[#1a1714] leading-snug">{task.title}</span>
        <PriorityBadge priority={task.priority} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="badge badge-neutral" style={{ fontSize: "0.65rem" }}>{task.source}</span>
        {task.dueDate && (
          <span
            className="flex items-center gap-1 text-[11px]"
            style={{ color: isOverdue ? "#a04848" : "#948a7b" }}
          >
            <Calendar size={11} />
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>
      {task.connector && (
        <span className="badge badge-moss" style={{ fontSize: "0.65rem", alignSelf: "flex-start" }}>
          ↗ {task.connector}
        </span>
      )}
    </button>
  )
}

export default function TasksPage() {
  const [tasks]    = useState<Task[]>(MOCK_TASKS)
  const [selected, setSelected] = useState<Task | null>(null)

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: "#f6f3ec" }}>
      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-3 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <h1 className="text-lg font-semibold text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>
            Tasks
          </h1>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8125rem" }}>
              <Filter size={13} /> Filter
            </button>
            <button className="btn-ghost" style={{ padding: "0.3rem 0.6rem", fontSize: "0.8125rem" }}>
              <SlidersHorizontal size={13} /> Sort
            </button>
            <button className="btn-primary" style={{ padding: "0.35rem 0.75rem", fontSize: "0.8125rem" }}>
              <Plus size={14} /> Task
            </button>
          </div>
        </div>

        {/* Kanban board */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex gap-3 h-full p-4 min-w-max">
            {COLUMNS.map(col => {
              const colTasks = tasks.filter(t => t.status === col.key)
              return (
                <div
                  key={col.key}
                  className="flex flex-col rounded-xl w-[232px] shrink-0"
                  style={{ backgroundColor: "rgba(239,234,223,0.6)", border: "1px solid #e8e2d4" }}
                >
                  {/* Column header */}
                  <div className="px-3 pt-3 pb-2 flex items-center justify-between">
                    <span className="text-[0.7rem] font-semibold uppercase tracking-wider text-[#6b6357]">
                      {col.label}
                    </span>
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-semibold"
                      style={{ backgroundColor: "#d8d2c4", color: "#6b6357" }}
                    >
                      {colTasks.length}
                    </span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
                    {colTasks.length === 0 && (
                      <div
                        className="rounded-lg border-2 border-dashed flex items-center justify-center h-16 text-xs"
                        style={{ borderColor: "#d8d2c4", color: "#948a7b" }}
                      >
                        No tasks
                      </div>
                    )}
                    {colTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        selected={selected?.id === task.id}
                        onClick={() => setSelected(prev => prev?.id === task.id ? null : task)}
                      />
                    ))}

                    <button
                      className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-colors"
                      style={{ color: "#948a7b" }}
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#e8e2d4")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <Plus size={12} />
                      Add task
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      {selected && (
        <div
          className="w-[300px] border-l flex flex-col shrink-0 overflow-y-auto"
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "#d8d2c4" }}
          >
            <span className="text-sm font-semibold text-[#1a1714]">Task Detail</span>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md transition-colors"
              style={{ color: "#6b6357" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="p-4 flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-[#1a1714] leading-snug">{selected.title}</h2>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Status",   value: selected.status.replace("-", " ") },
                { label: "Assignee", value: selected.assignee },
                { label: "Source",   value: selected.source },
                { label: "Due",      value: selected.dueDate ? formatDate(selected.dueDate) ?? "—" : "—" },
              ].map(item => (
                <div key={item.label}>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-0.5">
                    {item.label}
                  </div>
                  <div className="text-xs text-[#1a1714] capitalize">{item.value}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-1">
                Priority
              </div>
              <PriorityBadge priority={selected.priority} />
              {selected.priority === "Normal" && (
                <span className="badge badge-neutral">Normal</span>
              )}
            </div>

            {selected.connector && (
              <div>
                <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-1">
                  Synced to
                </div>
                <span className="badge badge-moss">{selected.connector}</span>
              </div>
            )}

            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-2">
                Activity
              </div>
              <div
                className="rounded-lg p-3 text-xs"
                style={{ backgroundColor: "#efeadf", color: "#6b6357" }}
              >
                Task created from {selected.source.toLowerCase()}.
              </div>
            </div>

            <div className="flex gap-2">
              <button className="btn-primary text-xs flex-1 justify-center" style={{ padding: "0.4rem 0.5rem" }}>
                Mark Done
              </button>
              <button className="btn-secondary text-xs flex-1 justify-center" style={{ padding: "0.4rem 0.5rem" }}>
                Edit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
