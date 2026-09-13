"use client"

import { useEffect, useRef } from "react"
import type { FeedRow } from "@/hooks/useBrowserJob"

interface Props {
  rows: FeedRow[]
  stacked?: boolean // mobile: verb above, target below, instead of one line
  onHoverRow?: (row: FeedRow | null) => void
}

/**
 * What this row is about, in the page's own words where possible.
 *
 * Deliberately never falls back to the current page URL: that is already shown
 * once above the viewport, and repeating it on every row produces three
 * consecutive lines that say the same thing and tell you nothing about the
 * action. Better to show nothing than to pad the column.
 */
function targetOf(row: FeedRow): { text: string; voice: "page" | "machine" } | null {
  if (row.label) return { text: row.label, voice: "page" }
  const input = (row.input ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

  switch (row.name) {
    case "navigate": {
      const url = str(input.url)
      return url ? { text: url.replace(/^https?:\/\//, ""), voice: "machine" } : null
    }
    case "find": {
      const q = str(input.query)
      return q ? { text: q, voice: "page" } : null
    }
    case "type": {
      const t = str(input.text)
      return t ? { text: `"${t}"`, voice: "page" } : null
    }
    case "key": {
      const t = str(input.text)
      return t ? { text: t.toUpperCase(), voice: "machine" } : null
    }
    case "form_input": {
      const v = input.value
      return v != null ? { text: `"${String(v)}"`, voice: "page" } : null
    }
    case "scroll":
      return str(input.scroll_direction)
        ? { text: String(input.scroll_direction).toUpperCase(), voice: "machine" }
        : null
    case "wait":
      return input.duration != null
        ? { text: `${input.duration}S`, voice: "machine" }
        : null
    default:
      return null
  }
}

function clockOf(at: number) {
  return new Date(at * 1000).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/**
 * The run, as a log.
 *
 * One rule governs every row: MONO IS TARS TALKING, INTER IS THE PAGE TALKING.
 * Timestamps, verbs, refs and counts are the instrument layer. The only Inter
 * on this surface is text that came off the page itself — an element's own
 * label, a heading, the final answer. Two voices, one line.
 */
export function ActionFeed({ rows, stacked = false, onHoverRow }: Props) {
  const endRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  useEffect(() => {
    if (rows.length > lastCount.current) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
    }
    lastCount.current = rows.length
  }, [rows.length])

  return (
    <div className="flex flex-col">
      {rows.map((row, i) => {
        const isLast = i === rows.length - 1

        if (row.kind === "escalated") {
          // A chapter break, not a log line: the run changed driver mid-story.
          return (
            <div key={i} className="flex items-center gap-2 py-2.5">
              <div className="h-px flex-1" style={{ background: "var(--c-border-faint)" }} />
              <span className="tars-label" style={{ color: "var(--c-amber)" }}>
                ESCALATED · {row.model?.replace("claude-", "").replace(/-/g, " ").toUpperCase()}
              </span>
              <div className="h-px flex-1" style={{ background: "var(--c-border-faint)" }} />
            </div>
          )
        }

        if (row.kind === "paused" || row.kind === "resumed") {
          return (
            <div key={i} className="flex items-center gap-2 py-2">
              <div className="h-px flex-1" style={{ background: "var(--c-border-faint)" }} />
              <span className="tars-label tars-label--muted">
                {row.kind === "paused" ? "HELD" : "RESUMED"}
              </span>
              <div className="h-px flex-1" style={{ background: "var(--c-border-faint)" }} />
            </div>
          )
        }

        if (row.kind === "say") {
          // The agent's own words: prose, so Inter.
          return (
            <p
              key={i}
              className="py-1.5 text-[13px] leading-relaxed"
              style={{ color: "var(--c-ink-muted)" }}
            >
              {row.text}
            </p>
          )
        }

        if (row.kind === "error") {
          return (
            <div key={i} className="flex gap-2 py-1" style={{ borderRadius: 2 }}>
              <span className="tars-label shrink-0" style={{ color: "var(--c-rose)" }}>
                ✗
              </span>
              <span className="text-[12px] leading-snug" style={{ color: "var(--c-rose)" }}>
                {row.detail}
              </span>
            </div>
          )
        }

        const verb = (
          <span
            className="tars-label shrink-0"
            style={{ color: isLast ? "var(--c-moss)" : "var(--c-ink-muted)" }}
          >
            {row.name?.toUpperCase()}
          </span>
        )
        const t = targetOf(row)
        const target = t ? (
          t.voice === "page" ? (
            // The page's own words: Inter.
            <span className="truncate text-[12.5px]" style={{ color: "var(--c-ink)" }}>
              {t.text}
            </span>
          ) : (
            // A machine value (a URL, a keystroke): stays in the mono layer.
            <span className="tars-label tars-label--muted truncate">{t.text}</span>
          )
        ) : null

        return (
          <div
            key={i}
            onMouseEnter={() => onHoverRow?.(row)}
            onMouseLeave={() => onHoverRow?.(null)}
            className={`py-1 ${onHoverRow ? "cursor-default" : ""}`}
            style={{
              borderRadius: 2,
              background: isLast
                ? "color-mix(in srgb, var(--c-moss) 7%, transparent)"
                : "transparent",
            }}
          >
            {stacked ? (
              <div className="flex flex-col gap-0.5 px-1">
                <div className="flex items-center gap-2">
                  <span className="tars-label tars-label--muted shrink-0" style={{ fontSize: 9 }}>
                    {clockOf(row.at)}
                  </span>
                  {verb}
                </div>
                {target && <div className="flex pl-[46px]">{target}</div>}
              </div>
            ) : (
              <div className="flex items-baseline gap-2.5 px-1">
                <span className="tars-label tars-label--muted shrink-0" style={{ fontSize: 10 }}>
                  {clockOf(row.at)}
                </span>
                <span className="w-[108px] shrink-0">{verb}</span>
                {target}
              </div>
            )}
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
