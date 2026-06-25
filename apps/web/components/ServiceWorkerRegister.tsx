"use client"

import { useEffect } from "react"

// Previously this registered a service worker. An earlier caching worker left users
// stuck on stale JS bundles, so we now do the opposite: unregister any existing
// service worker and purge all caches on load, and never register a new one. This,
// together with the kill-switch in public/sw.js, fully clears the stale state.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {})
    }
    if ("caches" in window) {
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {})
    }
  }, [])

  return null
}
