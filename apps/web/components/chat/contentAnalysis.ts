/**
 * Client-side content analysis for smart action suggestions.
 * Runs on every assistant message after render to detect calendar events,
 * action item lists, research content, etc.
 */

// ─── List item extraction ─────────────────────────────────────────────────────

// Words that signal a question or clarification, not an action item
const QUESTION_STARTS =
  /^(is|are|was|were|do|does|did|can|could|would|should|will|has|have|had|what|when|where|why|how|which|who|whom)\b/i

function isActionableItem(text: string): boolean {
  // Reject questions
  if (text.endsWith("?")) return false
  if (QUESTION_STARTS.test(text.trim())) return false
  // Reject very short fragments
  if (text.trim().length < 8) return false
  // Reject pure descriptions / single nouns with no verb signal
  // (heuristic: actionable items usually have a verb or are imperative)
  return true
}

export function extractListItems(content: string): string[] {
  const items: string[] = []
  for (const line of content.split("\n")) {
    const match = line.trim().match(/^(?:[-*•]|\d+\.)\s+(.+)/)
    if (match) {
      const text = match[1]
        .replace(/\*\*(.*?)\*\*/g, "$1") // strip bold markers
        .replace(/\[(.*?)\]/g, "$1")     // strip markdown links
        .trim()
      if (text.length > 3 && text.length < 200 && isActionableItem(text)) {
        items.push(text)
      }
    }
  }
  return items
}

// ─── Calendar detection ───────────────────────────────────────────────────────

const CALENDAR_WORDS =
  /\b(meeting|call|appointment|lunch|dinner|event|conference|standup|sync|interview|session|demo|presentation|webinar|catch[- ]?up|check[- ]?in)\b/i

const DATE_WORDS =
  /\b(tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|next week|this week|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b|\b\d{1,2}[\/\-]\d{1,2}/i

const TIME_WORDS =
  /\b(\d{1,2}(:\d{2})?\s*(am|pm)|noon|midnight)\b/i

export interface CalendarHint {
  suggestedTitle: string
  rawText: string
}

export function detectCalendarHint(content: string): CalendarHint | null {
  if (!CALENDAR_WORDS.test(content)) return null
  if (!DATE_WORDS.test(content) && !TIME_WORDS.test(content)) return null

  // Find the most relevant sentence
  const sentences = content.split(/(?<=[.!?])\s+/)
  const best = sentences.find((s) => CALENDAR_WORDS.test(s) && (DATE_WORDS.test(s) || TIME_WORDS.test(s)))
    ?? sentences.find((s) => CALENDAR_WORDS.test(s))
    ?? sentences[0]

  // Try to extract a clean event title
  const titleGuess = best
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/[_`#]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .trim()
    .slice(0, 80)

  // Capitalize first word as title if it's a short phrase
  const firstWord = titleGuess.split(" ").slice(0, 6).join(" ")

  return {
    suggestedTitle: firstWord,
    rawText: best.trim().slice(0, 150),
  }
}

// ─── Reply option extraction ──────────────────────────────────────────────────
// Detects when TARS presents a numbered/bulleted choice list where each item
// starts with a bold label — signals the user should pick one, not type text.

export interface ReplyOption {
  label: string  // the bold text — used as chip label and sent message
}

// Matches: "- **Label** — ..." or "1. **Label** ..." etc.
const OPTION_LINE_RE = /^(?:[-*•]|\d+\.)\s+\*\*(.+?)\*\*/

export function extractReplyOptions(content: string): ReplyOption[] {
  const options: ReplyOption[] = []
  for (const line of content.split("\n")) {
    const m = line.trim().match(OPTION_LINE_RE)
    if (m) options.push({ label: m[1].trim() })
  }
  // 2–5 bold-labeled bullets = a choice list; anything else is just formatting
  return options.length >= 2 && options.length <= 5 ? options : []
}

// ─── Research / reference detection ──────────────────────────────────────────

export function isResearchContent(content: string): boolean {
  const wordCount = content.split(/\s+/).length
  const hasHeaders = /^#{1,3}\s+/m.test(content)
  const hasTable = /\|.*\|.*\|/m.test(content)
  return wordCount > 200 || hasHeaders || hasTable
}

// ─── Aggregated analysis ──────────────────────────────────────────────────────

export interface ContentAnalysis {
  listItems: string[]        // extracted bullet/numbered items
  calendarHint: CalendarHint | null
  isResearch: boolean
  replyOptions: ReplyOption[]
}

export function analyzeContent(content: string): ContentAnalysis {
  const replyOptions = extractReplyOptions(content)
  return {
    // Suppress list items when reply options are present — same bullets, different intent
    listItems: replyOptions.length >= 2 ? [] : extractListItems(content),
    calendarHint: detectCalendarHint(content),
    isResearch: isResearchContent(content),
    replyOptions,
  }
}
