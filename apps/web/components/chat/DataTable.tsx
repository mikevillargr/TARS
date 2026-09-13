"use client"

import { useMemo, useState, type ReactNode } from "react"
import {
  ArrowDown, ArrowUp, Check, Copy, Download, Loader2, Sheet, Table2,
} from "lucide-react"

/**
 * The markdown table TARS already writes, made usable.
 *
 * Deliberately NOT a new tool. Every structured answer already arrives as a
 * markdown table, so upgrading the renderer means this works on every message
 * ever written, retroactively, and the model has nothing new to remember. A
 * `render_table` tool would only apply to tables written after it shipped, and
 * only when the model remembered to reach for it.
 *
 * The point is the last mile: a number you were shown becomes a number you can
 * sort, copy, or open in Sheets, instead of one you retype.
 */

type Row = string[]

function cellText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(cellText).join("")
  const el = node as { props?: { children?: ReactNode } }
  return el?.props?.children !== undefined ? cellText(el.props.children) : ""
}

/** Numeric-aware so "PHP 1,200" sorts above "PHP 900" rather than beside it. */
function compare(a: string, b: string): number {
  const na = Number(a.replace(/[^0-9.-]/g, ""))
  const nb = Number(b.replace(/[^0-9.-]/g, ""))
  const bothNumeric =
    a.trim() !== "" && b.trim() !== "" && !Number.isNaN(na) && !Number.isNaN(nb) &&
    /\d/.test(a) && /\d/.test(b)
  if (bothNumeric) return na - nb
  return a.localeCompare(b, undefined, { sensitivity: "base" })
}

function toCsv(headers: string[], rows: Row[]): string {
  const esc = (v: string) =>
    /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  return [headers, ...rows].map(r => r.map(esc).join(",")).join("\n")
}

/** Hoisted, not defined inside DataTable: a component created during render is
 *  a new type every render, so React remounts it and it loses state. Exactly
 *  the bug just fixed in TableView — the lint rule caught me making it again. */
function Action({
  icon, label, onClick, busy,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  busy: string | null
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy !== null}
      className="tars-label flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors"
      style={{ color: "var(--c-ink-faint)", opacity: busy ? 0.5 : 1 }}
      onMouseEnter={e => { if (!busy) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--c-surface-2)" }}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"}
    >
      {busy === label ? <Loader2 size={11} className="animate-spin" /> : icon}
      {label}
    </button>
  )
}

export function DataTable({
  headers,
  rows,
  title,
}: {
  headers: string[]
  rows: Row[]
  title?: string
}) {
  const [sortCol, setSortCol] = useState<number | null>(null)
  const [dir, setDir] = useState<"asc" | "desc">("asc")
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ text: string; href?: string } | null>(null)

  const sorted = useMemo(() => {
    if (sortCol === null) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const r = compare(a[sortCol] ?? "", b[sortCol] ?? "")
      return dir === "asc" ? r : -r
    })
    return copy
  }, [rows, sortCol, dir])

  const onSort = (i: number) => {
    if (sortCol === i) setDir(d => (d === "asc" ? "desc" : "asc"))
    else { setSortCol(i); setDir("asc") }
  }

  const post = async (path: string, label: string) => {
    setBusy(label)
    setNote(null)
    try {
      const res = await fetch(`/api/proxy/tables/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title ?? "TARS export", headers, rows: sorted }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) setNote({ text: data.detail ?? "Failed." })
      else if (data.url) setNote({ text: "Opened in Sheets", href: data.url })
      else setNote({ text: `Saved as ${data.filename}` })
    } catch {
      setNote({ text: "Failed." })
    } finally {
      setBusy(null)
    }
  }

  const copyCsv = async () => {
    await navigator.clipboard.writeText(toCsv(headers, sorted))
    setNote({ text: "CSV copied" })
  }

  const downloadCsv = () => {
    const blob = new Blob([toCsv(headers, sorted)], { type: "text/csv" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `${(title ?? "table").replace(/\s+/g, "-").toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="my-3 overflow-hidden" style={{ border: "1px solid var(--c-border-faint)", borderRadius: 6 }}>
      <div
        className="flex items-center gap-1 px-2 py-1.5 flex-wrap"
        style={{ background: "var(--c-surface)", borderBottom: "1px solid var(--c-border-faint)" }}
      >
        <Table2 size={11} style={{ color: "var(--c-ink-faint)" }} />
        <span className="tars-label tars-label--muted mr-auto">
          {rows.length} ROW{rows.length === 1 ? "" : "S"}
        </span>
        <Action icon={<Copy size={11} />} label="COPY CSV" onClick={copyCsv} busy={busy} />
        <Action icon={<Download size={11} />} label="DOWNLOAD" onClick={downloadCsv} busy={busy} />
        <Action icon={<Sheet size={11} />} label="SHEETS" onClick={() => post("to-sheet", "SHEETS")} busy={busy} />
        <Action icon={<Check size={11} />} label="SAVE" onClick={() => post("to-artifact", "SAVE")} busy={busy} />
      </div>

      {note && (
        <div
          className="px-2.5 py-1.5 tars-label"
          style={{ background: "var(--c-moss-soft)", color: "var(--c-moss)" }}
        >
          {note.href ? (
            <a href={note.href} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              {note.text} — open
            </a>
          ) : note.text}
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  onClick={() => onSort(i)}
                  style={{
                    padding: "0.45rem 0.7rem", textAlign: "left", whiteSpace: "nowrap",
                    cursor: "pointer", userSelect: "none",
                    borderBottom: "1px solid var(--c-border)", background: "var(--c-surface)",
                  }}
                >
                  <span
                    className="tars-label inline-flex items-center gap-1"
                    style={{ color: sortCol === i ? "var(--c-moss)" : undefined }}
                  >
                    {h}
                    {sortCol === i && (dir === "asc" ? <ArrowUp size={9} /> : <ArrowDown size={9} />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, ri) => (
              <tr key={ri} style={{ borderBottom: "1px solid var(--c-border-faint)" }}>
                {r.map((c, ci) => (
                  <td key={ci} style={{ padding: "0.45rem 0.7rem", color: "var(--c-ink)" }}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Bridge from ReactMarkdown's hast node to real data.
 *
 *  Reads the `node` ReactMarkdown passes alongside `children`, NOT the rendered
 *  children. The components map overrides thead/th/td, so in the children those
 *  elements' `type` is a component function rather than the string "thead" —
 *  walking them by tag name silently found nothing and every table fell back to
 *  the plain renderer. The hast node keeps real tagNames regardless.
 */
interface HastNode {
  type?: string
  tagName?: string
  value?: string
  children?: HastNode[]
}

function textOf(node: HastNode | undefined): string {
  if (!node) return ""
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map(textOf).join("")
}

function findAll(node: HastNode | undefined, tag: string): HastNode[] {
  if (!node) return []
  const out: HastNode[] = []
  if (node.tagName === tag) out.push(node)
  for (const c of node.children ?? []) out.push(...findAll(c, tag))
  return out
}

export function tableFromNode(node: unknown): { headers: string[]; rows: Row[] } | null {
  const root = node as HastNode | undefined
  if (!root) return null
  const head = findAll(root, "thead")[0]
  const body = findAll(root, "tbody")[0]
  if (!head || !body) return null

  const rowCells = (tr: HastNode) =>
    [...findAll(tr, "th"), ...findAll(tr, "td")].map(c => textOf(c).trim())

  const headerRow = findAll(head, "tr")[0]
  if (!headerRow) return null
  const headers = rowCells(headerRow)
  const rows = findAll(body, "tr").map(rowCells).filter(r => r.some(c => c !== ""))
  if (headers.length === 0 || rows.length === 0) return null
  return { headers, rows }
}
