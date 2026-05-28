"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Video, Clock, Users, FileText, CheckSquare, Search,
  Sparkles, Calendar, RefreshCw, Loader2,
} from "lucide-react"
import { apiGet, apiPost } from "@/lib/api-client"

interface ActionItem {
  id: string
  raw_text: string
  owner: string | null
  task_id: string | null
}

interface Meeting {
  id: string
  title: string
  status: string
  attendees: string[]
  summary: string | null
  transcript: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  action_items?: ActionItem[]
}

type Tab = "summary" | "transcript" | "actions"

const STATUS_BADGE: Record<string, string> = {
  ready:            "badge-moss",
  action_required:  "badge-amber",
  processing:       "badge-neutral",
}

const STATUS_LABEL: Record<string, string> = {
  ready:           "Ready",
  action_required: "Action Required",
  processing:      "Processing",
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map(p => p[0]).join("").toUpperCase()
}

function relativeDay(iso: string) {
  const d = new Date(iso)
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7)  return `${diff} days ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function duration(m: Meeting): string | null {
  if (!m.started_at || !m.ended_at) return null
  const mins = Math.round((new Date(m.ended_at).getTime() - new Date(m.started_at).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

export default function MeetingsPage() {
  const [meetings, setMeetings]   = useState<Meeting[]>([])
  const [selected, setSelected]   = useState<Meeting | null>(null)
  const [tab, setTab]             = useState<Tab>("summary")
  const [search, setSearch]       = useState("")
  const [statusFilter, setFilter] = useState("All")
  const [loading, setLoading]     = useState(true)
  const [syncing, setSyncing]     = useState(false)
  const [creatingTask, setCreatingTask] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Meeting[]>("/meetings")
      setMeetings(data)
      if (data.length > 0 && !selected) setSelected(data[0])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [selected])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDetail(id: string) {
    try {
      const detail = await apiGet<Meeting>(`/meetings/${id}`)
      setSelected(detail)
      setMeetings(prev => prev.map(m => m.id === id ? { ...m, ...detail } : m))
    } catch (err) {
      console.error(err)
    }
  }

  async function sync() {
    setSyncing(true)
    try {
      await apiPost("/meetings/sync")
      await load()
    } catch (err) {
      console.error(err)
    } finally {
      setSyncing(false)
    }
  }

  async function createTaskFromItem(item: ActionItem) {
    if (!selected || item.task_id) return
    setCreatingTask(item.id)
    try {
      await apiPost(`/meetings/${selected.id}/action-items/${item.id}/create-task`, {})
      await loadDetail(selected.id)
    } catch (err) {
      console.error(err)
    } finally {
      setCreatingTask(null)
    }
  }

  const filtered = useMemo(() => meetings.filter(m => {
    if (statusFilter !== "All" && STATUS_LABEL[m.status] !== statusFilter) return false
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  }), [meetings, search, statusFilter])

  const isProcessing = selected?.status === "processing"

  return (
    <div className="flex h-full" style={{ backgroundColor: "#f6f3ec" }}>
      {/* ── List ───────────────────────────────────────────────── */}
      <div className="w-80 border-r flex-col hidden md:flex" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
        <div className="p-4 border-b space-y-3" style={{ borderColor: "#d8d2c4" }}>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-medium" style={{ fontFamily: "var(--font-heading), serif" }}>Meetings</h1>
            <button
              onClick={sync}
              disabled={syncing}
              title="Sync from Fireflies"
              className="p-1.5 rounded-md transition-colors disabled:opacity-50"
              style={{ color: "#6b6357" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "#948a7b" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search meetings…" className="input-field w-full pl-8 py-1.5 text-xs" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {["All", "Action Required", "Ready", "Processing"].map(s => (
              <button key={s} onClick={() => setFilter(s)} className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors" style={{ backgroundColor: statusFilter === s ? "#1a1714" : "#efeadf", color: statusFilter === s ? "#fbfaf6" : "#6b6357" }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={18} className="animate-spin" style={{ color: "#948a7b" }} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-center py-12" style={{ color: "#948a7b" }}>
              {meetings.length === 0 ? "No meetings yet. Sync from Fireflies to get started." : "No matches."}
            </p>
          ) : filtered.map(m => (
            <button key={m.id} onClick={() => { setTab("summary"); loadDetail(m.id) }} className="w-full text-left p-3 rounded-lg transition-colors border" style={{ backgroundColor: selected?.id === m.id ? "#f6f3ec" : "transparent", borderColor: selected?.id === m.id ? "#d8d2c4" : "transparent", boxShadow: selected?.id === m.id ? "0 1px 2px rgba(26,23,20,0.05)" : "none" }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h3 className="font-medium text-sm leading-snug" style={{ color: "#1a1714" }}>{m.title}</h3>
                <span className={`shrink-0 badge text-[9px] ${STATUS_BADGE[m.status] ?? "badge-neutral"}`}>{STATUS_LABEL[m.status] ?? m.status}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]" style={{ color: "#6b6357" }}>
                <span className="flex items-center gap-1"><Calendar size={10} />{relativeDay(m.created_at)}</span>
                {duration(m) && <span className="flex items-center gap-1"><Clock size={10} />{duration(m)}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Detail ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: "#948a7b" }}>
            <p className="text-sm">{loading ? "Loading…" : "Select a meeting"}</p>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 border-b" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs mb-2 flex-wrap" style={{ color: "#6b6357" }}>
                    <span className="badge badge-neutral flex items-center gap-1"><Video size={10} />Fireflies</span>
                    {duration(selected) && <span className="flex items-center gap-1"><Clock size={12} />{duration(selected)}</span>}
                    <span>·</span>
                    <span>{new Date(selected.created_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                  <h2 className="text-2xl font-medium leading-tight" style={{ fontFamily: "var(--font-heading), serif", color: "#1a1714" }}>{selected.title}</h2>
                  {selected.attendees.length > 0 && (
                    <div className="flex items-center gap-3 mt-3">
                      <div className="flex -space-x-2">
                        {selected.attendees.slice(0, 4).map(a => (
                          <div key={a} title={a} className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-medium" style={{ backgroundColor: "#efeadf", borderColor: "#fbfaf6", color: "#6b6357" }}>{initials(a)}</div>
                        ))}
                      </div>
                      <span className="text-xs" style={{ color: "#6b6357" }}>{selected.attendees.join(", ")}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-1 mt-5 -mb-5 border-b" style={{ borderColor: "#e8e2d4" }}>
                {([
                  { id: "summary" as Tab,    label: "Summary",    icon: Sparkles },
                  { id: "transcript" as Tab, label: "Transcript", icon: FileText },
                  { id: "actions" as Tab,    label: `Actions${selected.action_items?.length ? ` (${selected.action_items.length})` : ""}`, icon: CheckSquare },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setTab(id)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors" style={{ borderBottomColor: tab === id ? "#2d5a4f" : "transparent", color: tab === id ? "#2d5a4f" : "#6b6357" }}>
                    <Icon size={14} />{label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {isProcessing ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 animate-pulse" style={{ backgroundColor: "#efeadf" }}>
                    <Sparkles size={20} style={{ color: "#6b6357" }} />
                  </div>
                  <h3 className="text-lg font-medium mb-1" style={{ fontFamily: "var(--font-heading), serif" }}>Processing transcript</h3>
                  <p className="text-sm max-w-xs" style={{ color: "#6b6357" }}>TARS is summarizing this meeting. Refresh in a moment.</p>
                </div>
              ) : tab === "summary" ? (
                <div className="max-w-3xl mx-auto px-8 py-8 space-y-8">
                  {selected.summary ? (
                    <section>
                      <h3 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: "#6b6357" }}>
                        <Sparkles size={14} style={{ color: "#2d5a4f" }} />Summary
                      </h3>
                      <p className="text-lg leading-relaxed" style={{ fontFamily: "var(--font-heading), serif", color: "#1a1714" }}>{selected.summary}</p>
                    </section>
                  ) : (
                    <p className="text-sm italic" style={{ color: "#6b6357" }}>No summary yet.</p>
                  )}
                  {(selected.action_items?.length ?? 0) > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-medium uppercase tracking-wider flex items-center gap-2" style={{ color: "#6b6357" }}>
                          <CheckSquare size={14} style={{ color: "#2d5a4f" }} />Action items
                        </h3>
                        <button onClick={() => setTab("actions")} className="text-xs font-medium hover:underline" style={{ color: "#2d5a4f" }}>View all →</button>
                      </div>
                      <div className="space-y-2">
                        {selected.action_items!.slice(0, 3).map(a => (
                          <ActionItemRow key={a.id} item={a} onCreateTask={createTaskFromItem} creating={creatingTask === a.id} />
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : tab === "transcript" ? (
                <div className="max-w-3xl mx-auto px-8 py-8">
                  {selected.transcript ? (
                    <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans" style={{ color: "#1a1714" }}>{selected.transcript}</pre>
                  ) : (
                    <p className="text-sm italic text-center py-12" style={{ color: "#6b6357" }}>No transcript available.</p>
                  )}
                </div>
              ) : (
                <div className="max-w-3xl mx-auto px-8 py-8 space-y-3">
                  {(selected.action_items?.length ?? 0) > 0 ? (
                    selected.action_items!.map(a => (
                      <ActionItemRow key={a.id} item={a} onCreateTask={createTaskFromItem} creating={creatingTask === a.id} />
                    ))
                  ) : (
                    <p className="text-sm italic text-center py-12" style={{ color: "#6b6357" }}>No action items extracted from this meeting.</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ActionItemRow({ item, onCreateTask, creating }: { item: ActionItem; onCreateTask: (i: ActionItem) => void; creating: boolean }) {
  return (
    <div className="card flex items-start gap-3 group" style={{ backgroundColor: "#f6f3ec", borderColor: "#e8e2d4" }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug" style={{ color: "#1a1714" }}>{item.raw_text}</p>
        {item.owner && (
          <div className="flex items-center gap-1 text-xs mt-1" style={{ color: "#6b6357" }}>
            <Users size={11} />{item.owner}
          </div>
        )}
      </div>
      {item.task_id ? (
        <span className="text-[10px] font-medium shrink-0 badge badge-moss">Task created</span>
      ) : (
        <button
          onClick={() => onCreateTask(item)}
          disabled={creating}
          className="text-xs font-medium shrink-0 disabled:opacity-50 transition-colors"
          style={{ color: "#2d5a4f" }}
          onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
          onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : "Create Task"}
        </button>
      )}
    </div>
  )
}
