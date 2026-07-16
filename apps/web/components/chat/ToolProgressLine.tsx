"use client"

import { useEffect, useState } from "react"
import {
  Mail, Calendar, CheckSquare, Search, MapPin, User,
  FileText, Zap, Activity, Car, Mic, Database, Globe,
  Loader2,
} from "lucide-react"

export interface ToolProgress {
  tool: string
  status: string
  done: boolean
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  read_email:            <Mail size={11} />,
  send_email:            <Mail size={11} />,
  create_calendar_event: <Calendar size={11} />,
  update_calendar_event: <Calendar size={11} />,
  delete_calendar_event: <Calendar size={11} />,
  propose_calendar_event:<Calendar size={11} />,
  create_task:           <CheckSquare size={11} />,
  propose_task:          <CheckSquare size={11} />,
  web_search:            <Globe size={11} />,
  lookup_contact:        <User size={11} />,
  search_contacts:       <User size={11} />,
  create_contact:        <User size={11} />,
  update_contact:        <User size={11} />,
  search_places:         <MapPin size={11} />,
  save_place:            <MapPin size={11} />,
  get_saved_places:      <MapPin size={11} />,
  read_meeting:          <Mic size={11} />,
  sync_meetings:         <Mic size={11} />,
  generate_document:     <FileText size={11} />,
  generate_presentation: <FileText size={11} />,
  generate_pdf:          <FileText size={11} />,
  get_strava_activities: <Activity size={11} />,
  get_strava_activity:   <Activity size={11} />,
  get_strava_stats:      <Activity size={11} />,
  get_strava_zones:      <Activity size={11} />,
  get_tesla_status:      <Car size={11} />,
  tesla_command:         <Car size={11} />,
  save_memory:           <Database size={11} />,
  save_to_second_brain:  <Database size={11} />,
  create_agent_job:      <Zap size={11} />,
  read_google_doc:       <FileText size={11} />,
  update_google_doc:     <FileText size={11} />,
  search_drive:          <Search size={11} />,
  generate_chart:        <Search size={11} />,
}

export function ToolProgressLine({ progress }: { progress: ToolProgress }) {
  const [visible, setVisible] = useState(true)

  // fade out 800ms after done
  useEffect(() => {
    if (!progress.done) return
    const t = setTimeout(() => setVisible(false), 1800)
    return () => clearTimeout(t)
  }, [progress.done])

  if (!visible) return null

  const icon = TOOL_ICONS[progress.tool] ?? <Loader2 size={11} />

  return (
    <div
      className="flex items-center gap-1.5 transition-opacity duration-500"
      style={{
        opacity: progress.done ? 0 : 1,
        fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
        fontSize: "10px",
        color: "var(--c-ink-faint)",
        letterSpacing: "0.06em",
        animation: "tars-progress-in 200ms var(--ease-out-quart) both",
      }}
    >
      <span style={{ color: progress.done ? "var(--c-moss)" : "var(--c-ink-faint)" }}>
        {progress.done
          ? <span style={{ color: "var(--c-moss)", fontSize: 9 }}>✓</span>
          : <Loader2 size={10} className="animate-spin" style={{ color: "var(--c-moss)" }} />
        }
      </span>
      <span style={{ color: "var(--c-ink-faint)" }}>{icon}</span>
      <span>{progress.status}</span>
    </div>
  )
}

export function ToolProgressStack({ items }: { items: ToolProgress[] }) {
  if (items.length === 0) return null
  // Only show the last active (non-done) item, or the last done item while fading
  const active = [...items].reverse().find(i => !i.done) ?? items[items.length - 1]
  return (
    <div className="mb-1.5">
      <ToolProgressLine progress={active} />
    </div>
  )
}
