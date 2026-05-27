"use client"

import { useMemo, useState } from "react"
import {
  Video, Clock, Users, FileText, CheckSquare, Search,
  Sparkles, Lightbulb, Link2, Calendar, Plus, Mic, Download, Share2,
} from "lucide-react"

type Tab = "summary" | "transcript" | "actions"

const STATUS_STYLES: Record<string, string> = {
  Ready: "badge-moss",
  "Action Required": "badge-amber",
  Processing: "badge-neutral",
}

const MOCK_MEETINGS = [
  {
    id: "m1", title: "Weekly Sync: Product Team",
    date: "2026-05-26T10:00:00Z", duration: "45m", status: "Ready",
    attendees: ["Alice Chen", "Bob Patel", "Charlie Wu"], source: "Fireflies",
    summary: "The team agreed to prioritize the new dashboard rollout for Q3. Charlie will finalize the engineering lead hire by Friday, and Alice will update the Q3 strategy doc before Monday.",
    decisions: ["Accelerate dashboard rollout to Q3 (was Q4)", "Pause the analytics revamp until the new lead is hired", "Move weekly sync to Tuesdays at 10am"],
    actionItems: [
      { id: "a1", text: "Finalize engineering lead hire", owner: "Charlie Wu", due: "2026-05-29" },
      { id: "a2", text: "Update Q3 strategy document with dashboard priority", owner: "Alice Chen", due: "2026-05-30" },
    ],
    transcript: [
      { time: "00:00", speaker: "Alice Chen", text: "Alright, let's get started. The main goal today is to review the Q3 strategy draft." },
      { time: "00:45", speaker: "Bob Patel", text: "I've looked over the draft. I think we need to accelerate the dashboard rollout — it's becoming a blocker for sales." },
      { time: "01:20", speaker: "Alice Chen", text: "Agreed. Charlie, can you take point on finalizing the engineering lead role to help with that?" },
    ],
    related: [{ title: "Q3 Strategy Draft v0.4" }, { title: "Hire: Engineering Lead" }],
  },
  {
    id: "m2", title: "Client Kickoff: Acme Corp",
    date: "2026-05-25T14:00:00Z", duration: "60m", status: "Action Required",
    attendees: ["David Reyes", "Eve Larsson", "Marcus Tan"], source: "Fathom",
    summary: "Acme Corp confirmed Phase 1 scope and approved the proposed timeline. They flagged a hard dependency on their security review.",
    decisions: ["Phase 1 timeline locked at 10 weeks", "All deploys gated on Acme security review"],
    actionItems: [
      { id: "a3", text: "Send signed SOW to Acme legal", owner: "Alex Chen", due: "2026-05-27" },
      { id: "a4", text: "Schedule first security review session", owner: "Marcus Tan", due: "2026-05-28" },
    ],
    transcript: [],
    related: [{ title: "Acme Corp SOW v3" }],
  },
  {
    id: "m3", title: "1:1 with Sarah",
    date: "2026-05-26T15:30:00Z", duration: "30m", status: "Processing",
    attendees: ["Sarah Kim"], source: "Fireflies",
    summary: "Processing transcript and summary…", decisions: [], actionItems: [], transcript: [], related: [],
  },
]

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((p) => p[0]).join("").toUpperCase()
}

function relativeDay(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  if (diff < 7) return `${diff} days ago`
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export default function MeetingsPage() {
  const [selectedId, setSelectedId] = useState(MOCK_MEETINGS[0].id)
  const [tab, setTab] = useState<Tab>("summary")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("All")

  const meetings = useMemo(() => {
    return MOCK_MEETINGS.filter((m) => {
      if (statusFilter !== "All" && m.status !== statusFilter) return false
      if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [search, statusFilter])

  const selected = MOCK_MEETINGS.find((m) => m.id === selectedId) || MOCK_MEETINGS[0]
  const isProcessing = selected.status === "Processing"

  return (
    <div className="flex h-full" style={{ backgroundColor: "#f6f3ec" }}>
      {/* Meetings list */}
      <div className="w-80 border-r flex-col hidden md:flex" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
        <div className="p-4 border-b space-y-3" style={{ borderColor: "#d8d2c4" }}>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-medium" style={{ fontFamily: "var(--font-heading), serif" }}>Meetings</h1>
            <button className="p-1.5 rounded-md transition-colors" style={{ color: "#6b6357" }}>
              <Plus size={16} />
            </button>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "#948a7b" }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search meetings…"
              className="input-field w-full pl-8 py-1.5 text-xs"
            />
          </div>
          <div className="flex gap-1 flex-wrap">
            {["All", "Action Required", "Ready", "Processing"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors"
                style={{
                  backgroundColor: statusFilter === s ? "#1a1714" : "#efeadf",
                  color: statusFilter === s ? "#fbfaf6" : "#6b6357",
                }}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {meetings.map((meeting) => (
            <button
              key={meeting.id}
              onClick={() => { setSelectedId(meeting.id); setTab("summary") }}
              className="w-full text-left p-3 rounded-lg transition-colors border"
              style={{
                backgroundColor: selectedId === meeting.id ? "#f6f3ec" : "transparent",
                borderColor: selectedId === meeting.id ? "#d8d2c4" : "transparent",
                boxShadow: selectedId === meeting.id ? "0 1px 2px rgba(26,23,20,0.05)" : "none",
              }}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h3 className="font-medium text-sm leading-snug" style={{ color: "#1a1714" }}>{meeting.title}</h3>
                <span className={`shrink-0 badge text-[9px] ${STATUS_STYLES[meeting.status] || "badge-neutral"}`}>{meeting.status}</span>
              </div>
              <div className="flex items-center justify-between text-[11px]" style={{ color: "#6b6357" }}>
                <span className="flex items-center gap-1"><Calendar size={10} /> {relativeDay(meeting.date)}</span>
                <span className="flex items-center gap-1"><Clock size={10} /> {meeting.duration}</span>
              </div>
              {meeting.actionItems.length > 0 && (
                <div className="mt-1.5 text-[10px] font-medium flex items-center gap-1" style={{ color: "#2d5a4f" }}>
                  <CheckSquare size={10} /> {meeting.actionItems.length} action{meeting.actionItems.length === 1 ? "" : "s"}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Meeting detail */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="px-6 py-5 border-b" style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs mb-2 flex-wrap" style={{ color: "#6b6357" }}>
                <span className="badge badge-neutral flex items-center gap-1">
                  <Video size={10} /> {selected.source}
                </span>
                <span className="flex items-center gap-1"><Clock size={12} /> {selected.duration}</span>
                <span>•</span>
                <span>{new Date(selected.date).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
              </div>
              <h2 className="text-2xl font-medium leading-tight" style={{ fontFamily: "var(--font-heading), serif", color: "#1a1714" }}>
                {selected.title}
              </h2>
              <div className="flex items-center gap-3 mt-3">
                <div className="flex -space-x-2">
                  {selected.attendees.slice(0, 4).map((a) => (
                    <div key={a} title={a} className="w-7 h-7 rounded-full border-2 flex items-center justify-center text-[10px] font-medium" style={{ backgroundColor: "#efeadf", borderColor: "#fbfaf6", color: "#6b6357" }}>
                      {initials(a)}
                    </div>
                  ))}
                </div>
                <span className="text-xs" style={{ color: "#6b6357" }}>{selected.attendees.join(", ")}</span>
              </div>
            </div>
            <div className="flex gap-1 shrink-0">
              {[Mic, Download, Share2].map((Icon, i) => (
                <button key={i} className="p-2 rounded-md transition-colors" style={{ color: "#6b6357" }}>
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-5 -mb-5 border-b" style={{ borderColor: "#e8e2d4" }}>
            {[
              { id: "summary" as Tab, label: "Summary", icon: Sparkles },
              { id: "transcript" as Tab, label: "Transcript", icon: FileText },
              { id: "actions" as Tab, label: `Actions${selected.actionItems.length ? ` (${selected.actionItems.length})` : ""}`, icon: CheckSquare },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
                style={{
                  borderBottomColor: tab === id ? "#2d5a4f" : "transparent",
                  color: tab === id ? "#2d5a4f" : "#6b6357",
                }}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {isProcessing ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-6">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mb-4 animate-pulse" style={{ backgroundColor: "#efeadf" }}>
                <Sparkles size={20} style={{ color: "#6b6357" }} />
              </div>
              <h3 className="text-lg font-medium mb-1" style={{ fontFamily: "var(--font-heading), serif" }}>Processing transcript</h3>
              <p className="text-sm max-w-xs" style={{ color: "#6b6357" }}>TARS is summarizing this meeting. Summary and actions will appear here in a moment.</p>
            </div>
          ) : tab === "summary" ? (
            <div className="max-w-3xl mx-auto px-8 py-8 space-y-8">
              <section>
                <h3 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: "#6b6357" }}>
                  <Sparkles size={14} style={{ color: "#2d5a4f" }} /> Summary
                </h3>
                <p className="text-lg leading-relaxed" style={{ fontFamily: "var(--font-heading), serif", color: "#1a1714" }}>{selected.summary}</p>
              </section>
              {selected.decisions.length > 0 && (
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: "#6b6357" }}>
                    <Lightbulb size={14} style={{ color: "#2d5a4f" }} /> Key decisions
                  </h3>
                  <ul className="space-y-2">
                    {selected.decisions.map((d, i) => (
                      <li key={i} className="flex gap-3 text-sm leading-relaxed">
                        <span className="font-mono text-xs mt-1 shrink-0" style={{ color: "#2d5a4f" }}>{String(i + 1).padStart(2, "0")}</span>
                        <span style={{ color: "#1a1714" }}>{d}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {selected.actionItems.length > 0 && (
                <section>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-xs font-medium uppercase tracking-wider flex items-center gap-2" style={{ color: "#6b6357" }}>
                      <CheckSquare size={14} style={{ color: "#2d5a4f" }} /> Action items
                    </h3>
                    <button onClick={() => setTab("actions")} className="text-xs font-medium hover:underline" style={{ color: "#2d5a4f" }}>View all →</button>
                  </div>
                  <div className="space-y-2">
                    {selected.actionItems.slice(0, 3).map((a) => (
                      <div key={a.id} className="card p-3 flex items-start justify-between gap-3" style={{ backgroundColor: "#f6f3ec", borderColor: "#e8e2d4" }}>
                        <div className="min-w-0">
                          <p className="text-sm font-medium leading-snug" style={{ color: "#1a1714" }}>{a.text}</p>
                          <p className="text-xs mt-1" style={{ color: "#6b6357" }}>
                            {a.owner} · due {new Date(a.due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                          </p>
                        </div>
                        <button className="text-xs font-medium hover:underline shrink-0" style={{ color: "#2d5a4f" }}>Create Task</button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
              {selected.related.length > 0 && (
                <section>
                  <h3 className="text-xs font-medium uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: "#6b6357" }}>
                    <Link2 size={14} style={{ color: "#2d5a4f" }} /> Related
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {selected.related.map((r, i) => (
                      <span key={i} className="badge badge-neutral flex items-center gap-1.5 px-2.5 py-1 cursor-pointer">
                        <Link2 size={11} /><span className="text-[11px]">{r.title}</span>
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : tab === "transcript" ? (
            <div className="max-w-3xl mx-auto px-8 py-8">
              {selected.transcript.length > 0 ? (
                <div className="space-y-6">
                  {selected.transcript.map((turn, i) => (
                    <div key={i} className="flex gap-4">
                      <div className="w-12 text-xs pt-1 font-mono shrink-0" style={{ color: "#948a7b" }}>{turn.time}</div>
                      <div className="min-w-0">
                        <div className="font-medium text-sm mb-1" style={{ color: "#2d5a4f" }}>{turn.speaker}</div>
                        <p className="text-sm leading-relaxed" style={{ color: "#1a1714" }}>{turn.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm italic text-center py-12" style={{ color: "#6b6357" }}>No transcript available.</p>
              )}
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-8 py-8 space-y-3">
              {selected.actionItems.length > 0 ? (
                selected.actionItems.map((a) => (
                  <div key={a.id} className="card flex items-start gap-3 group">
                    <input type="checkbox" className="mt-1 w-4 h-4 rounded shrink-0 cursor-pointer" style={{ accentColor: "#2d5a4f" }} />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm" style={{ color: "#1a1714" }}>{a.text}</p>
                      <div className="flex items-center gap-3 text-xs mt-1.5" style={{ color: "#6b6357" }}>
                        <span className="flex items-center gap-1"><Users size={11} /> {a.owner}</span>
                        <span className="flex items-center gap-1"><Calendar size={11} /> due {new Date(a.due).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                      </div>
                    </div>
                    <button className="text-xs font-medium hover:underline shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "#2d5a4f" }}>
                      Create Task
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-sm italic text-center py-12" style={{ color: "#6b6357" }}>No action items extracted from this meeting.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
