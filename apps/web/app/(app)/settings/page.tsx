"use client"

import { useState, useEffect, useRef } from "react"
import { Eye, EyeOff, RotateCw, Trash2, Smartphone, MapPin, Check, Share } from "lucide-react"
import { apiGet, apiPatch } from "@/lib/api-client"

// Browsers that support beforeinstallprompt (Chrome, Edge, Android)
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative inline-flex items-center shrink-0 transition-colors"
      style={{
        width: "2rem",
        height: "1.25rem",
        borderRadius: "9999px",
        backgroundColor: enabled ? "var(--c-moss)" : "var(--c-border)",
        transition: "background-color 0.2s",
      }}
      aria-label="Toggle"
    >
      <span
        className="absolute"
        style={{
          width: "0.875rem",
          height: "0.875rem",
          borderRadius: "9999px",
          backgroundColor: "#ffffff",
          top: "50%",
          transform: `translateY(-50%) translateX(${enabled ? "1rem" : "0.125rem"})`,
          transition: "transform 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        }}
      />
    </button>
  )
}

const MODEL_OPTIONS = ["Qwen3 8B", "Qwen3 32B", "Claude Sonnet", "Claude Opus"]

const INITIAL_NOTIFICATIONS = [
  { id: "chat",   label: "Chat responses",   push: true,  email: false, inApp: true },
  { id: "tasks",  label: "Task updates",      push: true,  email: true,  inApp: true },
  { id: "meet",   label: "Meetings",          push: false, email: true,  inApp: true },
  { id: "agent",  label: "Agent jobs",        push: true,  email: false, inApp: true },
  { id: "digest", label: "Email digest",      push: false, email: false, inApp: true },
  { id: "cron",   label: "Cron failures",     push: true,  email: true,  inApp: true },
]

const INITIAL_KEYS = [
  { id: "anthropic", provider: "Anthropic", key: "sk-ant-•••••••••••••••••••••••Xk2a" },
  { id: "runpod",    provider: "RunPod",    key: "rpa_•••••••••••••••••••••••••• 7f2" },
]

// Common timezones sorted by offset
const COMMON_TIMEZONES = [
  "Pacific/Honolulu",
  "America/Anchorage",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Helsinki",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Hong_Kong",
  "Asia/Manila",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
]

export default function SettingsPage() {
  const [name, setName]         = useState("Mike Villar")
  const [timezone, setTimezone] = useState("Asia/Manila")
  const [tzSaved, setTzSaved]   = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [models, setModels]     = useState({ tier1: "Qwen3 8B", tier2: "Qwen3 32B", tier3: "Claude Sonnet" })
  const [notifs, setNotifs]     = useState(INITIAL_NOTIFICATIONS)
  const [keys, setKeys]         = useState(INITIAL_KEYS)
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  // PWA install state
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [installable, setInstallable]       = useState(false)
  const [isInstalled, setIsInstalled]       = useState(false)
  const [isIOS, setIsIOS]                   = useState(false)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)
  const [installDone, setInstallDone]       = useState(false)

  // Load settings from API
  useEffect(() => {
    apiGet<{ name: string; timezone: string }>("/settings")
      .then(d => {
        setName(d.name)
        setTimezone(d.timezone)
      })
      .catch(console.error)
  }, [])

  // PWA detection
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    setIsInstalled(standalone)

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream
    setIsIOS(ios)

    const handler = (e: Event) => {
      e.preventDefault()
      installPromptRef.current = e as BeforeInstallPromptEvent
      setInstallable(true)
    }
    window.addEventListener("beforeinstallprompt", handler)
    return () => window.removeEventListener("beforeinstallprompt", handler)
  }, [])

  async function handleInstall() {
    if (isIOS) {
      setShowIOSInstructions(prev => !prev)
      return
    }
    const prompt = installPromptRef.current
    if (!prompt) return
    await prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === "accepted") {
      setIsInstalled(true)
      setInstallable(false)
      installPromptRef.current = null
      setInstallDone(true)
    }
  }

  const toggleNotif = (id: string, field: "push" | "email" | "inApp") => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, [field]: !n[field] } : n))
  }

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function saveProfile() {
    try {
      await apiPatch("/settings", { name, timezone })
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 2000)
    } catch (err) {
      console.error(err)
    }
  }

  async function saveTimezone(tz: string) {
    try {
      await apiPatch("/settings", { timezone: tz })
      setTimezone(tz)
      setTzSaved(true)
      setTimeout(() => setTzSaved(false), 2000)
    } catch (err) {
      console.error(err)
    }
  }

  function autoDetect() {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (detected) saveTimezone(detected)
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--c-canvas)" }}>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Page heading */}
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>
          Settings
        </h1>

        {/* ── Profile ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
            Profile
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--c-ink-muted)" }}>Name</label>
              <input
                className="input-field w-full"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--c-ink-muted)" }}>Primary Email</label>
              <input
                className="input-field w-full"
                value="mike@growth-rocket.com"
                readOnly
                style={{ color: "var(--c-ink-faint)", cursor: "default" }}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={saveProfile}
              className="btn-primary flex items-center gap-1.5"
              style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem" }}
            >
              {profileSaved ? <><Check size={13} /> Saved</> : "Save Profile"}
            </button>
          </div>
        </section>

        {/* ── Timezone ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
              Timezone
            </h2>
            {tzSaved && (
              <span className="text-xs flex items-center gap-1" style={{ color: "var(--c-moss)" }}>
                <Check size={12} /> Saved
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--c-ink-muted)" }}>
            Used for all date and time responses, calendar formatting, and scheduling suggestions.
          </p>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--c-ink-faint)" }} />
              <select
                className="input-field w-full pl-8"
                value={timezone}
                onChange={e => saveTimezone(e.target.value)}
              >
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ))}
                {!COMMON_TIMEZONES.includes(timezone) && (
                  <option value={timezone}>{timezone.replace(/_/g, " ")}</option>
                )}
              </select>
            </div>
            <button
              onClick={autoDetect}
              className="btn-secondary text-xs shrink-0 flex items-center gap-1.5"
              style={{ padding: "0.375rem 0.75rem" }}
              title="Detect from browser"
            >
              <MapPin size={13} /> <span className="hidden sm:inline">Auto-detect</span><span className="sm:hidden">Auto</span>
            </button>
          </div>
          <p className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
            Current: <span className="font-mono">{timezone}</span>
            {" · "}
            {new Date().toLocaleTimeString(undefined, { timeZone: timezone, hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}
          </p>
        </section>

        {/* ── Model Routing ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
            Model Routing
          </h2>
          <div className="flex flex-col gap-0 rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border-faint)" }}>
            {[
              { label: "Tier 1 — Fast",      key: "tier1" as const, desc: "Simple queries, quick tasks" },
              { label: "Tier 2 — Workhorse", key: "tier2" as const, desc: "Most day-to-day tasks" },
              { label: "Tier 3 — Frontier",  key: "tier3" as const, desc: "Complex reasoning, deliverables" },
            ].map((tier, i) => (
              <div
                key={tier.key}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-3 gap-2"
                style={{
                  borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none",
                  backgroundColor: "var(--c-surface)",
                }}
              >
                <div>
                  <div className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>{tier.label}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>{tier.desc}</div>
                </div>
                <select
                  className="input-field w-full sm:w-40 text-xs shrink-0"
                  style={{ padding: "0.3rem 0.6rem" }}
                  value={models[tier.key]}
                  onChange={e => setModels(prev => ({ ...prev, [tier.key]: e.target.value }))}
                >
                  {MODEL_OPTIONS.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </section>

        {/* ── Notifications ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
            Notifications
          </h2>
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border-faint)" }}>
            {/* Header row */}
            <div
              className="grid px-4 py-2"
              style={{
                gridTemplateColumns: "1fr 44px 44px 44px",
                backgroundColor: "var(--c-surface-2)",
                borderBottom: "1px solid var(--c-border-faint)",
              }}
            >
              {["", "Push", "Email", "App"].map(h => (
                <span key={h} className="text-[0.6rem] font-semibold uppercase tracking-wider text-center" style={{ color: "var(--c-ink-faint)" }}>
                  {h}
                </span>
              ))}
            </div>
            {notifs.map((notif, i) => (
              <div
                key={notif.id}
                className="grid items-center px-4 py-2.5"
                style={{
                  gridTemplateColumns: "1fr 44px 44px 44px",
                  borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none",
                  backgroundColor: "var(--c-surface)",
                }}
              >
                <span className="text-sm pr-2" style={{ color: "var(--c-ink)" }}>{notif.label}</span>
                <span className="flex justify-center"><Toggle enabled={notif.push}  onChange={() => toggleNotif(notif.id, "push")} /></span>
                <span className="flex justify-center"><Toggle enabled={notif.email} onChange={() => toggleNotif(notif.id, "email")} /></span>
                <span className="flex justify-center"><Toggle enabled={notif.inApp} onChange={() => toggleNotif(notif.id, "inApp")} /></span>
              </div>
            ))}
          </div>
        </section>

        {/* ── API Keys ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
            API Keys
          </h2>
          <div className="flex flex-col gap-2">
            {keys.map(k => (
              <div
                key={k.id}
                className="rounded-lg px-3 py-3 flex items-center gap-3"
                style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold mb-0.5" style={{ color: "var(--c-ink)" }}>{k.provider}</div>
                  <div className="text-[11px] font-mono truncate" style={{ color: "var(--c-ink-faint)" }}>
                    {visibleKeys[k.id] ? k.key : k.key.replace(/[^•·]/g, "•").slice(0, 32) + "…"}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleKeyVisibility(k.id)}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: "var(--c-ink-faint)" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    title={visibleKeys[k.id] ? "Hide" : "Show"}
                  >
                    {visibleKeys[k.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    className="p-1.5 rounded transition-colors"
                    style={{ color: "var(--c-ink-faint)" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    title="Rotate"
                  >
                    <RotateCw size={14} />
                  </button>
                  <button
                    className="p-1.5 rounded transition-colors"
                    style={{ color: "var(--c-rose)" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-rose-soft)")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── App Installation ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
            App Installation
          </h2>

          {isInstalled || installDone ? (
            /* Already installed */
            <div
              className="rounded-xl p-4 flex items-center gap-4"
              style={{ backgroundColor: "var(--c-moss-soft)", border: "1px solid color-mix(in srgb, var(--c-moss) 20%, transparent)" }}
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-moss)" }}>
                <Check size={20} style={{ color: "var(--c-surface)" }} />
              </div>
              <div>
                <div className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>TARS is installed</div>
                <div className="text-xs mt-0.5" style={{ color: "var(--c-ink-muted)" }}>Running as a native app on this device.</div>
              </div>
            </div>
          ) : (
            <>
              <div
                className="rounded-xl p-4 flex items-center gap-4"
                style={{ backgroundColor: "var(--c-moss-soft)", border: "1px solid color-mix(in srgb, var(--c-moss) 20%, transparent)" }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: "var(--c-moss)" }}>
                  <Smartphone size={20} style={{ color: "var(--c-surface)" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>Install TARS on this device</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--c-ink-muted)" }}>
                    {isIOS
                      ? "Add to Home Screen for a full-screen native experience."
                      : "Add to home screen for offline access and push notifications."}
                  </div>
                </div>
                {(installable || isIOS) && (
                  <button
                    onClick={handleInstall}
                    className="btn-primary shrink-0 flex items-center gap-1.5"
                    style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem" }}
                  >
                    {isIOS ? <><Share size={13} /> Share</> : "Install"}
                  </button>
                )}
                {!installable && !isIOS && (
                  <span className="text-xs shrink-0" style={{ color: "var(--c-ink-faint)" }}>
                    Open in Chrome or Safari
                  </span>
                )}
              </div>

              {/* iOS step-by-step instructions */}
              {isIOS && showIOSInstructions && (
                <div
                  className="rounded-xl px-4 py-3 flex flex-col gap-2 text-sm"
                  style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}
                >
                  <p className="font-medium" style={{ color: "var(--c-ink)" }}>Add to Home Screen on iOS:</p>
                  <ol className="flex flex-col gap-1.5 text-xs list-decimal list-inside" style={{ color: "var(--c-ink-muted)" }}>
                    <li>Tap the <strong>Share</strong> button <span style={{ color: "var(--c-moss)" }}>⎋</span> in Safari&apos;s toolbar</li>
                    <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
                    <li>Tap <strong>Add</strong> in the top-right corner</li>
                  </ol>
                  <p className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
                    TARS will appear on your Home Screen like a native app.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
