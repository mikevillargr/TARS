"use client"

import { useState, useEffect } from "react"
import { BookOpen, ExternalLink, Globe, GitBranch, Star, GitFork, Play } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api-client"

interface UrlMeta {
  url: string
  title?: string
  description?: string
  image?: string
  favicon?: string
  domain?: string
}

// ── URL type detection ─────────────────────────────────────────────

function getYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v")
    if (u.hostname === "youtu.be") return u.pathname.slice(1).split("?")[0] || null
  } catch { /* ignore */ }
  return null
}

function getGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes("github.com")) return null
    const parts = u.pathname.split("/").filter(Boolean)
    if (parts.length >= 2) return { owner: parts[0], repo: parts[1] }
  } catch { /* ignore */ }
  return null
}

// ── YouTube card ───────────────────────────────────────────────────

function YouTubeCard({ url, videoId, onDismiss }: { url: string; videoId: string; onDismiss: () => void }) {
  const [playing, setPlaying] = useState(false)
  const thumb = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
  const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--c-surface)", border: "1px solid var(--c-border-faint)", maxWidth: 480 }}
    >
      {/* Thumbnail / player */}
      <div
        className="relative w-full cursor-pointer"
        style={{ aspectRatio: "16/9", background: "#000" }}
        onClick={() => setPlaying(true)}
      >
        {playing ? (
          <iframe
            src={embedUrl}
            className="absolute inset-0 w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{ border: "none" }}
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="flex items-center justify-center rounded-full"
                style={{ width: 48, height: 48, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
              >
                <Play size={20} style={{ color: "#fff", marginLeft: 3 }} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div
          className="w-4 h-4 rounded flex items-center justify-center shrink-0"
          style={{ background: "#ff0000" }}
        >
          <Play size={7} fill="#fff" style={{ color: "#fff", marginLeft: 1 }} />
        </div>
        <span style={{ fontSize: "10px", color: "var(--c-ink-faint)", fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", letterSpacing: "0.06em" }}>
          YOUTUBE
        </span>
        <div className="flex-1" />
        <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--c-ink-faint)" }}>
          <ExternalLink size={11} />
        </a>
        <button onClick={onDismiss} style={{ color: "var(--c-ink-faint)", background: "none", border: "none", cursor: "pointer", fontSize: 11 }}>✕</button>
      </div>
    </div>
  )
}

// ── GitHub card ────────────────────────────────────────────────────

interface GitHubRepoData {
  full_name: string
  description: string | null
  stargazers_count: number
  forks_count: number
  language: string | null
  html_url: string
  topics?: string[]
}

const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5",
  Rust: "#dea584", Go: "#00ADD8", Kotlin: "#A97BFF", Swift: "#F05138",
  CSS: "#563d7c", HTML: "#e34c26", Java: "#b07219", "C#": "#178600",
}

function GitHubCard({ owner, repo, url, onDismiss }: { owner: string; repo: string; url: string; onDismiss: () => void }) {
  const [data, setData] = useState<GitHubRepoData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch(`https://api.github.com/repos/${owner}/${repo}`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d.full_name) setData(d) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [owner, repo])

  const langColor = data?.language ? (LANG_COLORS[data.language] ?? "var(--c-ink-faint)") : undefined

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--c-surface)", border: "1px solid var(--c-border-faint)", maxWidth: 480 }}
    >
      <div className="px-3 pt-3 pb-2.5">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <GitBranch size={14} style={{ color: "var(--c-ink-muted)", flexShrink: 0 }} />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate no-underline"
              style={{ fontSize: "13px", fontWeight: 600, color: "var(--c-ink)" }}
            >
              {owner}/{repo}
            </a>
          </div>
          <button onClick={onDismiss} style={{ color: "var(--c-ink-faint)", background: "none", border: "none", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>✕</button>
        </div>

        {/* Description */}
        {loading && (
          <div className="mt-2 h-3 rounded animate-pulse" style={{ background: "var(--c-border-faint)", width: "70%" }} />
        )}
        {!loading && data?.description && (
          <p className="mt-1.5 line-clamp-2" style={{ fontSize: "11.5px", color: "var(--c-ink-muted)", lineHeight: 1.5 }}>
            {data.description}
          </p>
        )}

        {/* Stats */}
        {data && (
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {data.language && (
              <span className="flex items-center gap-1" style={{ fontSize: "11px", color: "var(--c-ink-muted)" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: langColor, display: "inline-block" }} />
                {data.language}
              </span>
            )}
            <span className="flex items-center gap-1" style={{ fontSize: "11px", color: "var(--c-ink-muted)" }}>
              <Star size={11} />
              {data.stargazers_count.toLocaleString()}
            </span>
            <span className="flex items-center gap-1" style={{ fontSize: "11px", color: "var(--c-ink-muted)" }}>
              <GitFork size={11} />
              {data.forks_count.toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Generic card (original) ────────────────────────────────────────

function GenericPreviewCard({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  const [meta, setMeta] = useState<UrlMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function fetchPreview() {
      try {
        const data = await apiGet(`/preview?url=${encodeURIComponent(url)}`) as UrlMeta
        if (!cancelled) setMeta(data)
      } catch {
        if (!cancelled) setMeta({ url })
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

  if (loading) {
    return (
      <div
        className="rounded-xl px-3 py-2.5 animate-pulse"
        style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}
      >
        <div className="h-3 rounded w-2/3" style={{ backgroundColor: "var(--c-border-faint)" }} />
        <div className="h-2.5 rounded w-full mt-1.5" style={{ backgroundColor: "var(--c-border-faint)" }} />
      </div>
    )
  }

  const displayTitle = meta?.title || meta?.domain || url
  const displayDesc  = meta?.description

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--c-surface)", border: "1px solid var(--c-border-faint)" }}
    >
      {meta?.image && (
        <div className="w-full h-28 overflow-hidden" style={{ background: "var(--c-surface-2)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={meta.image}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
          />
        </div>
      )}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          {meta?.favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={meta.favicon}
              alt=""
              className="w-3.5 h-3.5 rounded"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }}
            />
          ) : (
            <Globe size={12} style={{ color: "var(--c-ink-faint)" }} />
          )}
          <span style={{ fontSize: "10px", color: "var(--c-ink-faint)" }}>
            {meta?.domain || (() => { try { return new URL(url).hostname } catch { return url } })()}
          </span>
        </div>
        <p className="text-xs font-semibold leading-snug mb-0.5 line-clamp-2" style={{ color: "var(--c-ink)" }}>
          {displayTitle}
        </p>
        {displayDesc && (
          <p className="text-[11px] leading-relaxed line-clamp-2" style={{ color: "var(--c-ink-muted)" }}>
            {displayDesc}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={saveToSecondBrain}
            disabled={saving || saved}
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-colors font-medium"
            style={{
              background: saved ? "color-mix(in srgb, var(--c-moss) 10%, transparent)" : "var(--c-surface-2)",
              color: saved ? "var(--c-moss)" : "var(--c-ink-faint)",
              border: `1px solid ${saved ? "color-mix(in srgb, var(--c-moss) 25%, transparent)" : "var(--c-border-faint)"}`,
            }}
          >
            <BookOpen size={10} />
            {saved ? "Saved" : saving ? "Saving…" : "Save to Second Brain"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg"
            style={{ color: "var(--c-ink-faint)" }}
          >
            <ExternalLink size={10} />
            Open
          </a>
          <button
            onClick={onDismiss}
            className="ml-auto text-[10px] px-1.5 py-1 rounded"
            style={{ color: "var(--c-ink-faint)", background: "none", border: "none", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main export — dispatches by URL type ──────────────────────────

export function UrlPreviewCard({ url }: { url: string }) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null

  const ytId = getYouTubeId(url)
  if (ytId) return <YouTubeCard url={url} videoId={ytId} onDismiss={() => setHidden(true)} />

  const ghRepo = getGitHubRepo(url)
  if (ghRepo) return <GitHubCard owner={ghRepo.owner} repo={ghRepo.repo} url={url} onDismiss={() => setHidden(true)} />

  return <GenericPreviewCard url={url} onDismiss={() => setHidden(true)} />
}
