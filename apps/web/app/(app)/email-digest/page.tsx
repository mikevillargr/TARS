"use client"

import { useState } from "react"
import { Mail, Play, ChevronRight, X, Plus, Inbox } from "lucide-react"
import { MOCK_EMAIL_DIGESTS } from "@/lib/mock-ui-data"

type Digest = typeof MOCK_EMAIL_DIGESTS[number]

function formatDigestDate(iso: string) {
  const d = new Date(iso)
  const today    = new Date("2026-05-26")
  const yesterday = new Date("2026-05-25")
  if (d.toDateString() === today.toDateString())     return "Today"
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday"
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

export default function EmailDigestPage() {
  const [selected, setSelected] = useState<Digest | null>(MOCK_EMAIL_DIGESTS[0])

  return (
    <div className="flex flex-1 overflow-hidden" style={{ backgroundColor: "var(--c-canvas)" }}>
      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-start justify-between shrink-0"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: "var(--c-surface-2)" }}
            >
              <Mail size={17} style={{ color: "var(--c-ink-muted)" }} />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight" style={{ fontFamily: "var(--font-heading), serif", color: "var(--c-ink)" }}>
                Email Digest
              </h1>
              <p className="text-xs" style={{ color: "var(--c-ink-faint)" }}>Daily summaries of your inbox, curated by TARS.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-[0.6rem] uppercase tracking-wider font-semibold" style={{ color: "var(--c-ink-faint)" }}>Next digest in</div>
              <div className="text-sm font-semibold tabular-nums" style={{ color: "var(--c-ink)" }}>04:12:30</div>
            </div>
            <button className="btn-secondary" style={{ padding: "0.35rem 0.75rem", fontSize: "0.8125rem" }}>
              <Play size={13} /> Run Now
            </button>
          </div>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="relative max-w-2xl">
            {/* Vertical line */}
            <div
              className="absolute left-[7px] top-4 bottom-4 w-px"
              style={{ backgroundColor: "var(--c-border)" }}
            />

            <div className="flex flex-col gap-5">
              {MOCK_EMAIL_DIGESTS.map((digest, i) => (
                <div key={digest.id} className="flex items-start gap-4">
                  {/* Timeline dot */}
                  <div
                    className="w-3.5 h-3.5 rounded-full border-2 shrink-0 mt-2 z-10"
                    style={{
                      backgroundColor: i === 0 ? "var(--c-moss)" : "var(--c-surface)",
                      borderColor: i === 0 ? "var(--c-moss)" : "var(--c-border)",
                    }}
                  />

                  {/* Card */}
                  <button
                    onClick={() => setSelected(prev => prev?.id === digest.id ? null : digest)}
                    className="card flex-1 text-left hover:shadow-md transition-shadow cursor-pointer"
                    style={{
                      padding: "0.875rem 1rem",
                      outline: selected?.id === digest.id ? "2px solid var(--c-moss)" : "none",
                      outlineOffset: "1px",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
                            {formatDigestDate(digest.date)}
                          </span>
                          <span className="badge badge-neutral" style={{ fontSize: "0.65rem" }}>
                            {digest.threadCount} threads
                          </span>
                          {digest.actionItems > 0 && (
                            <span className="badge badge-amber" style={{ fontSize: "0.65rem" }}>
                              {digest.actionItems} actions
                            </span>
                          )}
                        </div>
                        <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--c-ink-muted)" }}>
                          {digest.summary}
                        </p>
                      </div>
                      <ChevronRight size={15} style={{ color: "var(--c-ink-faint)", flexShrink: 0, marginTop: 2 }} />
                    </div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      {selected && (
        <div
          className="w-[340px] border-l flex flex-col shrink-0"
          style={{ borderColor: "var(--c-border)", backgroundColor: "var(--c-surface)" }}
        >
          <div
            className="px-4 py-3 border-b flex items-center justify-between shrink-0"
            style={{ borderColor: "var(--c-border)" }}
          >
            <span className="text-sm font-semibold" style={{ color: "var(--c-ink)" }}>
              {formatDigestDate(selected.date)}
            </span>
            <button
              onClick={() => setSelected(null)}
              className="p-1 rounded-md transition-colors"
              style={{ color: "var(--c-ink-muted)" }}
              onMouseEnter={e => (e.currentTarget.style.backgroundColor = "var(--c-surface-2)")}
              onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <X size={15} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
            {/* Summary */}
            <div>
              <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>Summary</div>
              <div
                className="rounded-lg p-3 text-xs leading-relaxed"
                style={{ backgroundColor: "var(--c-surface-2)", color: "var(--c-ink)" }}
              >
                {selected.summary}
              </div>
            </div>

            {/* Action items */}
            {selected.actions.length > 0 && (
              <div>
                <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>
                  Extracted Actions
                </div>
                <div className="flex flex-col gap-2">
                  {selected.actions.map(action => (
                    <div
                      key={action.id}
                      className="rounded-lg p-2.5 flex items-start justify-between gap-2"
                      style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}
                    >
                      <p className="text-xs leading-snug flex-1" style={{ color: "var(--c-ink)" }}>{action.text}</p>
                      <button
                        className="flex items-center gap-1 text-[11px] font-medium shrink-0 transition-colors"
                        style={{ color: "var(--c-moss)" }}
                      >
                        <Plus size={11} />
                        Task
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Key threads */}
            {selected.keyThreads.length > 0 && (
              <div>
                <div className="text-[0.6rem] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--c-ink-faint)" }}>
                  Key Threads
                </div>
                <div className="flex flex-col gap-2">
                  {selected.keyThreads.map(thread => (
                    <div
                      key={thread.id}
                      className="rounded-lg p-3"
                      style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium" style={{ color: "var(--c-ink)" }}>{thread.from}</span>
                        <span className="text-[11px]" style={{ color: "var(--c-ink-faint)" }}>{thread.time}</span>
                      </div>
                      <p className="text-[11px] font-medium mb-0.5" style={{ color: "var(--c-moss)" }}>{thread.subject}</p>
                      <p className="text-[11px] leading-snug" style={{ color: "var(--c-ink-muted)" }}>{thread.preview}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Meta */}
            <div className="flex items-center gap-2 pt-2 flex-wrap">
              <span className="badge badge-neutral">{selected.threadCount} threads</span>
              <span className="badge badge-neutral">{selected.actionItems} actions</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
