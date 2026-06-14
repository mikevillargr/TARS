// Bracketed-mono instrument chips. One accent (moss) signals the frontier tier;
// everything else stays neutral so the badge reads like a system readout, not decoration.
const MODEL_LABELS: Record<string, { label: string; tier: "fast" | "work" | "frontier" }> = {
  "tier1":              { label: "Haiku",  tier: "fast" },
  "tier2":              { label: "GLM",    tier: "work" },
  "tier3":              { label: "Sonnet", tier: "frontier" },
  "claude-haiku":       { label: "Haiku",  tier: "fast" },
  "glm-4.7":            { label: "GLM",    tier: "work" },
  "claude-sonnet-4-6":  { label: "Sonnet", tier: "frontier" },
}

const TIER_COLOR: Record<"fast" | "work" | "frontier", string> = {
  fast: "var(--c-ink-faint)",
  work: "var(--c-ink-muted)",
  frontier: "var(--c-moss)",
}

export function ModelBadge({ model }: { model: string }) {
  const meta = MODEL_LABELS[model] ?? { label: model, tier: "work" as const }
  return (
    <span
      className="inline-flex items-center gap-1 font-mono text-[0.625rem] uppercase tracking-[0.1em] leading-none whitespace-nowrap"
      style={{ color: TIER_COLOR[meta.tier] }}
    >
      <span style={{ opacity: 0.5 }}>[</span>
      {meta.label}
      <span style={{ opacity: 0.5 }}>]</span>
    </span>
  )
}
