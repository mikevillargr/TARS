"use client"

import { useState, useEffect } from "react"
import { BookOpen, ExternalLink, Globe } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api-client"

interface UrlMeta {
  url: string
  title?: string
  description?: string
  image?: string
  favicon?: string
  domain?: string
}

export function UrlPreviewCard({ url }: { url: string }) {
  const [meta, setMeta] = useState<UrlMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function fetchPreview() {
      try {
        const data = await apiGet(`/preview?url=${encodeURIComponent(url)}`) as UrlMeta
        if (!cancelled) setMeta(data)
      } catch {
        if (!cancelled) setMeta({ url }) // fallback: at least show the URL
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchPreview()
    return () => { cancelled = true }
  }, [url])

  const saveToSecondBrain = async () => {
    setSaving(true)
    try {
      await apiPost("/second-brain/ingest/url", { url, domain: "work" })
      setSaved(true)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  if (hidden) return null

  // While loading: show a minimal skeleton
  if (loading) {
    return (
      <div
        className="rounded-xl px-3 py-2.5 animate-pulse"
        style={{ backgroundColor: "#f6f3ec", border: "1px solid #e8e2d4" }}
      >
        <div className="h-3 rounded w-2/3" style={{ backgroundColor: "#e8e2d4" }} />
        <div className="h-2.5 rounded w-full mt-1.5" style={{ backgroundColor: "#e8e2d4" }} />
      </div>
    )
  }

  const displayTitle = meta?.title || meta?.domain || url
  const displayDesc  = meta?.description

  return (
    <div
      className="rounded-xl overflow-hidden group"
      style={{ backgroundColor: "#f6f3ec", border: "1px solid #e8e2d4" }}
    >
      {/* Image banner — only if present */}
      {meta?.image && (
        <div className="w-full h-28 overflow-hidden" style={{ backgroundColor: "#efeadf" }}>
          <img
            src={meta.image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        </div>
      )}

      <div className="px-3 py-2.5">
        {/* Domain + favicon */}
        <div className="flex items-center gap-1.5 mb-1">
          {meta?.favicon ? (
            <img
              src={meta.favicon}
              alt=""
              className="w-3.5 h-3.5 rounded"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
            />
          ) : (
            <Globe size={12} style={{ color: "#948a7b" }} />
          )}
          <span className="text-[10px]" style={{ color: "#948a7b" }}>{meta?.domain || new URL(url).hostname}</span>
        </div>

        {/* Title */}
        <p className="text-xs font-semibold leading-snug mb-0.5 line-clamp-2" style={{ color: "#1a1714" }}>
          {displayTitle}
        </p>

        {/* Description */}
        {displayDesc && (
          <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "#6b6357" }}>
            {displayDesc}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={saveToSecondBrain}
            disabled={saving || saved}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-colors font-medium"
            style={{
              backgroundColor: saved ? "#e3ede9" : "#efeadf",
              color: saved ? "#2d5a4f" : "#6b6357",
              border: `1px solid ${saved ? "rgba(45,90,79,0.2)" : "#d8d2c4"}`,
            }}
          >
            <BookOpen size={10} />
            {saved ? "Saved to Second Brain" : saving ? "Saving…" : "Save to Second Brain"}
          </button>

          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-colors"
            style={{ color: "#948a7b" }}
          >
            <ExternalLink size={10} />
            Open
          </a>

          <button
            onClick={() => setHidden(true)}
            className="ml-auto text-[10px] px-1.5 py-1 rounded transition-colors"
            style={{ color: "#c4bdb2" }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}
