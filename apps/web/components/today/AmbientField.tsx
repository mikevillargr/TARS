"use client"

import { useMemo } from "react"
import { useClockBucket } from "@/hooks/useClock"

/**
 * AmbientField — the /today backdrop.
 *
 * This is not decoration. It is a readout: the field encodes time of day and
 * current load, so glancing at the screen tells you something before you read
 * a single word.
 *
 *   · Time of day — the moss glow tracks a sun arc. Low-left at dawn, high at
 *     midday, low-right at dusk, dim and settled overnight.
 *   · Load        — unactioned signal count drives intensity and grain. A heavy
 *     morning looks heavier.
 *   · All clear   — collapses to a calm floor plus the existing boot glow, so
 *     inbox zero physically quiets the room.
 *   · Daily seed  — the date jitters composition and grain, so no two mornings
 *     render identically.
 *
 * Everything is built from --c-* tokens via color-mix, so light/dark inherit
 * automatically, same as the .tars-ambient primitive it extends.
 *
 * Scope: /today only. The rest of the app keeps .tars-ambient untouched.
 */

// ─── Tuning constants — every magic number lives here ────────────────────────

const MOSS_ALPHA_BASE = 14      // % at night / floor
const MOSS_ALPHA_SUN = 22       // % added at solar peak
const MOSS_ALPHA_PER_SIGNAL = 2 // % added per open signal
const MOSS_ALPHA_MAX = 46

const AMBER_ALPHA_BASE = 6      // % ambient floor
const AMBER_ALPHA_GOLDEN = 26   // % added at golden hour (dawn/dusk)

const CALM_ALPHA = 10           // % both layers collapse to on ALL CLEAR

const GRAIN_OPACITY = 0.05
const GRAIN_OPACITY_LOADED = 0.085

const DAWN = 0.25               // 06:00 as fraction of day
const DUSK = 0.79               // ~19:00

// ─── Field maths ─────────────────────────────────────────────────────────────

export interface FieldState {
  /** Count of open (unactioned) signals — drives intensity. */
  load: number
  /** True when nothing is left to action. */
  allClear: boolean
}

interface FieldGeometry {
  mossX: number
  mossY: number
  mossAlpha: number
  amberX: number
  amberY: number
  amberAlpha: number
  grain: number
  seed: number
}

/** Deterministic 0..1 from a day-stamp, so a given date always renders alike. */
function dailySeed(now: Date): number {
  const stamp = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate()
  // xorshift-ish scramble, kept tiny and dependency-free
  let x = stamp
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return Math.abs(x % 1000) / 1000
}

function computeGeometry(now: Date, state: FieldState): FieldGeometry {
  const t = (now.getHours() + now.getMinutes() / 60) / 24
  const seed = dailySeed(now)

  // Sun altitude: 0 at dawn, 1 at solar noon, 0 at dusk, 0 overnight.
  const daySpan = DUSK - DAWN
  const altitude =
    t >= DAWN && t <= DUSK ? Math.sin(((t - DAWN) / daySpan) * Math.PI) : 0

  // Horizontal travel across the day; parked left-of-centre overnight.
  const progress = t >= DAWN && t <= DUSK ? (t - DAWN) / daySpan : 0.18
  const jitter = (seed - 0.5) * 12 // ±6% daily variation

  // Golden hour — strongest when the sun is up but low.
  const golden = altitude > 0 ? Math.pow(1 - altitude, 2) : 0.25

  const loadBoost = Math.min(state.load, 8) * MOSS_ALPHA_PER_SIGNAL

  const mossAlpha = state.allClear
    ? CALM_ALPHA
    : Math.min(MOSS_ALPHA_BASE + MOSS_ALPHA_SUN * altitude + loadBoost, MOSS_ALPHA_MAX)

  const amberAlpha = state.allClear
    ? CALM_ALPHA * 0.6
    : AMBER_ALPHA_BASE + AMBER_ALPHA_GOLDEN * golden

  return {
    mossX: 12 + progress * 76 + jitter,
    mossY: 88 - altitude * 74,
    mossAlpha,
    amberX: 100 - (12 + progress * 76) - jitter,
    amberY: 96,
    amberAlpha,
    grain: state.load >= 4 ? GRAIN_OPACITY_LOADED : GRAIN_OPACITY,
    seed: Math.floor(seed * 100),
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AmbientField({ load, allClear }: FieldState) {
  // Coarse 5-minute buckets — the field tracks the day without re-rendering on
  // every clock tick. Null until the client clock is known, which also avoids
  // an SSR hydration mismatch and a flash of the wrong time-of-day state.
  const bucket = useClockBucket(5 * 60 * 1000)

  const geo = useMemo(
    () => (bucket === null ? null : computeGeometry(new Date(bucket), { load, allClear })),
    [bucket, load, allClear],
  )

  if (!geo) return null

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Base wash — replaces the layout's .tars-ambient on this route */}
      <div
        className="absolute inset-0"
        style={{ backgroundColor: "var(--c-canvas)" }}
      />

      {/* Moss layer — the sun arc */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(120% 85% at ${geo.mossX}% ${geo.mossY}%, color-mix(in srgb, var(--c-moss) ${geo.mossAlpha}%, transparent) 0%, transparent 58%)`,
          transition: "background-image 3s ease-out",
          animation: "tars-field-drift 90s ease-in-out infinite",
        }}
      />

      {/* Amber layer — golden hour, opposite side */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(105% 70% at ${geo.amberX}% ${geo.amberY}%, color-mix(in srgb, var(--c-amber) ${geo.amberAlpha}%, transparent) 0%, transparent 52%)`,
          transition: "background-image 3s ease-out",
          animation: "tars-field-drift 120s ease-in-out infinite reverse",
        }}
      />

      {/* All-clear boot glow — reuses the STANDBY halo language */}
      {allClear && (
        <div
          className="absolute inset-0 tars-boot-glow"
          style={{ animation: "tars-boot-in 1.2s ease-out" }}
        />
      )}

      {/* Grain — keeps the gradient from reading as generic SaaS mush */}
      <svg className="absolute inset-0 w-full h-full" style={{ mixBlendMode: "overlay" }}>
        <filter id="tars-field-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={3}
            seed={geo.seed}
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect
          width="100%"
          height="100%"
          filter="url(#tars-field-grain)"
          opacity={geo.grain}
        />
      </svg>
    </div>
  )
}
