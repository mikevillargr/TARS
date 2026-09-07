"use client"

import { useSyncExternalStore } from "react"

/**
 * useClock — a client-only ticking clock.
 *
 * Returns `null` during SSR and on the very first client render, then the
 * current epoch ms. Reading the clock this way (rather than seeding state in an
 * effect) avoids both a hydration mismatch and the cascading-render that
 * `react-hooks/set-state-in-effect` warns about.
 *
 * A single module-level interval is shared by every subscriber, and is torn
 * down when the last one unsubscribes.
 */

const TICK_MS = 30_000

type Listener = () => void

let snapshot: number | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<Listener>()

function tick() {
  snapshot = Date.now()
  listeners.forEach(l => l())
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  if (!timer) {
    // Seed without notifying — React re-reads the snapshot immediately after
    // subscribing, so the first value lands on the same commit.
    snapshot = Date.now()
    timer = setInterval(tick, TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

const getSnapshot = () => snapshot
const getServerSnapshot = () => null

/** Epoch ms, or null before the client clock is known. */
export function useClockMs(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Epoch ms rounded down to a bucket, so consumers that only care about coarse
 * time (e.g. a 5-minute ambient state) don't re-render every tick.
 */
export function useClockBucket(bucketMs: number): number | null {
  const ms = useClockMs()
  return ms === null ? null : Math.floor(ms / bucketMs) * bucketMs
}
