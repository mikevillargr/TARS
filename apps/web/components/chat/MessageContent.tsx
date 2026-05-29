"use client"

import React, { useState, useCallback } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter"
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism"
import { Copy, Check, BookOpen, Code2, Image } from "lucide-react"
import { apiPost } from "@/lib/api-client"
import { UrlPreviewCard } from "./UrlPreviewCard"

// ─── URL detection ────────────────────────────────────────────────
const URL_REGEX = /https?:\/\/[^\s<>"')\]]+/g

function extractUrls(text: string): string[] {
  return [...new Set(text.match(URL_REGEX) || [])]
}

// ─── SVG renderer ─────────────────────────────────────────────────
function SvgRenderer({ code }: { code: string }) {
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  // Extract width/height from SVG to maintain aspect ratio
  const widthMatch = code.match(/width="(\d+)"/)
  const heightMatch = code.match(/height="(\d+)"/)
  const svgWidth = widthMatch ? parseInt(widthMatch[1]) : 600
  const svgHeight = heightMatch ? parseInt(heightMatch[1]) : 400
  const aspectRatio = svgHeight / svgWidth

  return (
    <div className="my-3 rounded-xl overflow-hidden" style={{ border: "1px solid #2a2a2a" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ backgroundColor: "#1e1e1e" }}
      >
        <span className="text-[11px] font-mono" style={{ color: "#888" }}>svg</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSource(!showSource)}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: showSource ? "#a78bfa" : "#888" }}
            title={showSource ? "Show rendered" : "Show source"}
          >
            {showSource ? <Image size={10} /> : <Code2 size={10} />}
            {showSource ? "Render" : "Source"}
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: copied ? "#4ade80" : "#888" }}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {showSource ? (
        <SyntaxHighlighter
          language="xml"
          style={oneDark}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: "0.75rem",
            lineHeight: "1.5",
            padding: "1rem",
            background: "#1a1a1a",
          }}
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      ) : (
        <div
          className="w-full"
          style={{ backgroundColor: "#fafafa", padding: "1rem" }}
        >
          <div
            className="w-full"
            style={{ paddingBottom: `${Math.min(aspectRatio * 100, 100)}%`, position: "relative" }}
          >
            <div
              style={{ position: "absolute", inset: 0 }}
              dangerouslySetInnerHTML={{ __html: code
                .replace(/width="[^"]*"/, 'width="100%"')
                .replace(/height="[^"]*"/, 'height="100%"')
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Code block ───────────────────────────────────────────────────
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [code])

  const saveToSecondBrain = useCallback(async () => {
    setSaving(true)
    try {
      await apiPost("/second-brain/ingest/text", {
        content: code,
        title: language ? `Code snippet (${language})` : "Code snippet",
        tags: ["code", language].filter(Boolean),
        domain: "work",
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }, [code, language])

  return (
    <div className="my-3 rounded-xl overflow-hidden" style={{ border: "1px solid #2a2a2a" }}>
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5"
        style={{ backgroundColor: "#1e1e1e" }}
      >
        <span className="text-[11px] font-mono" style={{ color: "#888" }}>
          {language || "code"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={saveToSecondBrain}
            disabled={saving || saved}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{
              color: saved ? "#4ade80" : "#888",
              backgroundColor: "transparent",
            }}
          >
            <BookOpen size={10} />
            {saved ? "Saved" : saving ? "Saving…" : "Save"}
          </button>
          <button
            onClick={copy}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors"
            style={{ color: copied ? "#4ade80" : "#888" }}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <SyntaxHighlighter
        language={language || "text"}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: "0.75rem",
          lineHeight: "1.5",
          padding: "1rem",
          background: "#1a1a1a",
        }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

// ─── Inline code ─────────────────────────────────────────────────
function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code
      className="px-1.5 py-0.5 rounded text-[0.8em] font-mono"
      style={{ backgroundColor: "#efeadf", color: "#b45309", border: "1px solid #d8d2c4" }}
    >
      {children}
    </code>
  )
}

// ─── Main component ───────────────────────────────────────────────
export function MessageContent({ content }: { content: string }) {
  const urls = extractUrls(content)

  return (
    <div className="message-content space-y-0.5" data-selectable>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks
          code({ node, className, children, ...props }) {
            const inline = !className
            const language = className?.replace("language-", "") || ""
            const code = String(children).replace(/\n$/, "")

            if (inline) {
              return <InlineCode>{children}</InlineCode>
            }
            if (language === "svg" || (language === "xml" && code.trimStart().startsWith("<svg"))) {
              return <SvgRenderer code={code} />
            }
            return <CodeBlock language={language} code={code} />
          },

          // Headings
          h1: ({ children }) => (
            <h1 className="text-lg font-semibold mt-4 mb-2 first:mt-0" style={{ color: "#1a1714" }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-semibold mt-3 mb-1.5 first:mt-0" style={{ color: "#1a1714" }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0" style={{ color: "#1a1714" }}>{children}</h3>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="text-sm leading-relaxed mb-2 last:mb-0">{children}</p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="text-sm space-y-1 my-2 pl-4 list-none">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="text-sm space-y-1 my-2 pl-4 list-decimal">{children}</ol>
          ),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          li: ({ children, ordered }: { children?: React.ReactNode; ordered?: boolean; [key: string]: any }) => (
            ordered
              ? <li className="leading-relaxed">{children}</li>
              : (
                <li className="leading-relaxed flex gap-2">
                  <span className="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#2d5a4f" }} />
                  <span>{children}</span>
                </li>
              )
          ),

          // Tables
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto rounded-lg" style={{ border: "1px solid #d8d2c4" }}>
              <table className="text-sm w-full">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead style={{ backgroundColor: "#efeadf" }}>{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "#6b6357", borderBottom: "1px solid #d8d2c4" }}>
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-sm" style={{ borderBottom: "1px solid #e8e2d4" }}>{children}</td>
          ),

          // Blockquote
          blockquote: ({ children }) => (
            <blockquote
              className="my-2 pl-3 py-1 text-sm italic"
              style={{ borderLeft: "3px solid #2d5a4f", color: "#6b6357" }}
            >
              {children}
            </blockquote>
          ),

          // Bold / italic
          strong: ({ children }) => (
            <strong className="font-semibold" style={{ color: "#1a1714" }}>{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic" style={{ color: "#4a4540" }}>{children}</em>
          ),

          // Horizontal rule
          hr: () => (
            <hr className="my-3" style={{ borderColor: "#d8d2c4" }} />
          ),

          // Links — open in new tab
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:opacity-80 transition-opacity"
              style={{ color: "#2d5a4f" }}
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>

      {/* URL preview cards — shown below message for any URLs found */}
      {urls.length > 0 && (
        <div className="mt-3 space-y-2">
          {urls.slice(0, 3).map((url) => (
            <UrlPreviewCard key={url} url={url} />
          ))}
        </div>
      )}
    </div>
  )
}
