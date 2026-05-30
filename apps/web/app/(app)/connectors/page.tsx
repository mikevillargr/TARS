"use client"

import { useCallback, useEffect, useState } from "react"
import { Plug, X, Plus, Unplug, Users, Loader2 } from "lucide-react"
import { apiGet, apiDelete } from "@/lib/api-client"
import { PendingContactsReview } from "@/components/connectors/PendingContactsReview"
import { useConfirm } from "@/components/ui/confirm-dialog"

// Backend shape — must mirror api/routes/connectors.py::ConnectorOut
interface Connector {
  id: string                     // "gmail" | "gcal" | "google_people" | "fireflies"
  name: string                   // "Gmail" | "Google Calendar" | "Google Contacts" | "Fireflies"
  status: "connected" | "disconnected" | "error"
  capabilities: string[]
  last_synced_at: string | null
  metadata: {
    description?: string
    auth_type?: "oauth2" | "api_key"
  }
}

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

function GoogleContactsLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="6" width="36" height="36" rx="6" fill="#4285F4"/>
      <circle cx="24" cy="20" r="6.5" fill="white"/>
      <path d="M12 38 C12 31 17 27 24 27 C31 27 36 31 36 38 L36 40 C36 41 35 42 34 42 L14 42 C13 42 12 41 12 40 Z" fill="white"/>
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

function ConnectorLogo({ id, name, size = 28 }: { id: string; name: string; size?: number }) {
  if (id === "gmail")         return <GmailLogo size={size} />
  if (id === "gcal")          return <GoogleCalendarLogo size={size} />
  if (id === "google_people") return <GoogleContactsLogo size={size} />
  if (id === "fireflies")     return <FirefliesLogo size={size} />
  return <GenericConnectorLogo name={name} size={size} />
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatSyncedAt(iso: string | null): string {
  if (!iso) return "never"
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ConnectorsPage() {
  const confirm = useConfirm()

  const [connectors,   setConnectors]   = useState<Connector[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [selected,     setSelected]     = useState<Connector | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [reviewOpen,   setReviewOpen]   = useState(false)
  const [busyId,       setBusyId]       = useState<string | null>(null)
  const [justConnected, setJustConnected] = useState<string | null>(null)

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadConnectors = useCallback(async () => {
    try {
      const data = await apiGet<Connector[]>("/connectors")
      setConnectors(data)
      // Keep selected card in sync with refreshed status
      setSelected(prev => prev ? (data.find(c => c.id === prev.id) ?? null) : null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connectors")
    } finally {
      setLoading(false)
    }
  }, [])

  const loadPendingCount = useCallback(async () => {
    try {
      const { count } = await apiGet<{ count: number }>("/contacts/pending/count")
      setPendingCount(count)
    } catch {
      // Silently ignore — endpoint may not be available if connector never connected
      setPendingCount(0)
    }
  }, [])

  useEffect(() => {
    loadConnectors()
    loadPendingCount()
  }, [loadConnectors, loadPendingCount])

  // Show a brief "connected!" toast when redirected back from Google OAuth.
  // Read window.location.search directly (rather than useSearchParams) so the
  // page can be statically prerendered without a Suspense boundary.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const connected = params.get("connected")
    if (connected) {
      setJustConnected(connected)
      const t = setTimeout(() => setJustConnected(null), 4000)
      return () => clearTimeout(t)
    }
  }, [])

  // ── Actions ────────────────────────────────────────────────────────────────
  function startConnect(c: Connector) {
    // Direct to harness — bypasses the Next.js proxy since OAuth redirects don't
    // need auth token injection. Nginx routes /api/ straight to port 8000.
    // After consent, Google redirects to /api/connectors/oauth/callback/{id}
    // which lands the user back at /connectors?connected={id}.
    window.location.href = `/api/connectors/oauth/authorize/${c.id}`
  }

  async function disconnect(c: Connector) {
    const ok = await confirm({
      title: `Disconnect ${c.name}?`,
      description: "TARS will lose access until you reconnect. Local data already synced is kept.",
      confirmLabel: "Disconnect",
      tone: "danger",
    })
    if (!ok) return
    setBusyId(c.id)
    try {
      await apiDelete(`/connectors/oauth/${c.id}`)
      await loadConnectors()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed")
    } finally {
      setBusyId(null)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
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

        {/* "Just connected" banner */}
        {justConnected && (
          <div
            className="mx-5 mt-4 px-3 py-2 rounded-md text-sm flex items-center gap-2"
            style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}
          >
            <Plug size={14} /> Connected successfully.
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div
            className="mx-5 mt-4 px-3 py-2 rounded-md text-sm flex items-center justify-between gap-2"
            style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}
          >
            <span>{error}</span>
            <button onClick={() => setError(null)}><X size={13} /></button>
          </div>
        )}

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--c-ink-faint)" }} />
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-5xl">
              {connectors.map(c => {
                const isPeople = c.id === "google_people"
                const showPendingBadge = isPeople && c.status === "connected" && pendingCount > 0
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelected(prev => prev?.id === c.id ? null : c)}
                    className="card text-left hover:shadow-md transition-shadow cursor-pointer flex flex-col gap-3 relative"
                    style={{
                      padding: "1rem",
                      minHeight: "9rem",
                      outline: selected?.id === c.id ? `2px solid var(--c-moss)` : "none",
                      outlineOffset: "1px",
                    }}
                  >
                    {/* Logo + status row */}
                    <div className="flex items-start justify-between">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
                        style={{ backgroundColor: "var(--c-surface-2)" }}
                      >
                        <ConnectorLogo id={c.id} name={c.name} size={28} />
                      </div>
                      <span
                        className="w-2.5 h-2.5 rounded-full mt-1"
                        style={{ backgroundColor: c.status === "connected" ? "var(--c-moss)" : "var(--c-border)" }}
                      />
                    </div>

                    {/* Name + status */}
                    <div>
                      <div className="text-sm font-semibold flex items-center gap-1.5 flex-wrap" style={{ color: "var(--c-ink)" }}>
                        {c.name}
                        {showPendingBadge && (
                          <span
                            onClick={(e) => { e.stopPropagation(); setReviewOpen(true) }}
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold cursor-pointer"
                            style={{ backgroundColor: "var(--c-amber-soft)", color: "var(--c-amber)" }}
                            title="Pending contacts awaiting review"
                          >
                            <Users size={10} /> {pendingCount} pending
                          </span>
                        )}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "var(--c-ink-faint)" }}>
                        {c.status === "connected"
                          ? `Synced ${formatSyncedAt(c.last_synced_at)}`
                          : "Not connected"}
                      </div>
                    </div>

                    {/* Capability pills */}
                    <div className="flex flex-wrap gap-1">
                      {c.capabilities.slice(0, 3).map(cap => (
                        <span key={cap} className="badge badge-neutral" style={{ fontSize: "0.6rem" }}>
                          {cap}
                        </span>
                      ))}
                      {c.capabilities.length > 3 && (
                        <span className="badge badge-neutral" style={{ fontSize: "0.6rem" }}>
                          +{c.capabilities.length - 3}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}

              {/* Add connector card (decorative — future expansion) */}
              <div
                className="flex flex-col items-center justify-center gap-2 rounded-xl"
                style={{
                  minHeight: "9rem",
                  border: "2px dashed var(--c-border)",
                  backgroundColor: "transparent",
                  color: "var(--c-ink-faint)",
                }}
                title="More connectors coming soon"
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: "var(--c-surface-2)" }}
                >
                  <Plus size={20} style={{ color: "var(--c-ink-faint)" }} />
                </div>
                <span className="text-xs font-medium">More coming soon</span>
              </div>
            </div>
          )}
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
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center overflow-hidden shrink-0"
                style={{ backgroundColor: "var(--c-surface-2)" }}
              >
                <ConnectorLogo id={selected.id} name={selected.name} size={22} />
              </div>
              <span className="text-sm font-semibold truncate" style={{ color: "var(--c-ink)" }}>{selected.name}</span>
              {selected.status === "connected"
                ? <span className="badge badge-moss shrink-0" style={{ fontSize: "0.65rem" }}>Connected</span>
                : <span className="badge badge-neutral shrink-0" style={{ fontSize: "0.65rem" }}>Disconnected</span>
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
            {selected.metadata.description && (
              <p className="text-xs leading-relaxed" style={{ color: "var(--c-ink-muted)" }}>
                {selected.metadata.description}
              </p>
            )}

            {selected.status === "connected" ? (
              <>
                <div>
                  <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--c-ink-faint)" }}>
                    Sync Status
                  </div>
                  <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: "var(--c-moss-soft)", color: "var(--c-moss)" }}>
                    Last synced {formatSyncedAt(selected.last_synced_at)}
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

                {selected.id === "google_people" && (
                  <div>
                    <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>
                      Pending review
                    </div>
                    <button
                      onClick={() => setReviewOpen(true)}
                      className="w-full flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors"
                      style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink)" }}
                    >
                      <span className="flex items-center gap-2">
                        <Users size={14} style={{ color: "var(--c-moss)" }} /> Review pending
                      </span>
                      <span
                        className="text-xs font-semibold rounded-full px-2 py-0.5"
                        style={{
                          backgroundColor: pendingCount > 0 ? "var(--c-amber-soft)" : "var(--c-canvas)",
                          color: pendingCount > 0 ? "var(--c-amber)" : "var(--c-ink-faint)",
                        }}
                      >
                        {pendingCount}
                      </span>
                    </button>
                  </div>
                )}

                {/* OAuth connectors get a Disconnect button. Fireflies (api_key) does not. */}
                {selected.metadata.auth_type === "oauth2" && (
                  <div className="pt-1">
                    <button
                      onClick={() => disconnect(selected)}
                      disabled={busyId === selected.id}
                      className="flex items-center gap-1.5 w-full justify-center rounded-md py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                      style={{ backgroundColor: "var(--c-rose-soft)", color: "var(--c-rose)" }}
                    >
                      {busyId === selected.id ? <Loader2 size={12} className="animate-spin" /> : <Unplug size={12} />}
                      Disconnect
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 pt-4">
                <div className="w-16 h-16 rounded-xl flex items-center justify-center overflow-hidden"
                  style={{ backgroundColor: "var(--c-surface-2)" }}>
                  <ConnectorLogo id={selected.id} name={selected.name} size={40} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium mb-1" style={{ color: "var(--c-ink)" }}>{selected.name} is not connected</p>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--c-ink-faint)" }}>
                    Connect your account to enable {selected.capabilities.join(", ").toLowerCase()}.
                  </p>
                </div>
                {selected.metadata.auth_type === "oauth2" ? (
                  <button
                    onClick={() => startConnect(selected)}
                    className="btn-primary w-full justify-center"
                    style={{ padding: "0.5rem 1rem" }}
                  >
                    <Plus size={14} /> Connect Account
                  </button>
                ) : (
                  <p className="text-xs text-center" style={{ color: "var(--c-ink-faint)" }}>
                    Configure this connector via environment variables.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pending contacts review modal */}
      <PendingContactsReview
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        onChange={loadPendingCount}
      />
    </div>
  )
}
