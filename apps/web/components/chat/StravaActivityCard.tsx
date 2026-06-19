"use client"

import { useState } from "react"
import { Activity, Mountain, Clock, Zap, Heart, X, ExternalLink } from "lucide-react"

export interface StravaActivity {
  id: number
  name: string
  sport_type: string
  date: string
  distance_km: number | string
  duration: string
  elevation_m?: number
  avg_hr?: number
  max_hr?: number
  avg_speed_kph?: number
  avg_watts?: number
  suffer_score?: number
  pr_count?: number
  calories?: number
}

function SportIcon({ type }: { type: string }) {
  const t = type.toLowerCase()
  if (t.includes("ride") || t.includes("cycling")) return <Activity size={14} style={{ color: "var(--c-moss)" }} />
  if (t.includes("run"))  return <Activity size={14} style={{ color: "#f5a623" }} />
  return <Activity size={14} style={{ color: "var(--c-ink-faint)" }} />
}

function sportColor(type: string): string {
  const t = type.toLowerCase()
  if (t.includes("ride") || t.includes("cycling")) return "var(--c-moss)"
  if (t.includes("run"))  return "#f5a623"
  return "var(--c-ink-faint)"
}

function StatCell({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span
        style={{
          fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
          fontSize: "9px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--c-ink-faint)",
        }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1">
        {icon}
        <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--c-ink)" }}>{value}</span>
      </div>
    </div>
  )
}

export function StravaActivityCard({
  activity,
  onDismiss,
}: {
  activity: StravaActivity
  onDismiss: () => void
}) {
  const dist = typeof activity.distance_km === "number"
    ? activity.distance_km.toFixed(1)
    : activity.distance_km

  const stravaUrl = `https://www.strava.com/activities/${activity.id}`

  const dateStr = (() => {
    try {
      return new Date(activity.date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
    } catch { return activity.date }
  })()

  const stats: Array<{ label: string; value: string; icon?: React.ReactNode }> = [
    { label: "Distance",  value: `${dist} km` },
    { label: "Duration",  value: activity.duration, icon: <Clock size={10} style={{ color: "var(--c-ink-faint)" }} /> },
  ]
  if (activity.elevation_m)  stats.push({ label: "Elevation",  value: `${Math.round(activity.elevation_m)} m`, icon: <Mountain size={10} style={{ color: "var(--c-ink-faint)" }} /> })
  if (activity.avg_hr)       stats.push({ label: "Avg HR",     value: `${Math.round(activity.avg_hr)} bpm`, icon: <Heart size={10} style={{ color: "#f87171" }} /> })
  if (activity.avg_watts)    stats.push({ label: "Avg Power",  value: `${Math.round(activity.avg_watts)} W`, icon: <Zap size={10} style={{ color: "#f5a623" }} /> })
  if (activity.avg_speed_kph) stats.push({ label: "Avg Speed", value: `${activity.avg_speed_kph.toFixed(1)} km/h` })

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: "var(--c-surface)",
        border: "1px solid var(--c-border-faint)",
        maxWidth: 480,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2.5"
        style={{ borderBottom: "1px solid var(--c-border-faint)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <SportIcon type={activity.sport_type} />
          <div className="min-w-0">
            <p
              className="truncate"
              style={{ fontSize: "13px", fontWeight: 600, color: "var(--c-ink)", lineHeight: 1.2 }}
            >
              {activity.name}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: "9px",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: sportColor(activity.sport_type),
                }}
              >
                {activity.sport_type.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                  fontSize: "9px",
                  color: "var(--c-ink-faint)",
                  letterSpacing: "0.04em",
                }}
              >
                {dateStr}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {activity.pr_count ? (
            <span
              style={{
                fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
                fontSize: "9px",
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: "#f5a623",
                background: "rgba(245,166,35,0.1)",
                border: "1px solid rgba(245,166,35,0.25)",
                padding: "1px 5px",
                borderRadius: 4,
              }}
            >
              {activity.pr_count} PR
            </span>
          ) : null}
          <button
            onClick={onDismiss}
            style={{ color: "var(--c-ink-faint)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Stats grid */}
      <div
        className="grid px-3 py-2.5 gap-x-6 gap-y-2.5"
        style={{ gridTemplateColumns: `repeat(${Math.min(stats.length, 3)}, auto) 1fr` }}
      >
        {stats.map(s => (
          <StatCell key={s.label} label={s.label} value={s.value} icon={s.icon} />
        ))}
      </div>

      {/* Footer */}
      {(activity.suffer_score || activity.calories) && (
        <div
          className="flex items-center gap-3 px-3 py-2"
          style={{ borderTop: "1px solid var(--c-border-faint)" }}
        >
          {activity.suffer_score && (
            <span style={{ fontSize: "11px", color: "var(--c-ink-faint)" }}>
              Suffer score: <strong style={{ color: "var(--c-ink-muted)" }}>{activity.suffer_score}</strong>
            </span>
          )}
          {activity.calories && (
            <span style={{ fontSize: "11px", color: "var(--c-ink-faint)" }}>
              {activity.calories} kcal
            </span>
          )}
          <div className="flex-1" />
          <a
            href={stravaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] no-underline"
            style={{ color: "var(--c-ink-faint)" }}
          >
            <ExternalLink size={10} />
            Strava
          </a>
        </div>
      )}
      {!activity.suffer_score && !activity.calories && (
        <div className="flex justify-end px-3 py-1.5">
          <a
            href={stravaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] no-underline"
            style={{ color: "var(--c-ink-faint)" }}
          >
            <ExternalLink size={10} />
            View on Strava
          </a>
        </div>
      )}
    </div>
  )
}

export function StravaActivityList({
  activities,
  onDismissAll,
}: {
  activities: StravaActivity[]
  onDismissAll: () => void
}) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())

  const visible = activities.filter(a => !dismissed.has(a.id))
  if (visible.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {visible.slice(0, 5).map(a => (
        <StravaActivityCard
          key={a.id}
          activity={a}
          onDismiss={() => setDismissed(prev => new Set([...prev, a.id]))}
        />
      ))}
      {visible.length > 5 && (
        <p style={{ fontSize: "11px", color: "var(--c-ink-faint)" }}>
          +{visible.length - 5} more activities
        </p>
      )}
    </div>
  )
}
