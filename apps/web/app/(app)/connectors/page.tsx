"use client"

import { useState } from "react"
import { Plug, X, Plus, RefreshCw, Unplug } from "lucide-react"
import { MOCK_CONNECTORS } from "@/lib/mock-ui-data"

type Connector = typeof MOCK_CONNECTORS[number]

// ─── Official service logos as inline SVGs ─────────────────────────────────────

function GmailLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <path fill="#EA4335" d="M6 40h6V22L4 16v20a2 2 0 002 2z"/>
      <path fill="#34A853" d="M36 40h6a2 2 0 002-2V16l-8 6z"/>
      <path fill="#4285F4" d="M36 8v14l8-6V10a3 3 0 00-4.8-2.4L36 8z"/>
      <path fill="#FBBC04" d="M12 22V8l12 9 12-9v14L24 31z"/>
      <path fill="#C5221F" d="M4 10v6l8 6V8l-3.2-2.4A3 3 0 004 10z"/>
    </svg>
  )
}

function GoogleCalendarLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="6" width="36" height="36" rx="4" fill="white"/>
      <rect x="6" y="6" width="36" height="36" rx="4" fill="none" stroke="#E8EAED" strokeWidth="1"/>
      <rect x="6" y="6" width="36" height="10" rx="4" fill="#4285F4"/>
      <rect x="6" y="12" width="36" height="4" fill="#4285F4"/>
      <text x="24" y="34" textAnchor="middle" fontFamily="sans-serif" fontWeight="bold" fontSize="16" fill="#4285F4">
        {new Date().getDate()}
      </text>
      <line x1="16" y1="20" x2="32" y2="20" stroke="#E8EAED" strokeWidth="1"/>
      <line x1="16" y1="26" x2="32" y2="26" stroke="#E8EAED" strokeWidth="1"/>
    </svg>
  )
}

function FirefliesLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="#8B5CF6"/>
      <path d="M24 10 C18 16 14 20 16 26 C18 30 22 30 24 28 C26 30 30 30 32 26 C34 20 30 16 24 10Z" fill="white" opacity="0.9"/>
      <circle cx="20" cy="24" r="2" fill="#8B5CF6"/>
      <circle cx="28" cy="24" r="2" fill="#8B5CF6"/>
      <path d="M20 30 Q24 34 28 30" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    </svg>
  )
}

function LinearLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="#5E6AD2"/>
      <path d="M12 30L18 12L36 18L30 36L12 30Z" fill="white" opacity="0.9"/>
      <circle cx="24" cy="24" r="3" fill="#5E6AD2"/>
    </svg>
  )
}

function GenericConnectorLogo({ name, size = 28 }: { name: string; size?: number }) {
  const initial = name[0]?.toUpperCase() ?? "?"
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="#efeadf"/>
      <text x="24" y="30" textAnchor="middle" fontFamily="sans-serif" fontWeight="700" fontSize="20" fill="#2d5a4f">
        {initial}
      </text>
    </svg>
  )
}

function ConnectorLogo({ name, size = 28 }: { name: string; size?: number }) {
  if (name === "Gmail") return <GmailLogo size={size} />
  if (name === "Google Calendar") return <GoogleCalendarLogo size={size} />
  if (name === "Fireflies") return <FirefliesLogo size={size} />
  if (name === "Linear") return <LinearLogo size={size} />
  return <GenericConnectorLogo name={name} size={size} />
}

export default function ConnectorsPage() {
  const [selected, setSelected] = useState<Connector | null>(null)

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: "var(--c-canvas)" }}>
      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: "var(--c-surface-2)" }}
            >
              <Plug size={17} style={{ color: "var(--c-ink-muted)" }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>
                Connectors
              </h1>
              <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>External services wired into TARS.</p>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-5xl">
            {MOCK_CONNECTORS.map(connector => (
              <button
                key={connector.id}
                onClick={() => setSelected(prev => prev?.id === connector.id ? null : connector)}
                className="card text-left hover:shadow-md transition-shadow cursor-pointer flex flex-col gap-3"
                style={{
                  padding: "1rem",
                  minHeight: "9rem",
                  outline: selected?.id === connector.id ? `2px solid var(--c-moss)` : "none",
                  outlineOffset: "1px",
                }}
              >
                {/* Logo + status row */}
                <div className="flex items-start justify-between">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
                    style={{ backgroundColor: "var(--c-surface-2)" }}>
                    <ConnectorLogo name={connector.name} size={28} />
                  </div>
                  <span
                    className="w-2.5 h-2.5 rounded-full mt-1"
                    style={{ backgroundColor: connector.status === "Connected" ? "var(--c-moss)" : "var(--c-border)" }}
                  />
                </div>

                {/* Name + status */}
                <div>
                  <div className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>{connector.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>
                    {connector.status === "Connected"
                      ? `Synced ${connector.lastSynced}`
                      : "Not connected"}
                  </div>
                </div>

                {/* Capability pills */}
                <div className="flex flex-wrap gap-1">
                  {connector.capabilities.slice(0, 3).map(cap => (
                    <span key={cap} className="badge badge-neutral" style={{ fontSize: "0.6rem" }}>
                      {cap}
                    </span>
                  ))}
                  {connector.capabilities.length > 3 && (
                    <span className="badge badge-neutral" style={{ fontSize: "0.6rem" }}>
                      +{connector.capabilities.length - 3}
                    </span>
                  )}
                </div>
              </button>
            ))}

            {/* Add connector card */}
            <button
              className="flex flex-col items-center justify-center gap-2 rounded-xl transition-colors cursor-pointer"
              style={{
                minHeight: "9rem",
                border: "2px dashed var(--c-border)",
                backgroundColor: "transparent",
                color: "var(--c-ink-faint)",
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: "var(--c-surface-2)" }}
              >
                <Plus size={20} style={{ color: "var(--c-ink-faint)" }} />
              </div>
              <span className="text-xs font-medium">Add Connector</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      {selected && (
        <div
          className="w-[320px] border-l flex flex-col shrink-0"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "var(--c-border)" }}
          >
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden"
                style={{ backgroundColor: "var(--c-surface-2)" }}>
                <ConnectorLogo name={selected.name} size={22} />
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>{selected.name}</span>
              {selected.status === "Connected"
                ? <span className="badge badge-moss" style={{ fontSize: "0.65rem" }}>Connected</span>
                : <span className="badge badge-neutral" style={{ fontSize: "0.65rem" }}>Disconnected</span>
              }
            </div>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md transition-colors shrink-0"
              style={{ color: "var(--c-ink-muted)" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {selected.status === "Connected" ? (
              <>
                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>
                    Sync Status
                  </div>
                  <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}>
                    Last synced {selected.lastSynced}
                  </div>
                </div>

                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>
                    Capabilities
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {selected.capabilities.map(cap => (
                      <div key={cap} className="flex items-center gap-2 text-xs" style={{ color: "var(--c-ink)" }}>
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: "var(--c-moss)" }} />
                        {cap}
                      </div>
                    ))}
                  </div>
                </div>

                {selected.recentWebhooks.length > 0 && (
                  <div>
                    <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>
                      Recent Webhooks
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {selected.recentWebhooks.map((wh, i) => (
                        <div
                          key={i}
                          className="rounded-lg px-3 py-2 flex items-center justify-between"
                          style={{ backgroundColor: "var(--c-surface-2)" }}
                        >
                          <span className="text-[11px] font-mono truncate" style={{ color: "var(--c-ink-muted)" }}>{wh.path}</span>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <span className="text-[10px] font-semibold" style={{ color: wh.status === 200 ? "var(--c-moss)" : "var(--c-rose)" }}>
                              {wh.status}
                            </span>
                            <span className="text-[10px]" style={{ color: "var(--c-ink-faint)" }}>{wh.time}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <button className="btn-secondary flex-1 justify-center" style={{ padding: "0.4rem 0.5rem", fontSize: "0.8rem" }}>
                    <RefreshCw size={12} /> Force Sync
                  </button>
                  <button
                    className="flex items-center gap-1.5 flex-1 justify-center rounded-md py-1.5 text-xs font-medium transition-colors"
                    style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}
                  >
                    <Unplug size={12} /> Disconnect
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 pt-4">
                <div className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden"
                  style={{ backgroundColor: "var(--c-surface-2)" }}>
                  <ConnectorLogo name={selected.name} size={40} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--c-ink)" }}>{selected.name} is not connected</p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--c-ink-faint)" }}>
                    Connect your account to enable {selected.capabilities.join(", ").toLowerCase()}.
                  </p>
                </div>
                <button className="btn-primary w-full justify-center" style={{ padding: "0.5rem 1rem" }}>
                  <Plus size={14} /> Connect Account
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
