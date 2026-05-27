import { Badge } from "@/components/ui/badge"

const MODEL_LABELS: Record<string, { label: string; className: string }> = {
  "tier1":          { label: "Qwen 8B",       className: "bg-blue-950 text-blue-300 border-blue-800" },
  "tier2":          { label: "Qwen 32B",      className: "bg-violet-950 text-violet-300 border-violet-800" },
  "tier3":          { label: "Claude",        className: "bg-amber-950 text-amber-300 border-amber-800" },
  "qwen3-8b":       { label: "Qwen 8B",       className: "bg-blue-950 text-blue-300 border-blue-800" },
  "qwen3-32b":      { label: "Qwen 32B",      className: "bg-violet-950 text-violet-300 border-violet-800" },
  "claude-sonnet-4-6": { label: "Claude Sonnet", className: "bg-amber-950 text-amber-300 border-amber-800" },
}

export function ModelBadge({ model }: { model: string }) {
  const meta = MODEL_LABELS[model] ?? { label: model, className: "bg-zinc-800 text-zinc-400 border-zinc-700" }
  return (
    <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 font-mono ${meta.className}`}>
      {meta.label}
    </Badge>
  )
}
