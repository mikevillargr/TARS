"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { Eye, EyeOff, Smartphone, MapPin, Check, Share, Loader2, Plus, Pencil, Trash2, X, Lock, Volume2, Play, ChevronsUpDown, AlertTriangle, TrendingUp } from "lucide-react"
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

interface TierConfig { provider: Provider; model: string; backupProvider: Provider | ""; backupModel: string }
interface ModelRouting { tier1: TierConfig; tier2: TierConfig; tier3: TierConfig; vision: TierConfig }

// API wire shape (snake_case, backups included)
interface ApiTierConfig { provider: Provider; model: string; backup_provider: string; backup_model: string }
interface ApiModelRouting { tier1: ApiTierConfig; tier2: ApiTierConfig; tier3: ApiTierConfig; vision: ApiTierConfig }

function fromApiTier(t: ApiTierConfig): TierConfig {
  return {
    provider: t.provider,
    model: t.model,
    backupProvider: (t.backup_provider || "") as Provider | "",
    backupModel: t.backup_model || "",
  }
}
function fromApiRouting(d: ApiModelRouting): ModelRouting {
  return { tier1: fromApiTier(d.tier1), tier2: fromApiTier(d.tier2), tier3: fromApiTier(d.tier3), vision: fromApiTier(d.vision) }
}

// ─── Task-category forced routing ──────────────────────────────────────────
const CATEGORY_DEFS = [
  { key: "quick_lookup", label: "Quick Lookups",       desc: "Status checks, single-tool reads, short Q&A" },
  { key: "writing",      label: "Writing & Content",   desc: "Docs, reports, proposals, emails, summaries" },
  { key: "coding",       label: "Coding & Technical",  desc: "Code generation, debugging, technical Q&A" },
  { key: "data_viz",     label: "Data & Charts",       desc: "Charts, plots, graphs, visualizing data" },
  { key: "analysis",     label: "Analysis & Strategy", desc: "Deep analysis, research, client deliverables" },
  { key: "general",      label: "General Chat",        desc: "Conversational / everything else" },
] as const
type CategoryKey = typeof CATEGORY_DEFS[number]["key"]
interface CategoryConfig { provider: Provider | ""; model: string }
type CategoryRouting = Record<CategoryKey, CategoryConfig>

const ANTHROPIC_MODELS = [
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (fast)" },
  { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6" },
  { value: "claude-opus-4-8",           label: "Claude Opus 4.8 (frontier)" },
]

const ZAI_MODELS = [
  // Free
  { value: "glm-4.5-flash",       label: "GLM-4.5 Flash — FREE" },
  { value: "glm-4.7-flash",       label: "GLM-4.7 Flash — FREE" },
  // Budget
  { value: "glm-4-32b-0414-128k", label: "GLM-4 32B (128K)" },
  { value: "glm-4.7-flashx",      label: "GLM-4.7 FlashX" },
  { value: "glm-4.5-airx",        label: "GLM-4.5 AirX" },
  { value: "glm-4.5-air",         label: "GLM-4.5 Air" },
  // Standard
  { value: "glm-4.5",             label: "GLM-4.5" },
  { value: "glm-4.5-x",           label: "GLM-4.5 X" },
  { value: "glm-4.6",             label: "GLM-4.6" },
  { value: "glm-4.7",             label: "GLM-4.7" },
  // Frontier (OpenAI-compatible endpoint)
  { value: "glm-5",               label: "GLM-5" },
  { value: "glm-5-turbo",         label: "GLM-5 Turbo" },
  { value: "glm-5.1",             label: "GLM-5.1 (flagship)" },
]

const ZAI_VISION_MODELS = [
  { value: "glm-4.6v-flash",  label: "GLM-4.6V Flash — FREE" },
  { value: "glm-4.6v-flashx", label: "GLM-4.6V FlashX" },
  { value: "glm-4.5v",        label: "GLM-4.5V" },
  { value: "glm-4.6v",        label: "GLM-4.6V" },
  { value: "glm-5v-turbo",    label: "GLM-5V Turbo" },
]

const PROVIDER_DEFAULTS: Record<Provider, Record<string, string>> = {
  anthropic: { tier1: "claude-haiku-4-5-20251001", tier2: "claude-sonnet-4-6", tier3: "claude-sonnet-4-6", vision: "claude-sonnet-4-6" },
  zai:       { tier1: "glm-4.5-flash",             tier2: "glm-4.7",           tier3: "glm-5.1",           vision: "glm-5v-turbo" },
}

// ─── API key types ──────────────────────────────────────────────────────────
interface ApiKeys { anthropic: string; zai: string; runpod: string; tavily: string; fireflies: string; github: string; always_sunny: string; tessie: string; tessie_vin: string }
interface KeyEntry { id: keyof ApiKeys; label: string; description: string; editValue: string; testState: "idle" | "testing" | "ok" | "error"; testMsg: string; isPlainText?: boolean }

const KEY_DEFS: { id: keyof ApiKeys; label: string; description: string; isPlainText?: boolean }[] = [
  { id: "anthropic",    label: "Anthropic",    description: "Claude models — Haiku, Sonnet, Opus" },
  { id: "zai",          label: "Z.ai (GLM)",   description: "GLM models via Z.ai API" },
  { id: "runpod",       label: "RunPod",       description: "GPU inference endpoints" },
  { id: "tavily",       label: "Tavily",       description: "Web search tool" },
  { id: "fireflies",    label: "Fireflies",    description: "Meeting transcription" },
  { id: "github",       label: "GitHub",       description: "PAT for agent git push and PR creation" },
  { id: "tessie",       label: "Tessie",       description: "Tesla vehicle control — full API" },
  { id: "tessie_vin",   label: "Tesla VIN",    description: "Your Tesla vehicle identification number", isPlainText: true },
  { id: "always_sunny", label: "AlwaysSunny",  description: "Solar + home battery controller" },
]

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

  // Password change
  const [currentPw, setCurrentPw]   = useState("")
  const [newPw, setNewPw]           = useState("")
  const [confirmPw, setConfirmPw]   = useState("")
  const [pwSaving, setPwSaving]     = useState(false)
  const [pwError, setPwError]       = useState("")
  const [pwSaved, setPwSaved]       = useState(false)
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw]   = useState(false)

  // Model routing — live from backend
  const blankTier = (model: string): TierConfig => ({ provider: "anthropic", model, backupProvider: "", backupModel: "" })
  const [routing, setRouting]   = useState<ModelRouting>({
    tier1:  blankTier("claude-haiku-4-5-20251001"),
    tier2:  blankTier("claude-sonnet-4-6"),
    tier3:  blankTier("claude-sonnet-4-6"),
    vision: blankTier("claude-sonnet-4-6"),
  })
  const [routingSaving, setRoutingSaving] = useState(false)
  const [routingSaved,  setRoutingSaved]  = useState(false)

  // Task-category forced routing — live from backend
  const emptyCategoryRouting = (): CategoryRouting =>
    CATEGORY_DEFS.reduce((acc, c) => { acc[c.key] = { provider: "", model: "" }; return acc }, {} as CategoryRouting)
  const [categoryRouting, setCategoryRouting] = useState<CategoryRouting>(emptyCategoryRouting())
  const [categorySaving, setCategorySaving]   = useState(false)
  const [categorySaved,  setCategorySaved]    = useState(false)

  // API keys — masked values from backend + local edit state
  const [keyEntries, setKeyEntries] = useState<KeyEntry[]>(
    KEY_DEFS.map(d => ({ ...d, editValue: "", testState: "idle", testMsg: "" }))
  )
  const [maskedKeys, setMaskedKeys] = useState<ApiKeys>({ anthropic: "", zai: "", runpod: "", tavily: "", fireflies: "", github: "", always_sunny: "", tessie: "", tessie_vin: "" })
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  // PWA install state
  const installPromptRef = useRef<BeforeInstallPromptEvent | null>(null)
  const [installable, setInstallable]       = useState(false)
  const [isInstalled, setIsInstalled]       = useState(false)
  const [isIOS, setIsIOS]                   = useState(false)
  const [showIOSInstructions, setShowIOSInstructions] = useState(false)
  const [installDone, setInstallDone]       = useState(false)

  // Feed refresh interval
  const [feedRefreshHours, setFeedRefreshHours] = useState<number>(24)
  const [feedRefreshSaving, setFeedRefreshSaving] = useState(false)
  const [feedRefreshSaved, setFeedRefreshSaved] = useState(false)

  // Voice / TTS
  const [ttsVoice, setTtsVoice]   = useState<string>("af_bella")
  const [ttsSpeed, setTtsSpeed]   = useState<number>(1.0)
  const [voiceList, setVoiceList] = useState<string[]>([])
  const [ttsSaved, setTtsSaved]   = useState(false)
  const [ttsPreviewState, setTtsPreviewState] = useState<"idle" | "loading" | "playing">("idle")

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

    apiGet<ApiModelRouting>("/settings/model-routing")
      .then(d => setRouting(fromApiRouting(d)))
      .catch(console.error)

    apiGet<Record<string, CategoryConfig>>("/settings/model-routing/categories")
      .then(d => setCategoryRouting(prev => ({ ...prev, ...d } as CategoryRouting)))
      .catch(console.error)

    apiGet<ApiKeys>("/settings/api-keys")
      .then(d => setMaskedKeys(d))
      .catch(console.error)

    apiGet<{ hours: number }>("/feed/refresh-interval")
      .then(d => setFeedRefreshHours(d.hours))
      .catch(() => {/* no sources yet, use default */})

    apiGet<{ voices: string[] }>("/tts/voices")
      .then(d => setVoiceList(d.voices))
      .catch(() => {/* TTS optional — fail silently */})

    // Load TTS prefs from server (source of truth), fall back to localStorage
    apiGet<{ name: string; timezone: string; tts_voice: string; tts_speed: number }>("/settings")
      .then(d => {
        if (d.tts_voice) { setTtsVoice(d.tts_voice); localStorage.setItem("tars-voice", d.tts_voice) }
        if (d.tts_speed) { setTtsSpeed(d.tts_speed); localStorage.setItem("tars-voice-speed", String(d.tts_speed)) }
      })
      .catch(() => {
        const savedVoice = localStorage.getItem("tars-voice")
        const savedSpeed = localStorage.getItem("tars-voice-speed")
        if (savedVoice) setTtsVoice(savedVoice)
        if (savedSpeed) setTtsSpeed(parseFloat(savedSpeed))
      })
  }, [])

  // PWA detection
  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    setIsInstalled(standalone)

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream
    setIsIOS(ios)

    // Chrome fires beforeinstallprompt once, early, on whatever page loaded
    // first — usually not this one. A head script (see app/layout.tsx) captures
    // it globally into window.__tarsInstallPrompt; pick it up here whether it
    // already fired before mount or fires later.
    type W = Window & { __tarsInstallPrompt?: BeforeInstallPromptEvent | null }
    const adopt = () => {
      const stashed = (window as W).__tarsInstallPrompt
      if (stashed) {
        installPromptRef.current = stashed
        setInstallable(true)
      }
    }
    adopt() // already-fired case

    const handler = (e: Event) => {
      e.preventDefault()
      installPromptRef.current = e as BeforeInstallPromptEvent
      setInstallable(true)
    }
    const onInstalled = () => { setIsInstalled(true); setInstallable(false) }
    window.addEventListener("beforeinstallprompt", handler)
    window.addEventListener("tars-installable", adopt)     // fired-after-mount case
    window.addEventListener("tars-installed", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
      window.removeEventListener("tars-installable", adopt)
      window.removeEventListener("tars-installed", onInstalled)
    }
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

  async function savePassword() {
    setPwError("")
    if (newPw !== confirmPw) { setPwError("Passwords do not match"); return }
    if (newPw.length < 8) { setPwError("Password must be at least 8 characters"); return }
    setPwSaving(true)
    try {
      const res = await apiPost<{ ok: boolean }>("/settings/change-password", {
        current_password: currentPw,
        new_password: newPw,
      })
      if (res.ok) {
        setCurrentPw(""); setNewPw(""); setConfirmPw("")
        setPwSaved(true)
        setTimeout(() => setPwSaved(false), 2000)
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "Failed"
      setPwError(msg.includes("400") ? "Current password is incorrect" : "Failed to update password")
    } finally {
      setPwSaving(false)
    }
  }

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }))
  }

  // Model routing handlers
  const setTierProvider = useCallback((tier: keyof ModelRouting, provider: Provider) => {
    setRouting(prev => ({
      ...prev,
      [tier]: { ...prev[tier], provider, model: PROVIDER_DEFAULTS[provider][tier] },
    }))
  }, [])

  const setTierModel = useCallback((tier: keyof ModelRouting, model: string) => {
    setRouting(prev => ({ ...prev, [tier]: { ...prev[tier], model } }))
  }, [])

  // Backup: "" provider = no backup. Selecting a provider seeds its tier default.
  const setTierBackupProvider = useCallback((tier: keyof ModelRouting, provider: Provider | "") => {
    setRouting(prev => ({
      ...prev,
      [tier]: {
        ...prev[tier],
        backupProvider: provider,
        backupModel: provider ? PROVIDER_DEFAULTS[provider][tier] : "",
      },
    }))
  }, [])

  const setTierBackupModel = useCallback((tier: keyof ModelRouting, model: string) => {
    setRouting(prev => ({ ...prev, [tier]: { ...prev[tier], backupModel: model } }))
  }, [])

  // ── Model/category picker sheet ───────────────────────────────────────────
  type SheetTarget =
    | { kind: "tier-primary"; tier: keyof ModelRouting }
    | { kind: "tier-backup"; tier: keyof ModelRouting }
    | { kind: "category"; cat: CategoryKey }
    | null
  const [sheet, setSheet] = useState<SheetTarget>(null)

  // ── Token usage analytics ──────────────────────────────────────────────────
  type TokenPeriod = "today" | "7d" | "30d"
  type TokenReport = {
    totals: { total_tokens: number; input_tokens: number; output_tokens: number; messages: number; period: string }
    by_model: Array<{ model: string; total_tokens: number; input_tokens: number; output_tokens: number; calls: number; avg_per_call: number }>
    cron_costs: Array<{ name: string; total_tokens: number; avg_per_run: number; runs: number }>
    top_conversations: Array<{ id: string; title: string; total_tokens: number; messages: number; last_at: string }>
    flags: Array<{ type: string; severity: string; message: string; detail: string }>
    recommendations: string[]
  }
  const [tokenPeriod, setTokenPeriod] = useState<TokenPeriod>("7d")
  const [tokenReport, setTokenReport] = useState<TokenReport | null>(null)
  const [tokenLoading, setTokenLoading] = useState(false)

  async function loadTokenReport(period: TokenPeriod = tokenPeriod) {
    setTokenLoading(true)
    try {
      const data = await apiGet(`/analytics/tokens?period=${period}`) as TokenReport
      setTokenReport(data)
    } catch (e) { console.error(e) } finally { setTokenLoading(false) }
  }

  useEffect(() => { loadTokenReport("7d") }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const TIER_LABELS: Record<keyof ModelRouting, string> = {
    tier1: "Tier 1 — Fast", tier2: "Tier 2 — Workhorse", tier3: "Tier 3 — Frontier", vision: "Vision — Analysis",
  }

  function modelLabel(provider: Provider | "", model: string, isVision: boolean): string {
    if (!provider || !model) return ""
    const list = provider === "zai" ? (isVision ? ZAI_VISION_MODELS : ZAI_MODELS) : ANTHROPIC_MODELS
    return list.find(m => m.value === model)?.label ?? model
  }

  function getSheetConfig(target: SheetTarget) {
    if (!target) return null
    if (target.kind === "tier-primary") {
      const cfg = routing[target.tier]
      const isVision = target.tier === "vision"
      return {
        title: `${TIER_LABELS[target.tier]} — Primary`,
        providerOptions: [["anthropic", "Anthropic"], ["zai", "Z.ai"]] as [Provider | "", string][],
        provider: cfg.provider as Provider | "",
        onProvider: (p: Provider | "") => p && setTierProvider(target.tier, p),
        modelOptions: cfg.provider === "zai" ? (isVision ? ZAI_VISION_MODELS : ZAI_MODELS) : ANTHROPIC_MODELS,
        model: cfg.model,
        onModel: (m: string) => setTierModel(target.tier, m),
      }
    }
    if (target.kind === "tier-backup") {
      const cfg = routing[target.tier]
      const isVision = target.tier === "vision"
      return {
        title: `${TIER_LABELS[target.tier]} — Backup`,
        providerOptions: [["", "Off"], ["anthropic", "Anthropic"], ["zai", "Z.ai"]] as [Provider | "", string][],
        provider: cfg.backupProvider,
        onProvider: (p: Provider | "") => setTierBackupProvider(target.tier, p),
        modelOptions: cfg.backupProvider === "zai" ? (isVision ? ZAI_VISION_MODELS : ZAI_MODELS) : ANTHROPIC_MODELS,
        model: cfg.backupModel,
        onModel: (m: string) => setTierBackupModel(target.tier, m),
      }
    }
    // category
    const cfg = categoryRouting[target.cat] ?? { provider: "", model: "" }
    const catDef = CATEGORY_DEFS.find(c => c.key === target.cat)!
    return {
      title: catDef.label,
      providerOptions: [["", "Default"], ["anthropic", "Anthropic"], ["zai", "Z.ai"]] as [Provider | "", string][],
      provider: cfg.provider,
      onProvider: (p: Provider | "") => setCategoryProvider(target.cat, p),
      modelOptions: cfg.provider === "zai" ? ZAI_MODELS : ANTHROPIC_MODELS,
      model: cfg.model,
      onModel: (m: string) => setCategoryModel(target.cat, m),
    }
  }

  function ValueRow({ label, desc, value, placeholder, onClick, sub }: { label: string; desc?: string; value: string; placeholder: string; onClick: () => void; sub?: boolean }) {
    return (
      <button
        onClick={onClick}
        className="flex items-center justify-between w-full text-left gap-3 transition-colors"
        style={{ backgroundColor: "var(--c-surface)", padding: sub ? "0.625rem 1rem 0.625rem 2rem" : "0.75rem 1rem" }}
      >
        <div className="min-w-0">
          {sub ? (
            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>{label}</span>
          ) : (
            <div className="text-sm font-medium" style={{ color: "var(--c-ink)" }}>{label}</div>
          )}
          {desc && <div className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>{desc}</div>}
        </div>
        <span className="flex items-center gap-1 text-xs shrink-0 max-w-[55%]" style={{ color: value ? "var(--c-ink)" : "var(--c-ink-faint)" }}>
          <span className="truncate">{value || placeholder}</span>
          <ChevronsUpDown size={13} style={{ color: "var(--c-ink-faint)" }} />
        </span>
      </button>
    )
  }

  async function saveModelRouting() {
    setRoutingSaving(true)
    try {
      const tierBody = (t: TierConfig) => ({
        provider: t.provider,
        model_override: t.model,
        backup_provider: t.backupProvider,                 // "" clears the backup
        backup_model_override: t.backupProvider ? t.backupModel : "",
      })
      const body = {
        tier1:  tierBody(routing.tier1),
        tier2:  tierBody(routing.tier2),
        tier3:  tierBody(routing.tier3),
        vision: tierBody(routing.vision),
      }
      const updated = await apiPatch<ApiModelRouting>("/settings/model-routing", body)
      setRouting(fromApiRouting(updated))
      setRoutingSaved(true)
      setTimeout(() => setRoutingSaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setRoutingSaving(false)
    }
  }

  // Task-category routing handlers
  const setCategoryProvider = useCallback((cat: CategoryKey, provider: Provider | "") => {
    setCategoryRouting(prev => ({
      ...prev,
      [cat]: provider
        ? { provider, model: PROVIDER_DEFAULTS[provider]["tier3"] }   // seed with frontier default
        : { provider: "", model: "" },
    }))
  }, [])

  const setCategoryModel = useCallback((cat: CategoryKey, model: string) => {
    setCategoryRouting(prev => ({ ...prev, [cat]: { ...prev[cat], model } }))
  }, [])

  async function saveCategoryRouting() {
    setCategorySaving(true)
    try {
      const body: Record<string, CategoryConfig> = {}
      for (const c of CATEGORY_DEFS) {
        const cfg = categoryRouting[c.key]
        body[c.key] = cfg?.provider ? { provider: cfg.provider, model: cfg.model } : { provider: "", model: "" }
      }
      const updated = await apiPatch<Record<string, CategoryConfig>>("/settings/model-routing/categories", body)
      setCategoryRouting(prev => ({ ...prev, ...updated } as CategoryRouting))
      setCategorySaved(true)
      setTimeout(() => setCategorySaved(false), 2000)
    } catch (err) {
      console.error(err)
    } finally {
      setCategorySaving(false)
    }
  }

  // API key handlers
  async function saveKey(id: keyof ApiKeys) {
    const entry = keyEntries.find(k => k.id === id)
    if (!entry?.editValue) return
    try {
      await apiPatch("/settings/api-keys", { provider: id, key: entry.editValue })
      const val = entry.editValue
      setMaskedKeys(prev => ({ ...prev, [id]: "•".repeat(Math.max(0, val.length - 6)) + val.slice(-6) }))
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

  async function saveTtsSettings() {
    // Save to server (source of truth) + mirror to localStorage for instant reads
    try {
      await apiPatch("/settings", { tts_voice: ttsVoice, tts_speed: ttsSpeed })
    } catch (err) {
      console.error("Failed to save TTS settings to server:", err)
    }
    localStorage.setItem("tars-voice", ttsVoice)
    localStorage.setItem("tars-voice-speed", String(ttsSpeed))
    setTtsSaved(true)
    setTimeout(() => setTtsSaved(false), 2000)
  }

  async function previewVoice() {
    setTtsPreviewState("loading")
    try {
      const res = await fetch("/api/proxy/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "TARS online. Ready to assist.", voice: ttsVoice, speed: ttsSpeed }),
      })
      if (!res.ok) { setTtsPreviewState("idle"); return }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const audio = new Audio(url)
      setTtsPreviewState("playing")
      audio.onended = () => { URL.revokeObjectURL(url); setTtsPreviewState("idle") }
      audio.onerror = () => { URL.revokeObjectURL(url); setTtsPreviewState("idle") }
      audio.play().catch(() => setTtsPreviewState("idle"))
    } catch {
      setTtsPreviewState("idle")
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

  async function saveFeedRefresh(hours: number) {
    setFeedRefreshHours(hours)
    setFeedRefreshSaving(true)
    try {
      await apiPatch("/feed/refresh-interval", { hours })
      setFeedRefreshSaved(true)
      setTimeout(() => setFeedRefreshSaved(false), 2000)
    } catch (e) { console.error(e) } finally {
      setFeedRefreshSaving(false)
    }
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

  // Compute grouped voice options outside JSX for reliable controlled-select behavior
  const VOICE_GROUPS: Record<string, string> = {
    af: "American English — Female", am: "American English — Male",
    bf: "British English — Female",  bm: "British English — Male",
    ef: "Spanish — Female",          em: "Spanish — Male",
    ff: "French — Female",
    hf: "Hindi — Female",            hm: "Hindi — Male",
    "if": "Italian — Female",        im: "Italian — Male",
    jf: "Japanese — Female",         jm: "Japanese — Male",
    pf: "Portuguese — Female",       pm: "Portuguese — Male",
    zf: "Chinese — Female",          zm: "Chinese — Male",
  }
  const voiceOptions = voiceList.length === 0
    ? <option value={ttsVoice}>{ttsVoice}</option>
    : (() => {
        const grouped: Record<string, string[]> = {}
        for (const v of voiceList) {
          const pfx = v.slice(0, 2)
          if (!grouped[pfx]) grouped[pfx] = []
          grouped[pfx].push(v)
        }
        return Object.entries(grouped).map(([pfx, voices]) => (
          <optgroup key={pfx} label={VOICE_GROUPS[pfx] ?? pfx.toUpperCase()}>
            {voices.map(v => <option key={v} value={v}>{v.slice(v.indexOf("_") + 1)}</option>)}
          </optgroup>
        ))
      })()

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "var(--c-canvas)" }}>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        {/* Page heading */}
        <h1 className="text-xl font-semibold" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>
          Settings
        </h1>

        {/* ── Profile ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
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
            <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
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
            <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
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
              return (
                <div key={tier.key} style={{ borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none" }}>
                  <div className="px-4 py-2.5 flex items-baseline justify-between" style={{ backgroundColor: "var(--c-surface-2)" }}>
                    <span className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>{tier.label}</span>
                    <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{tier.desc}</span>
                  </div>
                  <div style={{ borderTop: "1px solid var(--c-border-faint)" }}>
                    <ValueRow
                      sub
                      label="Primary"
                      value={`${cfg.provider === "zai" ? "Z.ai" : "Anthropic"} · ${modelLabel(cfg.provider, cfg.model, isVision)}`}
                      placeholder="Choose model"
                      onClick={() => setSheet({ kind: "tier-primary", tier: tier.key })}
                    />
                  </div>
                  <div style={{ borderTop: "1px solid var(--c-border-faint)" }}>
                    <ValueRow
                      sub
                      label="Backup"
                      value={cfg.backupProvider ? `${cfg.backupProvider === "zai" ? "Z.ai" : "Anthropic"} · ${modelLabel(cfg.backupProvider, cfg.backupModel, isVision)}` : ""}
                      placeholder="No fallback"
                      onClick={() => setSheet({ kind: "tier-backup", tier: tier.key })}
                    />
                  </div>
                  {isVision && cfg.provider === "zai" && (
                    <div className="text-[10px]" style={{ color: "var(--c-ink-faint)", padding: "0 1rem 0.5rem 2rem" }}>
                      Routes via Z.ai OpenAI-compatible endpoint
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--c-ink-faint)" }}>
            Backup takes over automatically if the primary errors or times out, and stays in use
            until the primary recovers — TARS re-checks the primary each turn and reverts the moment
            it responds.
          </p>
        </section>

        {/* ── Task-Category Routing ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
              Task-Category Routing
            </h2>
            <button
              onClick={saveCategoryRouting}
              disabled={categorySaving}
              className="text-xs px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 disabled:opacity-50"
              style={{ backgroundColor: categorySaved ? "var(--c-moss)" : "var(--c-surface-2)", color: categorySaved ? "#fff" : "var(--c-ink)" }}
            >
              {categorySaving && <Loader2 size={11} className="animate-spin" />}
              {categorySaved ? "Saved ✓" : "Save"}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed -mt-1" style={{ color: "var(--c-ink-faint)" }}>
            Force a specific model for a kind of task, overriding tier routing. Leave a category on
            <span className="font-mono"> Default</span> to use normal tier-based routing.
          </p>

          <div className="flex flex-col gap-0 rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border-faint)" }}>
            {CATEGORY_DEFS.map((cat, i) => {
              const cfg = categoryRouting[cat.key] ?? { provider: "", model: "" }
              return (
                <div key={cat.key} style={{ borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none" }}>
                  <ValueRow
                    label={cat.label}
                    desc={cat.desc}
                    value={cfg.provider ? `${cfg.provider === "zai" ? "Z.ai" : "Anthropic"} · ${modelLabel(cfg.provider, cfg.model, false)}` : ""}
                    placeholder="Tier default"
                    onClick={() => setSheet({ kind: "category", cat: cat.key })}
                  />
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Voice ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
              Voice
            </h2>
            {ttsSaved && (
              <span className="text-xs flex items-center gap-1" style={{ color: "var(--c-moss)" }}>
                <Check size={12} /> Saved
              </span>
            )}
          </div>
          <p className="text-xs" style={{ color: "var(--c-ink-muted)" }}>
            TARS speaks responses when you use voice input. Choose a voice and speed here.
          </p>

          <div className="flex flex-col gap-3">
            {/* Voice selector */}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--c-ink-muted)" }}>Voice</label>
              <div className="flex gap-2">
                <select
                  className="input-field flex-1"
                  value={ttsVoice}
                  onChange={e => setTtsVoice(e.target.value)}
                >
                  {voiceOptions}
                </select>
                <button
                  onClick={previewVoice}
                  disabled={ttsPreviewState === "loading" || ttsPreviewState === "playing"}
                  className="btn-secondary flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                  style={{ padding: "0.375rem 0.75rem", fontSize: "0.8125rem" }}
                  title="Preview this voice"
                >
                  {ttsPreviewState === "loading"
                    ? <Loader2 size={13} className="animate-spin" />
                    : ttsPreviewState === "playing"
                    ? <Volume2 size={13} className="animate-pulse" style={{ color: "var(--c-moss)" }} />
                    : <Play size={13} />
                  }
                  <span className="hidden sm:inline">Preview</span>
                </button>
              </div>
            </div>

            {/* Speed slider */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium" style={{ color: "var(--c-ink-muted)" }}>Speed</label>
                <span className="text-xs font-mono" style={{ color: "var(--c-ink-faint)" }}>{ttsSpeed.toFixed(1)}×</span>
              </div>
              <input
                type="range"
                min={0.5} max={2.0} step={0.1}
                value={ttsSpeed}
                onChange={e => setTtsSpeed(parseFloat(e.target.value))}
                className="w-full"
                style={{ accentColor: "var(--c-moss)" }}
              />
              <div className="flex justify-between text-[10px] mt-0.5" style={{ color: "var(--c-ink-faint)" }}>
                <span>0.5× slow</span>
                <span>1.0× normal</span>
                <span>2.0× fast</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveTtsSettings}
              className="btn-primary flex items-center gap-1.5"
              style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem" }}
            >
              {ttsSaved ? <><Check size={13} /> Saved</> : "Save Voice Settings"}
            </button>
          </div>
        </section>

        {/* ── Security ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
            Security
          </h2>
          <div className="grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--c-ink-muted)" }}>Current Password</label>
              <div className="relative">
                <input
                  type={showCurrentPw ? "text" : "password"}
                  className="input-field w-full pr-8"
                  value={currentPw}
                  onChange={e => setCurrentPw(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPw(p => !p)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5"
                  style={{ color: "var(--c-ink-faint)" }}
                >
                  {showCurrentPw ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--c-ink-muted)" }}>New Password</label>
                <div className="relative">
                  <input
                    type={showNewPw ? "text" : "password"}
                    className="input-field w-full pr-8"
                    value={newPw}
                    onChange={e => setNewPw(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPw(p => !p)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5"
                    style={{ color: "var(--c-ink-faint)" }}
                  >
                    {showNewPw ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--c-ink-muted)" }}>Confirm New Password</label>
                <input
                  type="password"
                  className="input-field w-full"
                  value={confirmPw}
                  onChange={e => setConfirmPw(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>
          {pwError && (
            <p className="text-xs" style={{ color: "var(--c-rose)" }}>{pwError}</p>
          )}
          <div className="flex justify-end">
            <button
              onClick={savePassword}
              disabled={pwSaving || !currentPw || !newPw || !confirmPw}
              className="btn-primary flex items-center gap-1.5 disabled:opacity-40"
              style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem" }}
            >
              {pwSaving ? <Loader2 size={13} className="animate-spin" /> : pwSaved ? <><Check size={13} /> Changed</> : <><Lock size={13} /> Change Password</>}
            </button>
          </div>
        </section>

        {/* ── Domains ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
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
                      <span className="text-[10px] font-semibold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0"
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

        {/* ── Feed ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
            Feed
          </h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold" style={{ color: "var(--c-ink)" }}>Refresh interval</div>
              <div className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>How often each feed checks for new content</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={feedRefreshHours}
                onChange={(e) => saveFeedRefresh(Number(e.target.value))}
                disabled={feedRefreshSaving}
                className="text-xs px-2 py-1.5 rounded-lg border outline-none transition-colors disabled:opacity-50"
                style={{ background: "var(--c-surface)", borderColor: "var(--c-border)", color: "var(--c-ink)", fontFamily: "var(--font-mono)" }}
              >
                <option value={6}>Every 6 hours</option>
                <option value={12}>Every 12 hours</option>
                <option value={24}>Once a day</option>
                <option value={48}>Every 2 days</option>
                <option value={72}>Every 3 days</option>
                <option value={168}>Once a week</option>
              </select>
              {feedRefreshSaved && (
                <span className="text-[11px] font-mono" style={{ color: "var(--c-moss)" }}>SAVED</span>
              )}
            </div>
          </div>
        </section>

        {/* ── API Keys ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
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
                    <div>
                      <div className="text-xs font-semibold" style={{ color: "var(--c-ink)" }}>{k.label}</div>
                      <div className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{k.description}</div>
                    </div>
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
                      {k.isPlainText ? (k.editValue || masked) : (visibleKeys[k.id] ? (k.editValue || masked) : masked)}
                    </div>
                    {!k.isPlainText && (
                      <button onClick={() => toggleKeyVisibility(k.id)} className="p-1 rounded shrink-0"
                        style={{ color: "var(--c-ink-faint)" }}>
                        {visibleKeys[k.id] ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    )}
                  </div>

                  {/* New key input + Save */}
                  <div className="flex items-center gap-2">
                    <input
                      type={k.isPlainText ? "text" : "password"}
                      placeholder={k.isPlainText ? "Enter value…" : "Paste new key to update…"}
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
        {/* ── Token Usage ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
              Token Usage
            </h2>
            <div className="flex items-center gap-2">
              {(["today", "7d", "30d"] as TokenPeriod[]).map(p => (
                <button
                  key={p}
                  onClick={() => { setTokenPeriod(p); loadTokenReport(p) }}
                  className="tars-label px-2 py-0.5 rounded transition-colors"
                  style={{
                    background: tokenPeriod === p ? "var(--c-moss)" : "transparent",
                    color: tokenPeriod === p ? "var(--c-surface)" : "var(--c-ink-faint)",
                    border: tokenPeriod === p ? "none" : "1px solid var(--c-border-faint)",
                    cursor: "pointer",
                  }}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => loadTokenReport(tokenPeriod)}
                disabled={tokenLoading}
                style={{ color: "var(--c-ink-faint)", cursor: "pointer", background: "none", border: "none", padding: 0, display: "flex", alignItems: "center" }}
              >
                {tokenLoading ? <Loader2 size={13} className="animate-spin" /> : <TrendingUp size={13} />}
              </button>
            </div>
          </div>

          {tokenLoading && !tokenReport && (
            <div className="flex items-center gap-2 py-4" style={{ color: "var(--c-ink-faint)" }}>
              <Loader2 size={14} className="animate-spin" />
              <span className="text-xs">Loading usage data…</span>
            </div>
          )}

          {tokenReport && (
            <div className="flex flex-col gap-4">
              {/* Totals row */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Total Tokens", value: tokenReport.totals.total_tokens.toLocaleString() },
                  { label: "Input", value: tokenReport.totals.input_tokens.toLocaleString() },
                  { label: "Messages", value: tokenReport.totals.messages.toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg p-3 flex flex-col gap-1" style={{ background: "var(--c-surface-2)", border: "1px solid var(--c-border-faint)" }}>
                    <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>{label}</span>
                    <span className="text-base font-semibold font-mono" style={{ color: "var(--c-ink)" }}>{value}</span>
                  </div>
                ))}
              </div>

              {/* Flags */}
              {tokenReport.flags.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>Flags</span>
                  {tokenReport.flags.map((f, i) => (
                    <div key={i} className="rounded-lg px-3 py-2.5 flex items-start gap-2.5" style={{
                      background: f.severity === "high" ? "color-mix(in srgb, #ef4444 8%, transparent)" : "color-mix(in srgb, #f59e0b 8%, transparent)",
                      border: `1px solid ${f.severity === "high" ? "color-mix(in srgb, #ef4444 25%, transparent)" : "color-mix(in srgb, #f59e0b 25%, transparent)"}`,
                    }}>
                      <AlertTriangle size={13} style={{ color: f.severity === "high" ? "#ef4444" : "#f59e0b", marginTop: 2, flexShrink: 0 }} />
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-xs font-medium" style={{ color: "var(--c-ink)" }}>{f.message}</span>
                        <span className="text-[11px]" style={{ color: "var(--c-ink-muted)" }}>{f.detail}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {tokenReport.recommendations.length > 0 && tokenReport.flags.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>Recommendations</span>
                  {tokenReport.recommendations.map((r, i) => (
                    <div key={i} className="text-xs rounded-lg px-3 py-2" style={{ color: "var(--c-ink-muted)", background: "var(--c-surface-2)", border: "1px solid var(--c-border-faint)" }}>
                      {r}
                    </div>
                  ))}
                </div>
              )}

              {/* By model */}
              {tokenReport.by_model.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>By Model</span>
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border-faint)" }}>
                    {tokenReport.by_model.slice(0, 6).map((m, i) => {
                      const maxT = tokenReport.by_model[0].total_tokens || 1
                      const pct = Math.round((m.total_tokens / maxT) * 100)
                      return (
                        <div key={m.model} className="flex items-center gap-3 px-3 py-2.5 relative" style={{
                          borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none",
                          background: "var(--c-surface)",
                        }}>
                          <div className="absolute inset-0 left-0" style={{ width: `${pct}%`, background: "color-mix(in srgb, var(--c-moss) 6%, transparent)", pointerEvents: "none" }} />
                          <span className="text-xs font-mono relative z-10 truncate flex-1 min-w-0" style={{ color: "var(--c-ink)" }}>{m.model}</span>
                          <div className="flex items-center gap-3 shrink-0 relative z-10">
                            <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>{m.calls} calls</span>
                            <span className="text-xs font-mono font-semibold" style={{ color: "var(--c-ink)" }}>{m.total_tokens.toLocaleString()}</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Cron costs */}
              {tokenReport.cron_costs.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>Scheduled Jobs</span>
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border-faint)" }}>
                    {tokenReport.cron_costs.map((c, i) => (
                      <div key={c.name} className="flex items-center justify-between px-3 py-2.5" style={{
                        borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none",
                        background: "var(--c-surface)",
                      }}>
                        <span className="text-xs" style={{ color: "var(--c-ink)" }}>{c.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>{c.runs} runs · {c.avg_per_run.toLocaleString()}/run</span>
                          <span className="text-xs font-mono font-semibold" style={{ color: "var(--c-ink)" }}>{c.total_tokens.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top conversations */}
              {tokenReport.top_conversations.filter(c => c.total_tokens > 0).length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>Top Conversations</span>
                  <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--c-border-faint)" }}>
                    {tokenReport.top_conversations.filter(c => c.total_tokens > 0).slice(0, 8).map((c, i) => (
                      <div key={c.id} className="flex items-center justify-between px-3 py-2.5" style={{
                        borderTop: i > 0 ? "1px solid var(--c-border-faint)" : "none",
                        background: "var(--c-surface)",
                      }}>
                        <span className="text-xs truncate max-w-[60%]" style={{ color: "var(--c-ink)" }}>{c.title}</span>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="tars-label" style={{ color: "var(--c-ink-faint)" }}>{c.messages} msgs</span>
                          <span className="text-xs font-mono font-semibold" style={{ color: "var(--c-ink)" }}>{c.total_tokens.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── App Installation ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2 className="text-[0.65rem] font-semibold font-mono uppercase tracking-wider" style={{ color: "var(--c-ink-faint)" }}>
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
                  {(installable || isIOS) && (
                    <button
                      onClick={handleInstall}
                      className="btn-primary flex items-center gap-1.5 mt-3"
                      style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem" }}
                    >
                      {isIOS ? <><Share size={13} /> Add to Home Screen</> : "Install"}
                    </button>
                  )}
                  {!installable && !isIOS && (
                    <span className="text-xs mt-2 block" style={{ color: "var(--c-ink-faint)" }}>
                      Use Chrome or Edge and refresh once — the Install button appears when the browser is ready.
                    </span>
                  )}
                </div>
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

      {/* ── Model/category picker sheet ── */}
      {sheet && (() => {
        const config = getSheetConfig(sheet)
        if (!config) return null
        return (
          <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
            style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
            onClick={() => setSheet(null)}
          >
            <div
              onClick={e => e.stopPropagation()}
              className="w-full sm:w-[26rem] sm:rounded-2xl rounded-t-2xl flex flex-col"
              style={{ backgroundColor: "var(--c-surface)", maxHeight: "80vh", border: "1px solid var(--c-border-faint)" }}
            >
              <div
                className="flex items-center justify-between px-4 py-3 shrink-0"
                style={{ borderBottom: "1px solid var(--c-border-faint)" }}
              >
                <span className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>{config.title}</span>
                <button onClick={() => setSheet(null)} className="p-1 rounded" style={{ color: "var(--c-ink-faint)" }}>
                  <X size={16} />
                </button>
              </div>
              <div className="overflow-y-auto px-4 py-4 flex flex-col gap-4">
                <div className="flex rounded-full overflow-hidden text-xs" style={{ border: "1px solid var(--c-border-faint)" }}>
                  {config.providerOptions.map(([p, lbl]) => (
                    <button
                      key={p || "off"}
                      onClick={() => config.onProvider(p)}
                      className="flex-1 px-3 py-1.5 font-medium transition-colors"
                      style={{
                        backgroundColor: config.provider === p ? "var(--c-moss)" : "transparent",
                        color: config.provider === p ? "#fff" : "var(--c-ink-faint)",
                      }}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {config.provider && (
                  <div className="flex flex-col gap-0.5">
                    {config.modelOptions.map(m => (
                      <button
                        key={m.value}
                        onClick={() => { config.onModel(m.value); setSheet(null) }}
                        className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-left transition-colors"
                        style={{ backgroundColor: config.model === m.value ? "var(--c-moss-soft)" : "transparent", color: "var(--c-ink)" }}
                      >
                        <span>{m.label}</span>
                        {config.model === m.value && <Check size={14} style={{ color: "var(--c-moss)" }} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
