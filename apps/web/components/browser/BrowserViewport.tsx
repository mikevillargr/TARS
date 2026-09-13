"use client"

import type { FeedRow } from "@/hooks/useBrowserJob"

interface Props {
  frame: { jpeg: string; width: number; height: number } | null
  active: FeedRow | null
  showHighlight?: boolean
  url?: string
}

/**
 * The live page, with a box drawn on the element the agent is about to touch.
 *
 * The highlight is the whole point of this surface. Because targeting is by
 * ref rather than pixel, the executor resolves the element and reads its box
 * BEFORE acting, so this shows intent rather than history. A coordinate-based
 * agent has nothing to draw.
 *
 * Box coordinates arrive in page CSS pixels and are converted to percentages
 * of the frame, so the overlay stays correct at any rendered size.
 */
export function BrowserViewport({ frame, active, showHighlight = true, url }: Props) {
  const box = showHighlight ? active?.box : undefined
  const pct = box &&
    frame && {
      left: `${(box.x / frame.width) * 100}%`,
      top: `${(box.y / frame.height) * 100}%`,
      width: `${(box.width / frame.width) * 100}%`,
      height: `${(box.height / frame.height) * 100}%`,
    }

  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="relative overflow-hidden bg-[var(--c-surface-2)]"
        style={{ borderRadius: 2, border: "1px solid var(--c-border-faint)", aspectRatio: "16 / 10" }}
      >
        {frame ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={`data:image/jpeg;base64,${frame.jpeg}`}
            alt=""
            className="h-full w-full object-contain"
            draggable={false}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="tars-label tars-label--muted">CONNECTING…</span>
          </div>
        )}

        {pct && (
          <div
            className="pointer-events-none absolute transition-all duration-150 ease-out"
            style={{
              ...pct,
              borderRadius: 2,
              border: "1.5px solid var(--c-moss)",
              boxShadow: "0 0 0 1px color-mix(in srgb, var(--c-moss) 25%, transparent)",
            }}
          >
            {active?.label && (
              <span
                className="tars-label absolute whitespace-nowrap px-1 py-0.5"
                style={{
                  bottom: "calc(100% + 3px)",
                  left: 0,
                  background: "var(--c-moss)",
                  color: "var(--c-canvas)",
                  borderRadius: 2,
                  fontSize: 9,
                }}
              >
                {active.label}
              </span>
            )}
          </div>
        )}
      </div>

      {url && (
        <div className="flex items-center justify-between gap-2 px-0.5">
          <span className="tars-label tars-label--muted truncate" title={url}>
            {url.replace(/^https?:\/\//, "")}
          </span>
        </div>
      )}
    </div>
  )
}
