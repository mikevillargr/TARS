"use client"

import { useState } from "react"
import { Plug, X, Plus, RefreshCw, Unplug } from "lucide-react"
import { MOCK_CONNECTORS } from "@/lib/mock-ui-data"

type Connector = typeof MOCK_CONNECTORS[number]

const CONNECTOR_ICONS: Record<string, string> = {
  Gmail:            "G",
  "Google Calendar": "📅",
  Fireflies:        "🔥",
  Linear:           "L",
}

export default function ConnectorsPage() {
  const [selected, setSelected] = useState<Connector | null>(null)

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: "#f6f3ec" }}>
      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: "#efeadf" }}
            >
              <Plug size={17} style={{ color: "#6b6357" }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-[#1a1714] leading-tight" style={{ fontFamily: "var(--font-heading), serif" }}>
                Connectors
              </h1>
              <p className="text-xs text-[#948a7b]">External services wired into TARS.</p>
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
                  outline: selected?.id === connector.id ? "2px solid #2d5a4f" : "none",
                  outlineOffset: "1px",
                }}
              >
                {/* Icon + status row */}
                <div className="flex items-start justify-between">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-base font-bold shrink-0"
                    style={{ backgroundColor: "#efeadf", color: "#2d5a4f" }}
                  >
                    {CONNECTOR_ICONS[connector.name] ?? <Plug size={18} />}
                  </div>
                  <span
                    className="w-2.5 h-2.5 rounded-full mt-1"
                    style={{ backgroundColor: connector.status === "Connected" ? "#2d5a4f" : "#d8d2c4" }}
                  />
                </div>

                {/* Name + status */}
                <div>
                  <div className="text-sm font-semibold text-[#1a1714]">{connector.name}</div>
                  <div className="text-xs text-[#948a7b] mt-0.5">
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
                border: "2px dashed #d8d2c4",
                backgroundColor: "transparent",
                color: "#948a7b",
              }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: "#efeadf" }}
              >
                <Plus size={20} style={{ color: "#948a7b" }} />
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
          style={{ borderColor: "#d8d2c4", backgroundColor: "#fbfaf6" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "#d8d2c4" }}
          >
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold"
                style={{ backgroundColor: "#efeadf", color: "#2d5a4f" }}
              >
                {CONNECTOR_ICONS[selected.name] ?? "?"}
              </div>
              <span className="text-sm font-semibold text-[#1a1714]">{selected.name}</span>
              {selected.status === "Connected"
                ? <span className="badge badge-moss" style={{ fontSize: "0.65rem" }}>Connected</span>
                : <span className="badge badge-neutral" style={{ fontSize: "0.65rem" }}>Disconnected</span>
              }
            </div>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md transition-colors shrink-0"
              style={{ color: "#6b6357" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {selected.status === "Connected" ? (
              <>
                {/* Sync info */}
                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-1.5">
                    Sync Status
                  </div>
                  <div
                    className="rounded-lg p-3 text-xs"
                    style={{ backgroundColor: "#e3ede9", color: "#2d5a4f" }}
                  >
                    Last synced {selected.lastSynced}
                  </div>
                </div>

                {/* Capabilities */}
                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-2">
                    Capabilities
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {selected.capabilities.map(cap => (
                      <div
                        key={cap}
                        className="flex items-center gap-2 text-xs text-[#1a1714]"
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: "#2d5a4f" }}
                        />
                        {cap}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Webhook log */}
                {selected.recentWebhooks.length > 0 && (
                  <div>
                    <div className="text-[0.6rem] font-semibold uppercase tracking-wider text-[#948a7b] mb-2">
                      Recent Webhooks
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {selected.recentWebhooks.map((wh, i) => (
                        <div
                          key={i}
                          className="rounded-lg px-3 py-2 flex items-center justify-between"
                          style={{ backgroundColor: "#efeadf" }}
                        >
                          <span className="text-[11px] font-mono text-[#6b6357] truncate">{wh.path}</span>
                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <span
                              className="text-[10px] font-semibold"
                              style={{ color: wh.status === 200 ? "#2d5a4f" : "#a04848" }}
                            >
                              {wh.status}
                            </span>
                            <span className="text-[10px] text-[#948a7b]">{wh.time}</span>
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
                    style={{ backgroundColor: "#f0dcdc", color: "#a04848" }}
                  >
                    <Unplug size={12} /> Disconnect
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 pt-4">
                <div
                  className="w-14 h-14 rounded-xl flex items-center justify-center text-xl"
                  style={{ backgroundColor: "#efeadf" }}
                >
                  {CONNECTOR_ICONS[selected.name] ?? <Plug size={24} />}
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[#1a1714] mb-1">{selected.name} is not connected</p>
                  <p className="text-xs text-[#948a7b] leading-relaxed">
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
