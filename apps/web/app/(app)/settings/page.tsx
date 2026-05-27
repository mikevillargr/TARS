"use client"

import { useState } from "react"
import { Eye, EyeOff, RotateCw, Trash2, Smartphone } from "lucide-react"

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <button
      onClick={onChange}
      className="relative inline-flex items-center shrink-0 transition-colors"
      style={{
        width: "2rem",
        height: "1.25rem",
        borderRadius: "9999px",
        backgroundColor: enabled ? "#2d5a4f" : "#d8d2c4",
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
  { id: "meet",   label: "Meeting summaries", push: false, email: true,  inApp: true },
  { id: "agent",  label: "Agent job updates", push: true,  email: false, inApp: true },
  { id: "digest", label: "Email digest",      push: false, email: false, inApp: true },
  { id: "cron",   label: "Cron failures",     push: true,  email: true,  inApp: true },
]

const INITIAL_KEYS = [
  { id: "anthropic", provider: "Anthropic",       key: "sk-ant-•••••••••••••••••••••••Xk2a" },
  { id: "runpod",    provider: "RunPod",           key: "rpa_•••••••••••••••••••••••••• 7f2" },
]

export default function SettingsPage() {
  const [name, setName]   = useState("Mike Villar")
  const [email]           = useState("mike@growth-rocket.com")
  const [models, setModels] = useState({ tier1: "Qwen3 8B", tier2: "Qwen3 32B", tier3: "Claude Sonnet" })
  const [notifs, setNotifs] = useState(INITIAL_NOTIFICATIONS)
  const [keys, setKeys]     = useState(INITIAL_KEYS)
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({})

  const toggleNotif = (id: string, field: "push" | "email" | "inApp") => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, [field]: !n[field] } : n))
  }

  const toggleKeyVisibility = (id: string) => {
    setVisibleKeys(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="flex-1 overflow-y-auto" style={{ backgroundColor: "#f6f3ec" }}>
      <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-6">
        {/* Page heading */}
        <h1 className="text-xl font-semibold text-[#1a1714]" style={{ fontFamily: "var(--font-heading), serif" }}>
          Settings
        </h1>

        {/* ── Profile ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2
            className="text-[0.65rem] font-semibold uppercase tracking-wider"
            style={{ color: "#948a7b" }}
          >
            Profile
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#6b6357] mb-1">Name</label>
              <input
                className="input-field w-full"
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#6b6357] mb-1">Primary Email</label>
              <input
                className="input-field w-full"
                value={email}
                readOnly
                style={{ color: "#948a7b", cursor: "default" }}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button className="btn-primary" style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem" }}>
              Save Profile
            </button>
          </div>
        </section>

        {/* ── Model Routing ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2
            className="text-[0.65rem] font-semibold uppercase tracking-wider"
            style={{ color: "#948a7b" }}
          >
            Model Routing
          </h2>
          <div className="flex flex-col gap-0 rounded-lg overflow-hidden" style={{ border: "1px solid #e8e2d4" }}>
            {[
              { label: "Tier 1 — Fast",    key: "tier1" as const, desc: "Simple queries, quick tasks" },
              { label: "Tier 2 — Workhorse", key: "tier2" as const, desc: "Most day-to-day tasks" },
              { label: "Tier 3 — Frontier", key: "tier3" as const, desc: "Complex reasoning, deliverables" },
            ].map((tier, i) => (
              <div
                key={tier.key}
                className="flex items-center justify-between px-4 py-3"
                style={{
                  borderTop: i > 0 ? "1px solid #e8e2d4" : "none",
                  backgroundColor: "#fbfaf6",
                }}
              >
                <div>
                  <div className="text-sm font-medium text-[#1a1714]">{tier.label}</div>
                  <div className="text-xs text-[#948a7b] mt-0.5">{tier.desc}</div>
                </div>
                <select
                  className="input-field w-40 text-xs"
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
          <h2
            className="text-[0.65rem] font-semibold uppercase tracking-wider"
            style={{ color: "#948a7b" }}
          >
            Notifications
          </h2>
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: "1px solid #e8e2d4" }}
          >
            {/* Header */}
            <div
              className="grid px-4 py-2"
              style={{
                gridTemplateColumns: "1fr 60px 60px 60px",
                backgroundColor: "#efeadf",
                borderBottom: "1px solid #e8e2d4",
              }}
            >
              {["", "Push", "Email", "In-App"].map(h => (
                <span key={h} className="text-[0.6rem] font-semibold uppercase tracking-wider text-center" style={{ color: "#948a7b" }}>
                  {h}
                </span>
              ))}
            </div>

            {notifs.map((notif, i) => (
              <div
                key={notif.id}
                className="grid items-center px-4 py-2.5"
                style={{
                  gridTemplateColumns: "1fr 60px 60px 60px",
                  borderTop: i > 0 ? "1px solid #e8e2d4" : "none",
                  backgroundColor: "#fbfaf6",
                }}
              >
                <span className="text-sm text-[#1a1714]">{notif.label}</span>
                <span className="flex justify-center">
                  <Toggle enabled={notif.push}  onChange={() => toggleNotif(notif.id, "push")} />
                </span>
                <span className="flex justify-center">
                  <Toggle enabled={notif.email} onChange={() => toggleNotif(notif.id, "email")} />
                </span>
                <span className="flex justify-center">
                  <Toggle enabled={notif.inApp} onChange={() => toggleNotif(notif.id, "inApp")} />
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ── API Keys ── */}
        <section className="card flex flex-col gap-4" style={{ padding: "1.25rem" }}>
          <h2
            className="text-[0.65rem] font-semibold uppercase tracking-wider"
            style={{ color: "#948a7b" }}
          >
            API Keys
          </h2>
          <div className="flex flex-col gap-2">
            {keys.map(k => (
              <div
                key={k.id}
                className="rounded-lg px-3 py-3 flex items-center gap-3"
                style={{ backgroundColor: "#fbfaf6", border: "1px solid #e8e2d4" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[#1a1714] mb-0.5">{k.provider}</div>
                  <div className="text-[11px] font-mono truncate" style={{ color: "#948a7b" }}>
                    {visibleKeys[k.id] ? k.key : k.key.replace(/[^•·]/g, "•").slice(0, 32) + "…"}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggleKeyVisibility(k.id)}
                    className="p-1.5 rounded transition-colors"
                    style={{ color: "#948a7b" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    title={visibleKeys[k.id] ? "Hide" : "Show"}
                  >
                    {visibleKeys[k.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button
                    className="p-1.5 rounded transition-colors"
                    style={{ color: "#948a7b" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    title="Rotate"
                  >
                    <RotateCw size={14} />
                  </button>
                  <button
                    className="p-1.5 rounded transition-colors"
                    style={{ color: "#a04848" }}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#f0dcdc")}
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
          <h2
            className="text-[0.65rem] font-semibold uppercase tracking-wider"
            style={{ color: "#948a7b" }}
          >
            App Installation
          </h2>
          <div
            className="rounded-xl p-4 flex items-center gap-4"
            style={{ backgroundColor: "#e3ede9", border: "1px solid rgba(45,90,79,0.15)" }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: "#2d5a4f" }}
            >
              <Smartphone size={22} style={{ color: "#fbfaf6" }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-[#1a1714]">Install TARS as a PWA</div>
              <div className="text-xs text-[#6b6357] mt-0.5">
                Add to your home screen for offline access and push notifications.
              </div>
            </div>
            <button
              className="btn-primary shrink-0"
              style={{ padding: "0.375rem 0.875rem", fontSize: "0.8125rem" }}
            >
              Install
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
