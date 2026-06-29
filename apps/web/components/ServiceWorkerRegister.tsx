"use client"

import { useEffect } from "react"

// Global client housekeeping:
//
// 1. Service worker: register the minimal worker in public/sw.js. It has a fetch
//    handler (required for desktop Chrome/Edge to fire `beforeinstallprompt`, i.e.
//    to make the PWA installable) but NEVER caches app code — so it cannot recreate
//    the stale-bundle problem the old caching worker caused. The worker itself
//    purges any leftover caches from previous versions on activate.
//
// 2. ChunkLoadError self-heal: if a deploy removed a lazy chunk that a cached
//    app shell still references, the dynamic import 404s and React renders
//    "This page couldn't load". We detect that and force a single reload, which
//    revalidates the HTML and pulls a fresh shell. A sessionStorage guard makes
//    it a one-shot so we can never loop.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {})
    }

    const RELOAD_KEY = "tars_chunk_reload"
    const isChunkError = (msg: string) =>
      /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(msg)

    const recover = (msg: string) => {
      if (!isChunkError(msg)) return
      try {
        if (sessionStorage.getItem(RELOAD_KEY)) return // already tried once
        sessionStorage.setItem(RELOAD_KEY, "1")
      } catch {
        // sessionStorage unavailable — still attempt one reload
      }
      window.location.reload()
    }

    const onError = (e: ErrorEvent) => recover(e?.message || e?.error?.message || "")
    const onRejection = (e: PromiseRejectionEvent) =>
      recover(e?.reason?.message || String(e?.reason ?? ""))

    window.addEventListener("error", onError)
    window.addEventListener("unhandledrejection", onRejection)

    // Clear the one-shot guard once a load completes cleanly.
    const clearGuard = () => { try { sessionStorage.removeItem(RELOAD_KEY) } catch {} }
    if (document.readyState === "complete") setTimeout(clearGuard, 4000)
    else window.addEventListener("load", () => setTimeout(clearGuard, 4000), { once: true })

    return () => {
      window.removeEventListener("error", onError)
      window.removeEventListener("unhandledrejection", onRejection)
    }
  }, [])

  return null
}
