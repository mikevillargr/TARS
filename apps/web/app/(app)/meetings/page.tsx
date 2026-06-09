"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Video, Clock, Users, FileText, CheckSquare, Search,
  Sparkles, Calendar, RefreshCw, Loader2, BriefcaseBusiness,
  MessageSquare, Brain,
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

// ── Enriched attendee chip ───────────────────────────────────────────────────
interface AttendeeContact {
  display_name: string | null
  organization: string | null
  job_title: string | null
  primary_email: string | null
}

function AttendeeChip({ attendee }: { attendee: string }) {
  const [contact, setContact] = useState<AttendeeContact | null>(null)
  const [showTooltip, setShowTooltip] = useState(false)
  const fetchedRef = useRef(false)

  function handleMouseEnter() {
    setShowTooltip(true)
    if (fetchedRef.current) return
    fetchedRef.current = true
    // Derive the email: attendees are stored as emails or "Name <email>"
    const emailMatch = attendee.match(/<([^>]+)>/) || attendee.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
    const email = emailMatch ? emailMatch[1] ?? emailMatch[0] : attendee
    apiGet<AttendeeContact[]>(`/contacts/search?q=${encodeURIComponent(email)}&limit=1`)
      .then(results => { if (results.length > 0) setContact(results[0]) })
      .catch(() => {})
  }

  const ini = initials(attendee)
  const label = contact?.display_name ?? attendee

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={() => setShowTooltip(false)}>
      <div
        className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-medium cursor-default"
        style={{ backgroundColor: "var(--c-surface-2)", borderColor: "var(--c-surface)", color: "var(--c-ink-muted)" }}
        title={label}
      >
        {ini}
      </div>
      {showTooltip && contact && (contact.job_title || contact.organization) && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 rounded-lg px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap pointer-events-none"
          style={{ backgroundColor: "var(--c-ink)", color: "var(--c-canvas)" }}
        >
          <div className="font-medium">{contact.display_name ?? attendee}</div>
          {(contact.job_title || contact.organization) && (
            <div className="flex items-center gap-1 mt-0.5 opacity-75">
              <BriefcaseBusiness size={9} />
              {[contact.job_title, contact.organization].filter(Boolean).join(" · ")}
            </div>
          )}
          {/* Triangle pointer */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0"
            style={{ borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid var(--c-ink)" }} />
        </div>
      )}
    </div>
  )
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
  const router = useRouter()
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
      if (data.length > 0 && !selected) {
        try {
          const detail = await apiGet<Meeting>(`/meetings/${data[0].id}`)
          setSelected(detail)
          setMeetings(prev => prev.map(m => m.id === data[0].id ? { ...m, ...detail } : m))
        } catch {
          setSelected(data[0])
        }
      }
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
    <div className="flex h-full bg-canvas">
      {/* ── List ───────────────────────────────────────────────── */}
      <div className="w-80 border-r flex-col hidden md:flex" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
        <div className="p-4 border-b space-y-3" style={{ borderColor: "var(--c-border)" }}>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-medium" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>Meetings</h1>
            <button
              onClick={sync}
              disabled={syncing}
              title="Sync from Fireflies"
              className="p-1.5 rounded-md transition-colors disabled:opacity-50"
              style={{ color: "var(--c-ink-muted)" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <RefreshCw size={15} className={syncing ? "animate-spin" : ""} />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--c-ink-faint)" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search meetings…" className="input-field w-full pl-8 py-1.5 text-xs" />
          </div>
          <div className="flex gap-1 flex-wrap">
            {["All", "Action Required", "Ready", "Processing"].map(s => (
              <button key={s} onClick={() => setFilter(s)} className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors"
                style={{
                  backgroundColor: statusFilter === s ? "var(--c-ink)" : "var(--c-surface-2)",
                  color: statusFilter === s ? "var(--c-surface)" : "var(--c-ink-muted)",
                }}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={18} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-center py-12" style={{ color: "var(--c-ink-faint)" }}>
              {meetings.length === 0 ? "No meetings yet. Sync from Fireflies to get started." : "No matches."}
            </p>
          ) : filtered.map(m => (
            <button key={m.id} onClick={() => { setTab("summary"); loadDetail(m.id) }}
              className="w-full text-left p-3 rounded-lg transition-colors border"
              style={{
                backgroundColor: selected?.id === m.id ? "var(--c-canvas)" : "transparent",
                borderColor: selected?.id === m.id ? "var(--c-border)" : "transparent",
                boxShadow: selected?.id === m.id ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
              }}>
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h3 className="font-medium text-sm leading-snug" style={{ color: "var(--c-ink)" }}>{m.title}</h3>
                <span className={`shrink-0 badge text-[9px] ${STATUS_BADGE[m.status] ?? "badge-neutral"}`}>{STATUS_LABEL[m.status] ?? m.status}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]" style={{ color: "var(--c-ink-muted)" }}>
                <span className="flex items-center gap-1"><Calendar size={10} />{relativeDay(m.created_at)}</span>
                {duration(m) && <span className="flex items-center gap-1"><Clock size={10} />{duration(m)}</span>}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Detail ─────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile meeting selector — hidden on md+ where the sidebar takes over */}
        {meetings.length > 0 && (
          <div className="block md:hidden overflow-x-auto border-b shrink-0" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
            <div className="flex gap-2 p-3 min-w-max">
              {meetings.map(m => (
                <button
                  key={m.id}
                  onClick={() => { setTab("summary"); loadDetail(m.id) }}
                  className="shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors truncate max-w-[160px]"
                  style={{
                    backgroundColor: selected?.id === m.id ? "var(--c-ink)" : "var(--c-surface-2)",
                    color: selected?.id === m.id ? "var(--c-canvas)" : "var(--c-ink-muted)",
                  }}
                >
                  {m.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {!selected ? (
          <div className="flex-1 flex items-center justify-center" style={{ color: "var(--c-ink-faint)" }}>
            <p className="text-sm">{loading ? "Loading…" : "Select a meeting"}</p>
          </div>
        ) : (
          <>
            <div className="px-6 py-5 border-b" style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs mb-2 flex-wrap" style={{ color: "var(--c-ink-muted)" }}>
                    <span className="badge badge-neutral flex items-center gap-1"><Video size={10} />Fireflies</span>
                    {duration(selected) && <span className="flex items-center gap-1"><Clock size={12} />{duration(selected)}</span>}
                    <span>·</span>
                    <span>{new Date(selected.created_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                  </div>
                  <h2 className="text-2xl font-medium leading-tight" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>{selected.title}</h2>
                  {selected.attendees.length > 0 && (
                    <div className="flex items-center gap-2 mt-3 flex-nowrap" style={{ maxHeight: "48px" }}>
                      <div className="flex -space-x-2 flex-nowrap">
                        {selected.attendees.slice(0, 5).map(a => (
                          <AttendeeChip key={a} attendee={a} />
                        ))}
                      </div>
                      {selected.attendees.length > 5 && (
                        <span className="text-xs font-medium whitespace-nowrap" style={{ color: "var(--c-ink-muted)" }}>
                          +{selected.attendees.length - 5} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-1 mt-5 -mb-5 border-b" style={{ borderColor: "var(--c-border-faint)" }}>
                {([
                  { id: "summary" as Tab,    label: "Summary",    icon: Sparkles },
                  { id: "transcript" as Tab, label: "Transcript", icon: FileText },
                  { id: "actions" as Tab,    label: `Actions${selected.action_items?.length ? ` (${selected.action_items.length})` : ""}`, icon: CheckSquare },
                ] as const).map(({ id, label, icon: Icon }) => (
                  <button key={id} onClick={() => setTab(id)}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap"
                    style={{
                      borderBottomColor: tab === id ? "var(--c-moss)" : "transparent",
                      color: tab === id ? "var(--c-moss)" : "var(--c-ink-muted)",
                    }}>
                    <Icon size={14} />{label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto" data-selectable>
              {isProcessing ? (
                <div className="h-full flex flex-col items-center justify-center text-center px-6">
                  <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 animate-pulse" style={{ backgroundColor: "var(--c-surface-2)" }}>
                    <Sparkles size={20} style={{ color: "var(--c-ink-muted)" }} />
                  </div>
                  <h3 className="text-lg font-medium mb-1" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>Processing transcript</h3>
                  <p className="text-sm max-w-xs" style={{ color: "var(--c-ink-muted)" }}>TARS is summarizing this meeting. Refresh in a moment.</p>
                </div>
              ) : tab === "summary" ? (
                <div className="max-w-3xl mx-auto px-8 py-8 space-y-8">
                  {selected.summary ? (
                    <section>
                      <h3 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: "var(--c-ink-muted)" }}>
                        <Sparkles size={14} style={{ color: "var(--c-moss)" }} />Summary
                      </h3>
                      <p className="text-lg leading-relaxed" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>{selected.summary}</p>
                    </section>
                  ) : (
                    <p className="text-sm italic" style={{ color: "var(--c-ink-muted)" }}>No summary yet.</p>
                  )}
                  {(selected.action_items?.length ?? 0) > 0 && (
                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-xs font-medium uppercase tracking-wider flex items-center gap-2" style={{ color: "var(--c-ink-muted)" }}>
                          <CheckSquare size={14} style={{ color: "var(--c-moss)" }} />Action items
                        </h3>
                        <button onClick={() => setTab("actions")} className="text-xs font-medium hover:underline" style={{ color: "var(--c-moss)" }}>View all →</button>
                      </div>
                      <div className="space-y-2">
                        {selected.action_items!.slice(0, 3).map(a => (
                          <ActionItemRow key={a.id} item={a} onCreateTask={createTaskFromItem} creating={creatingTask === a.id} meetingTitle={selected.title} router={router} />
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              ) : tab === "transcript" ? (
                <div className="max-w-3xl mx-auto px-8 py-8">
                  {selected.transcript ? (
                    <pre className="text-sm leading-relaxed whitespace-pre-wrap font-sans" style={{ color: "var(--c-ink)" }}>{selected.transcript}</pre>
                  ) : (
                    <p className="text-sm italic text-center py-12" style={{ color: "var(--c-ink-muted)" }}>No transcript available.</p>
                  )}
                </div>
              ) : (
                <div className="max-w-3xl mx-auto px-8 py-8 space-y-3">
                  {(selected.action_items?.length ?? 0) > 0 ? (
                    selected.action_items!.map(a => (
                      <ActionItemRow key={a.id} item={a} onCreateTask={createTaskFromItem} creating={creatingTask === a.id} meetingTitle={selected.title} router={router} />
                    ))
                  ) : (
                    <p className="text-sm italic text-center py-12" style={{ color: "var(--c-ink-muted)" }}>No action items extracted from this meeting.</p>
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

function ActionItemRow({
  item, onCreateTask, creating, meetingTitle, router,
}: {
  item: ActionItem
  onCreateTask: (i: ActionItem) => void
  creating: boolean
  meetingTitle: string
  router: ReturnType<typeof useRouter>
}) {
  function openInChat() {
    const prompt = `Unpack this action item from the meeting "${meetingTitle}": ${item.raw_text}`
    router.push(`/chat?ask=${encodeURIComponent(prompt)}`)
  }

  function openInSecondBrain() {
    router.push(`/second-brain?capture=note&title=${encodeURIComponent(item.raw_text)}`)
  }

  return (
    <div className="card flex items-start gap-3 group">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug" style={{ color: "var(--c-ink)" }}>{item.raw_text}</p>
        {item.owner && (
          <div className="flex items-center gap-1 text-xs mt-1" style={{ color: "var(--c-ink-muted)" }}>
            <Users size={11} />{item.owner}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {item.task_id ? (
          <span className="text-[10px] font-medium badge badge-moss">Task created</span>
        ) : (
          <>
            <button
              onClick={openInChat}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: "var(--c-ink-muted)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--c-ink)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--c-ink-muted)")}
            >
              <MessageSquare size={11} />Chat
            </button>
            <button
              onClick={openInSecondBrain}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: "var(--c-ink-muted)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--c-ink)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--c-ink-muted)")}
            >
              <Brain size={11} />Second Brain
            </button>
            <button
              onClick={() => onCreateTask(item)}
              disabled={creating}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
              style={{ color: "var(--c-moss)" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--c-moss-dark, var(--c-moss))")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--c-moss)")}
            >
              {creating ? <Loader2 size={11} className="animate-spin" /> : <CheckSquare size={11} />}
              {creating ? "Creating…" : "Create Task"}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
