// Shared helpers for the universal @-mention system.
//
// Storage / wire format: [[id|type|label]]  e.g. [[abc123|contact|James Shorrock]]
// Display format (what the user sees/edits in a plain textarea): @James Shorrock
//
// Entities are linked across modules via the `links` table; the wire markers embedded
// in a stored text field make the round-trip lossless (the id survives save → reload).

export interface MentionRef {
  id: string
  type: string
  label: string
}

// Global matcher for [[id|type|label]] — label may contain anything except ]]
export const WIRE_RE = /\[\[([^\]|]+)\|([^\]|]+)\|([^\]]+?)\]\]/g

/** Strip wire markers down to plain labels — for read-only display surfaces. */
export function stripToLabels(text: string | null | undefined): string {
  return (text ?? "").replace(WIRE_RE, (_m, _id, _type, label) => label)
}

/** Parse stored wire text into editable display text (`@Label`) + the mentions it contains. */
export function parseWireToDisplay(wire: string | null | undefined): {
  display: string
  mentions: MentionRef[]
} {
  const mentions: MentionRef[] = []
  const display = (wire ?? "").replace(WIRE_RE, (_m, id, type, label) => {
    mentions.push({ id, type, label })
    return `@${label}`
  })
  return { display, mentions }
}

/**
 * Expand `@Label` display tokens back into [[id|type|label]] wire markers.
 * Longest labels first so "@James" can't shadow "@James Shorrock". Literal
 * split/join — no regex escaping needed.
 */
export function toWire(display: string, map: Map<string, { id: string; type: string }>): string {
  let wire = display
  const labels = [...map.keys()].sort((a, b) => b.length - a.length)
  for (const label of labels) {
    const m = map.get(label)!
    wire = wire.split(`@${label}`).join(`[[${m.id}|${m.type}|${label}]]`)
  }
  return wire
}

/**
 * Persist entity relationships for the mentions in a source record.
 * Creates bidirectional-capable `links` rows (source → each mentioned target).
 * Best-effort and silent — never blocks the primary save.
 */
export async function syncMentionLinks(
  sourceType: string,
  sourceId: string,
  mentions: MentionRef[],
): Promise<void> {
  if (!sourceId || mentions.length === 0) return
  const seen = new Set<string>()
  const links = mentions
    .filter(m => {
      const key = `${m.type}:${m.id}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map(m => ({
      source_type: sourceType,
      source_id: sourceId,
      target_type: m.type,
      target_id: m.id,
      relationship: "mentions",
    }))
  try {
    await fetch("/api/proxy/links/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ links }),
    })
  } catch { /* silent */ }
}

/** The subset of a map's mentions that are still present (as `@Label`) in the display text. */
export function currentMentions(
  display: string,
  map: Map<string, { id: string; type: string }>,
): MentionRef[] {
  const out: MentionRef[] = []
  for (const [label, info] of map) {
    if (display.includes(`@${label}`)) out.push({ id: info.id, type: info.type, label })
  }
  return out
}
