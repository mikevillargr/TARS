"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Eye, EyeOff, Smartphone, MapPin, Check, Share, Loader2, Plus, Pencil, Trash2, X } from "lucide-react"
import { apiGet, apiPatch, apiPost, apiDelete } from "@/lib/api-client"
import { useDomains, invalidateDomains, type Domain } from "@/hooks/useDomains"

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

// ─── Model routing types & constants ──────────────────────────────────────
type Provider = "anthropic" | "zai"

interface TierConfig { provider: Provider; model: string }
interface ModelRouting { tier1: TierConfig; tier2: TierConfig; tier3: TierConfig; vision: TierConfig }

const ANTHROPIC_MODELS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast)" },
  { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4-8",           label: "Claude Opus 4.8 (frontier)" },
]

const ZAI_MODELS = [
  { value: "glm-4.5-air",   label: "GLM-4.5 Air (fast)" },
  { value: "glm-4.5",       label: "GLM-4.5" },
  { value: "glm-4.6",       label: "GLM-4.6" },
  { value: "glm-4.7",       label: "GLM-4.7" },
  { value: "glm-5.1",       label: "GLM-5.1 (flagship)" },
]

const ZAI_VISION_MODELS = [
  { value: "glm-5v-turbo", label: "GLM-5V Turbo (visual)" },
]

const PROVIDER_DEFAULTS: Record<Provider, Record<string, string>> = {
  anthropic: { tier1: "claude-haiku-4-5-20251001", tier2: "claude-sonnet-4-6", tier3: "claude-sonnet-4-6", vision: "claude-sonnet-4-6" },
  zai:       { tier1: "glm-4.5-air",               tier2: "glm-4.7",           tier3: "glm-5.1",           vision: "glm-5v-turbo" },
}

// ─── API key types ──────────────────────────────────────────────────────────
interface ApiKeys { anthropic: string; zai: string; runpod: string }
interface KeyEntry { id: keyof ApiKeys; provider: string; editValue: string; testState: "idle" | "testing" | "ok" | "error"; testMsg: string }

const INITIAL_NOTIFICATIONS = [
  { id: "chat",   label: "Chat responses",   push: true,  email: false, inApp: true },
  { id: "tasks",  label: "Task updates",      push: true,  email: true,  inApp: true },
  { id: "meet",   label: "Meetings",          push: false, email: true,  inApp: true },
  { id: "agent",  label: "Agent jobs",        push: true,  email: false, inApp: true },
  { id: "digest", label: "Email digest",      push: false, email: false, inApp: true },
  { id: "cron",   label: "Cron failures",     push: true,  email: true,  inApp: true },
]

const KEY_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  zai:       "Z.ai (GLM)",
  runpod:    "RunPod",
}

const DOMAIN_PALETTE = [
  "#6B7280", "#3B82F6", "#8B5CF6", "#10B981",
  "#F59E0B", "#EF4444", "#EC4899", "#14B8A6",
  "#F97316", "#6366F1", "#84CC16", "#78716C",
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
  const [notifs, setNotifs]     = useState(INITIAL_NOTIFICATIONS)

  // Model routing — live from backend
  const [routing, setRouting]   = useState<ModelRouting>({
    tier1:  { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
    tier2:  { provider: "anthropic", model: "claude-sonnet-4-6" },
    tier3:  { provider: "anthropic", model: "claude-sonnet-4-6" },
    vision: { provider: "anthropic", model: "claude-sonnet-4-6" },
  })
  const [routingSaving, setRoutingSaving] = useState(false)
  const [routingSaved,  setRoutingSaved]  = useState(false)

  // API keys — masked values from backend + local edit state
  const [keyEntries, setKeyEntries] = useState<KeyEntry[]>([
    { id: "anthropic", provider: "Anthropic", editValue: "", testState: "idle", testMsg: "" },
    { id: "zai",       provider: "Z.ai (GLM)", editValue: "", testState: "idle", testMsg: "" },
    { id: "runpod",    provider: "RunPod",     editValue: "", testState: "idle", testMsg: "" },
  ])
  const [maskedKeys, setMaskedKeys] = useState<ApiKeys>({ anthropic: "", zai: "", runpod: "" })
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  // PWA install state
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [installable, setInstallable]       = useState(false)
  const [isInstalled, setIsInstalled]       = useState(false)
  const [isIOS, setIsIOS]                   = useState(false)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)
  const [installDone, setInstallDone]       = useState(false)

  // Domains
  const { domains, reload: reloadDomains } = useDomains()
  const [newDomainName, setNewDomainName]   = useState("")
  const [newDomainColor, setNewDomainColor] = useState("#6366F1")
  const [addingDomain, setAddingDomain]     = useState(false)
  const [editingDomainId, setEditingDomainId] = useState<string | null>(null)
  const [editDomainName, setEditDomainName]   = useState("")
  const [editDomainColor, setEditDomainColor] = useState("")

  // Load all settings from API on mount
  useEffect(() => {
    apiGet<{ name: string; timezone: string }>("/settings")
      .then(d => { setName(d.name); setTimezone(d.timezone) })
      .catch(console.error)

    apiGet<ModelRouting>("/settings/model-routing")
      .then(d => setRouting(d))
      .catch(console.error)

    apiGet<ApiKeys>("/settings/api-keys")
      .then(d => setMaskedKeys(d))
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

  // Model routing handlers
  const setTierProvider = useCallback((tier: keyof ModelRouting, provider: Provider) => {
    setRouting(prev => ({
      ...prev,
      [tier]: { provider, model: PROVIDER_DEFAULTS[provider][tier] },
    }))
  }, [])

  const setTierModel = useCallback((tier: keyof ModelRouting, model: string) => {
    setRouting(prev => ({ ...prev, [tier]: { ...prev[tier], model } }))
  }, [])

  async function saveModelRouting() {
    setRoutingSaving(true)
    try {
      const body = {
        tier1:  { provider: routing.tier1.provider,  model_override: routing.tier1.model },
        tier2:  { provider: routing.tier2.provider,  model_override: routing.tier2.model },
        tier3:  { provider: routing.tier3.provider,  model_override: routing.tier3.model },
        vision: { provider: routing.vision.provider, model_override: routing.vision.model },
      }
      const updated = await apiPatch<ModelRouting>("/settings/model-routing", body)
      setRouting(updated)
      setRoutingSaved(true)
      setTimeout(() => setRoutingSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setRoutingSaving(false)
    }
  }

  // API key handlers
  async function saveKey(id: keyof ApiKeys) {
    const entry = keyEntries.find(k => k.id === id)
    if (!entry?.editValue) return
    try {
      await apiPatch("/settings/api-keys", { provider: id, key: entry.editValue })
      setMaskedKeys(prev => ({ ...prev, [id]: "•".repeat(entry.editValue.length - 6) + entry.editValue.slice(-6) }))
      setKeyEntries(prev => prev.map(k => k.id === id ? { ...k, editValue: "" } : k))
    } catch (err) {
      console.error(err)
    }
  }

  async function testKey(id: "anthropic" | "zai") {
    setKeyEntries(prev => prev.map(k => k.id === id ? { ...k, testState: "testing", testMsg: "" } : k))
    try {
      const res = await apiPost<{ ok: boolean; latency_ms?: number; error?: string }>(
        "/settings/api-keys/test", { provider: id }
      )
      setKeyEntries(prev => prev.map(k => k.id === id
        ? { ...k, testState: res.ok ? "ok" : "error", testMsg: res.ok ? `${res.latency_ms}ms` : (res.error ?? "failed") }
        : k
      ))
    } catch {
      setKeyEntries(prev => prev.map(k => k.id === id ? { ...k, testState: "error", testMsg: "Request failed" } : k))
    }
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

  async function addDomain() {
    if (!newDomainName.trim()) return
    try {
      await apiPost("/domains", { name: newDomainName.trim(), color: newDomainColor })
      invalidateDomains()
      await reloadDomains()
      setNewDomainName("")
      setNewDomainColor("#6366F1")
    } catch (e) { console.error(e) }
  }

  async function saveDomainEdit(id: string) {
    try {
      await apiPatch(`/domains/${id}`, { name: editDomainName.trim(), color: editDomainColor })
      invalidateDomains()
      await reloadDomains()
      setEditingDomainId(null)
    } catch (e) { console.error(e) }
  }

  async function deleteDomain(id: string) {
    try {
      await apiDelete(`/domains/${id}`)
      invalidateDomains()
      await reloadDomains()
    } catch (e) { console.error(e) }
  }

  function startEdit(d: Domain) {
    setEditingDomainId(d.id)
    setEditDomainName(d.name)
    setEditDomainColor(d.color)
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
          <div className="flex items-center justify-between">
            <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
              Model Routing
            </h2>
            <button
              onClick={saveModelRouting}
              disabled={routingSaving}
              className="text-xs px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
              style={{ backgroundColor: routingSaved ? "var(--c-moss)" : "var(--c-surface-2)", color: routingSaved ? "#fff" : "var(--c-ink)" }}
            >
              {routingSaving && <Loader2 size={11} className="animate-spin" />}
              {routingSaved ? "Saved ✓" : "Save"}
            </button>
          </div>

          <div className="flex flex-col gap-0 rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border-faint)" }}>
            {([
              { label: "Tier 1 — Fast",      key: "tier1"  as const, desc: "Simple queries, quick tasks" },
              { label: "Tier 2 — Workhorse", key: "tier2"  as const, desc: "Most day-to-day tasks" },
              { label: "Tier 3 — Frontier",  key: "tier3"  as const, desc: "Complex reasoning, deliverables" },
              { label: "Vision — Analysis",  key: "vision" as const, desc: "Image and photo analysis" },
            ] as const).map((tier, i) => {
              const cfg = routing[tier.key]
              const isVision = tier.key === "vision"
              const modelList = cfg.provider === "zai"
                ? (isVision ? ZAI_VISION_MODELS : ZAI_MODELS)
                : ANTHROPIC_MODELS
              return (
                <div
                  key={tier.key}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-4 py-3 gap-3"
                  style={{ borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none", backgroundColor: "var(--c-surface)" }}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>{tier.label}</div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>{tier.desc}</div>
                    {isVision && cfg.provider === "zai" && (
                      <div className="text-[10px] mt-0.5" style={{ color: "var(--c-ink-faint)" }}>
                        Routes via Z.ai OpenAI-compatible endpoint
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {/* Provider toggle */}
                    <div className="flex rounded-md overflow-hidden text-xs" style={{ border: "1px solid var(--c-border-faint)" }}>
                      {(["anthropic", "zai"] as Provider[]).map(p => (
                        <button
                          key={p}
                          onClick={() => setTierProvider(tier.key, p)}
                          className="px-2.5 py-1 font-medium transition-colors"
                          style={{
                            backgroundColor: cfg.provider === p ? "var(--c-moss)" : "var(--c-surface-2)",
                            color: cfg.provider === p ? "#fff" : "var(--c-ink-faint)",
                          }}
                        >
                          {p === "anthropic" ? "Anthropic" : "Z.ai"}
                        </button>
                      ))}
                    </div>
                    {/* Model dropdown */}
                    <select
                      className="input-field text-xs"
                      style={{ padding: "0.25rem 0.5rem", minWidth: "11rem" }}
                      value={cfg.model}
                      onChange={e => setTierModel(tier.key, e.target.value)}
                    >
                      {modelList.map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
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

        {/* ── Domains ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
              Domains
            </h2>
            <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
              Used to categorise memories and knowledge items
            </span>
          </div>

          {/* Domain list */}
          <div className="flex flex-col rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border-faint)" }}>
            {domains.map((d, i) => (
              <div
                key={d.id}
                className="flex items-center gap-3 px-3 py-2.5"
                style={{
                  borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none",
                  backgroundColor: "var(--c-surface)",
                }}
              >
                {editingDomainId === d.id ? (
                  /* Edit row */
                  <>
                    {/* Color swatches */}
                    <div className="flex items-center gap-1 shrink-0">
                      {DOMAIN_PALETTE.map(hex => (
                        <button
                          key={hex}
                          onClick={() => setEditDomainColor(hex)}
                          className="rounded-full transition-transform"
                          style={{
                            width: 14, height: 14,
                            backgroundColor: hex,
                            outline: editDomainColor === hex ? `2px solid ${hex}` : "none",
                            outlineOffset: 2,
                            transform: editDomainColor === hex ? "scale(1.2)" : "scale(1)",
                          }}
                        />
                      ))}
                    </div>
                    <input
                      autoFocus
                      className="input-field flex-1 text-sm"
                      style={{ padding: "0.2rem 0.5rem", height: "1.75rem" }}
                      value={editDomainName}
                      onChange={e => setEditDomainName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveDomainEdit(d.id); if (e.key === "Escape") setEditingDomainId(null) }}
                    />
                    <button
                      onClick={() => saveDomainEdit(d.id)}
                      className="text-xs px-2 py-1 rounded font-medium shrink-0"
                      style={{ backgroundColor: "var(--c-moss)", color: "#fff" }}
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingDomainId(null)} className="p-1 rounded shrink-0" style={{ color: "var(--c-ink-faint)" }}>
                      <X size={13} />
                    </button>
                  </>
                ) : (
                  /* Display row */
                  <>
                    <span className="rounded-full shrink-0" style={{ width: 10, height: 10, backgroundColor: d.color, display: "inline-block" }} />
                    <span className="flex-1 text-sm font-medium capitalize" style={{ color: "var(--c-ink)" }}>{d.name}</span>
                    {d.is_system && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
                        style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink-faint)" }}>
                        system
                      </span>
                    )}
                    <span className="text-xs shrink-0 tabular-nums" style={{ color: "var(--c-ink-faint)", minWidth: "2rem", textAlign: "right" }}>
                      {(d.memory_count + d.knowledge_count) || ""}
                    </span>
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <button onClick={() => startEdit(d)} className="p-1 rounded transition-colors hover:bg-[var(--c-surface-2)]" style={{ color: "var(--c-ink-faint)" }}>
                        <Pencil size={12} />
                      </button>
                      {!d.is_system && (
                        <button onClick={() => deleteDomain(d.id)} className="p-1 rounded transition-colors hover:bg-[var(--c-rose-soft)]" style={{ color: "var(--c-ink-faint)" }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Add new domain row */}
            {addingDomain ? (
              <div
                className="flex items-center gap-3 px-3 py-2.5"
                style={{ borderTop: "1px solid var(--c-border-faint)", backgroundColor: "var(--c-surface)" }}
              >
                <div className="flex items-center gap-1 shrink-0">
                  {DOMAIN_PALETTE.map(hex => (
                    <button
                      key={hex}
                      onClick={() => setNewDomainColor(hex)}
                      className="rounded-full transition-transform"
                      style={{
                        width: 14, height: 14,
                        backgroundColor: hex,
                        outline: newDomainColor === hex ? `2px solid ${hex}` : "none",
                        outlineOffset: 2,
                        transform: newDomainColor === hex ? "scale(1.2)" : "scale(1)",
                      }}
                    />
                  ))}
                </div>
                <input
                  autoFocus
                  placeholder="Domain name…"
                  className="input-field flex-1 text-sm"
                  style={{ padding: "0.2rem 0.5rem", height: "1.75rem" }}
                  value={newDomainName}
                  onChange={e => setNewDomainName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addDomain(); if (e.key === "Escape") { setAddingDomain(false); setNewDomainName("") } }}
                />
                <button
                  onClick={addDomain}
                  disabled={!newDomainName.trim()}
                  className="text-xs px-2 py-1 rounded font-medium shrink-0 disabled:opacity-40"
                  style={{ backgroundColor: "var(--c-moss)", color: "#fff" }}
                >
                  Add
                </button>
                <button onClick={() => { setAddingDomain(false); setNewDomainName("") }} className="p-1 rounded shrink-0" style={{ color: "var(--c-ink-faint)" }}>
                  <X size={13} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingDomain(true)}
                className="flex items-center gap-2 px-3 py-2.5 text-sm transition-colors w-full"
                style={{
                  borderTop: domains.length > 0 ? "1px solid var(--c-border-faint)" : "none",
                  color: "var(--c-ink-faint)",
                  backgroundColor: "transparent",
                }}
              >
                <Plus size={13} /> Add domain
              </button>
            )}
          </div>
          <p className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>
            New items are auto-classified into a domain. System domains can be renamed but not deleted. Deleting a custom domain reassigns its items to <em>general</em>.
          </p>
        </section>

        {/* ── API Keys ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
            API Keys
          </h2>
          <div className="flex flex-col gap-3">
            {keyEntries.map(k => {
              const masked = maskedKeys[k.id] || "••••••••••••••••"
              const canTest = k.id === "anthropic" || k.id === "zai"
              return (
                <div key={k.id} className="rounded-lg px-3 py-3 flex flex-col gap-2"
                  style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold" style={{ color: "var(--c-ink)" }}>{KEY_LABELS[k.id]}</div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Test button (Anthropic + Z.ai only) */}
                      {canTest && (
                        <button
                          onClick={() => testKey(k.id as "anthropic" | "zai")}
                          disabled={k.testState === "testing"}
                          className="text-[11px] px-2 py-0.5 rounded font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
                          style={{
                            backgroundColor: k.testState === "ok" ? "color-mix(in srgb, var(--c-moss) 15%, transparent)"
                              : k.testState === "error" ? "color-mix(in srgb, var(--c-rose) 15%, transparent)"
                              : "var(--c-surface-2)",
                            color: k.testState === "ok" ? "var(--c-moss)"
                              : k.testState === "error" ? "var(--c-rose)"
                              : "var(--c-ink-faint)",
                          }}
                        >
                          {k.testState === "testing" && <Loader2 size={10} className="animate-spin" />}
                          {k.testState === "ok" ? `✓ ${k.testMsg}` : k.testState === "error" ? `✗ ${k.testMsg}` : "Test"}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Current key (masked) + show/hide */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 text-[11px] font-mono truncate" style={{ color: "var(--c-ink-faint)" }}>
                      {visibleKeys[k.id] ? (k.editValue || masked) : masked}
                    </div>
                    <button onClick={() => toggleKeyVisibility(k.id)} className="p-1 rounded shrink-0"
                      style={{ color: "var(--c-ink-faint)" }}>
                      {visibleKeys[k.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                  </div>

                  {/* New key input + Save */}
                  <div className="flex items-center gap-2">
                    <input
                      type="password"
                      placeholder="Paste new key to update…"
                      value={k.editValue}
                      onChange={e => setKeyEntries(prev => prev.map(x => x.id === k.id ? { ...x, editValue: e.target.value, testState: "idle", testMsg: "" } : x))}
                      className="input-field flex-1 text-xs font-mono"
                      style={{ padding: "0.25rem 0.5rem" }}
                    />
                    <button
                      onClick={() => saveKey(k.id)}
                      disabled={!k.editValue}
                      className="text-xs px-3 py-1 rounded-md font-medium transition-colors disabled:opacity-30"
                      style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink)" }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              )
            })}
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
