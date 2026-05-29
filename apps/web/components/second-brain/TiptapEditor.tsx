"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useEditor, EditorContent, BubbleMenu, FloatingMenu } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import Placeholder from "@tiptap/extension-placeholder"
import Typography from "@tiptap/extension-typography"
import { Markdown } from "tiptap-markdown"
import {
  Bold, Italic, Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Code, Minus,
  Link2, ImageIcon, Eraser, Loader2,
  Wand2, Scissors, Expand, RefreshCw, ChevronRight,
  Pilcrow,
} from "lucide-react"

export interface TiptapEditorProps {
  content: string
  onChange: (markdown: string) => void
  onWordCount?: (count: number) => void
  placeholder?: string
  readOnly?: boolean
  autoFocus?: boolean
  resetKey?: string
}

// ─── AI BubbleMenu ────────────────────────────────────────────────────────────

const AI_ACTIONS = [
  { id: "improve",  label: "Improve",  icon: Wand2 },
  { id: "shorten",  label: "Shorten",  icon: Scissors },
  { id: "expand",   label: "Expand",   icon: Expand },
  { id: "rephrase", label: "Rephrase", icon: RefreshCw },
  { id: "continue", label: "Continue", icon: ChevronRight },
] as const

type AIAction = typeof AI_ACTIONS[number]["id"] | "custom"

function AiBubbleMenu({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const [enhancing, setEnhancing] = useState(false)
  const [customPrompt, setCustomPrompt] = useState("")
  const selectionRef = useRef<{ from: number; to: number } | null>(null)

  const handleAIAction = useCallback(async (action: AIAction) => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, " ")
    if (!selectedText && action !== "continue") return

    selectionRef.current = { from, to }
    setEnhancing(true)

    const docContext = editor.getText().slice(0, 1500)
    let result = ""

    try {
      const resp = await fetch("/api/proxy/second-brain/ai/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selected_text: selectedText || docContext.slice(-500),
          action,
          custom_prompt: action === "custom" ? customPrompt : undefined,
          document_context: docContext,
        }),
      })

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      if (!resp.body) throw new Error("No response body")

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6).trim()
          if (raw === "[DONE]") break
          try {
            const evt = JSON.parse(raw)
            if (evt.type === "chunk") result += evt.text
          } catch { /* ignore parse errors */ }
        }
      }

      if (result) {
        const sel = selectionRef.current
        if (sel && sel.from !== sel.to) {
          editor.chain().focus().insertContentAt({ from: sel.from, to: sel.to }, result).run()
        } else {
          editor.chain().focus().insertContent(result).run()
        }
      }
    } catch (err) {
      console.error("AI enhance failed:", err)
    } finally {
      setEnhancing(false)
      setCustomPrompt("")
    }
  }, [editor, customPrompt])

  if (!editor) return null

  return (
    <BubbleMenu
      editor={editor}
      tippyOptions={{ duration: 100, placement: "top" }}
      shouldShow={({ editor, state }) => {
        const { from, to } = state.selection
        return from !== to && !editor.isActive("codeBlock")
      }}
    >
      <div
        className="flex items-center gap-0.5 rounded-lg shadow-lg border px-1.5 py-1"
        style={{ background: "#1a1714", borderColor: "#3a3530" }}
      >
        {enhancing ? (
          <div className="flex items-center gap-2 px-2 py-0.5">
            <Loader2 size={12} className="animate-spin" style={{ color: "#2d5a4f" }} />
            <span className="text-[11px]" style={{ color: "#948a7b" }}>Enhancing…</span>
          </div>
        ) : (
          <>
            {AI_ACTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => handleAIAction(id)}
                title={label}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors hover:bg-white/10"
                style={{ color: "#e5e0d8" }}
              >
                <Icon size={11} />
                {label}
              </button>
            ))}
            <div className="w-px h-4 mx-0.5" style={{ background: "#3a3530" }} />
            <input
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              onKeyDown={e => e.key === "Enter" && customPrompt.trim() && handleAIAction("custom")}
              placeholder="Custom…"
              className="text-[11px] bg-transparent border-none outline-none w-20 px-1"
              style={{ color: "#e5e0d8" }}
            />
            {customPrompt.trim() && (
              <button
                onClick={() => handleAIAction("custom")}
                className="p-1 rounded-md hover:bg-white/10"
                style={{ color: "#2d5a4f" }}
              >
                <ChevronRight size={12} />
              </button>
            )}
          </>
        )}
      </div>
    </BubbleMenu>
  )
}

// ─── Slash command FloatingMenu ───────────────────────────────────────────────

const SLASH_COMMANDS = [
  { label: "Paragraph",      icon: Pilcrow,       action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().setParagraph().run() },
  { label: "Heading 1",      icon: Heading1,      action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "Heading 2",      icon: Heading2,      action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "Heading 3",      icon: Heading3,      action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: "Bullet list",    icon: List,          action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleBulletList().run() },
  { label: "Ordered list",   icon: ListOrdered,   action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleOrderedList().run() },
  { label: "Blockquote",     icon: Quote,         action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleBlockquote().run() },
  { label: "Code block",     icon: Code,          action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().toggleCodeBlock().run() },
  { label: "Divider",        icon: Minus,         action: (e: ReturnType<typeof useEditor>) => e?.chain().focus().setHorizontalRule().run() },
]

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function EditorToolbar({
  editor,
  onImageUpload,
}: {
  editor: ReturnType<typeof useEditor>
  onImageUpload: () => void
}) {
  if (!editor) return null

  const btn = (
    active: boolean,
    onClick: () => void,
    Icon: React.ElementType,
    title: string,
  ) => (
    <button
      key={title}
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className="p-1.5 rounded-md transition-colors"
      style={{ color: active ? "#2d5a4f" : "#948a7b", background: active ? "#e3ede9" : "transparent" }}
    >
      <Icon size={14} />
    </button>
  )

  const sep = () => <div className="w-px h-4 self-center" style={{ background: "#e8e2d4" }} />

  return (
    <div
      className="flex items-center flex-wrap gap-0.5 px-3 py-1.5 border-b shrink-0"
      style={{ borderColor: "#e8e2d4", background: "#faf8f4" }}
    >
      {btn(editor.isActive("bold"),    () => editor.chain().focus().toggleBold().run(),                  Bold,         "Bold")}
      {btn(editor.isActive("italic"),  () => editor.chain().focus().toggleItalic().run(),                Italic,       "Italic")}
      {sep()}
      {btn(editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), Heading1, "Heading 1")}
      {btn(editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2, "Heading 2")}
      {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), Heading3, "Heading 3")}
      {sep()}
      {btn(editor.isActive("bulletList"),  () => editor.chain().focus().toggleBulletList().run(),   List,         "Bullet list")}
      {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(),  ListOrdered,  "Ordered list")}
      {sep()}
      {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(),    Quote,        "Blockquote")}
      {btn(editor.isActive("codeBlock"),  () => editor.chain().focus().toggleCodeBlock().run(),     Code,         "Code block")}
      {btn(false,                         () => editor.chain().focus().setHorizontalRule().run(),   Minus,        "Divider")}
      {sep()}
      {btn(editor.isActive("link"), () => {
        const url = window.prompt("URL", editor.getAttributes("link").href || "")
        if (url === null) return
        if (url === "") { editor.chain().focus().unsetLink().run(); return }
        editor.chain().focus().setLink({ href: url }).run()
      }, Link2, "Link")}
      <button
        type="button"
        onMouseDown={e => { e.preventDefault(); onImageUpload() }}
        title="Insert image"
        className="p-1.5 rounded-md transition-colors"
        style={{ color: "#948a7b" }}
      >
        <ImageIcon size={14} />
      </button>
      {sep()}
      {btn(false, () => editor.chain().focus().clearNodes().unsetAllMarks().run(), Eraser, "Clear formatting")}
    </div>
  )
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export function TiptapEditor({
  content,
  onChange,
  onWordCount,
  placeholder = "Start writing, or type '/' for commands…",
  readOnly = false,
  autoFocus = false,
  resetKey,
}: TiptapEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const contentSet = useRef(false)
  const prevResetKey = useRef(resetKey)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } }),
      Placeholder.configure({ placeholder }),
      Typography,
      Markdown.configure({ html: false, transformCopiedText: true, tightLists: true }),
    ],
    editable: !readOnly,
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const md: string = (editor.storage as any).markdown?.getMarkdown?.() ?? editor.getText()
      onChange(md)
      if (onWordCount) {
        onWordCount(editor.getText().split(/\s+/).filter(Boolean).length)
      }
    },
  })

  // Load content into editor once after mount / when resetKey changes (different item opened)
  useEffect(() => {
    if (!editor) return
    // Reset when a different item opens
    if (resetKey !== prevResetKey.current) {
      contentSet.current = false
      prevResetKey.current = resetKey
    }
    if (!contentSet.current) {
      // tiptap-markdown overrides setContent to accept a markdown string
      editor.commands.setContent(content || "")
      contentSet.current = true
    }
  }, [editor, content, resetKey])

  // Handle image upload → base64
  function handleImageFile(file: File) {
    if (!editor) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") {
        editor.chain().focus().setImage({ src: reader.result }).run()
      }
    }
    reader.readAsDataURL(file)
  }

  if (!editor) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={18} className="animate-spin" style={{ color: "#948a7b" }} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {!readOnly && (
        <>
          <EditorToolbar editor={editor} onImageUpload={() => imageInputRef.current?.click()} />

          {/* Floating slash command menu */}
          <FloatingMenu
            editor={editor}
            tippyOptions={{ duration: 100, placement: "bottom-start" }}
            shouldShow={({ state }) => {
              const { $from } = state.selection
              const currentLineText = $from.nodeBefore?.textContent ?? ""
              return currentLineText === "/"
            }}
          >
            <div
              className="rounded-lg shadow-xl border overflow-hidden"
              style={{ background: "#fbfaf6", borderColor: "#d8d2c4", minWidth: "200px" }}
            >
              <div className="px-3 py-1.5 border-b" style={{ borderColor: "#e8e2d4" }}>
                <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "#948a7b" }}>
                  Insert block
                </span>
              </div>
              {SLASH_COMMANDS.map(({ label, icon: Icon, action }) => (
                <button
                  key={label}
                  onMouseDown={e => {
                    e.preventDefault()
                    // Delete the "/" character first
                    editor.chain().focus().deleteRange({
                      from: editor.state.selection.$from.pos - 1,
                      to: editor.state.selection.$from.pos,
                    }).run()
                    action(editor)
                  }}
                  className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-left transition-colors hover:bg-surface-2"
                  style={{ color: "#1a1714" }}
                >
                  <Icon size={14} style={{ color: "#948a7b" }} />
                  {label}
                </button>
              ))}
            </div>
          </FloatingMenu>

          <AiBubbleMenu editor={editor} />
        </>
      )}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) { handleImageFile(file); e.target.value = "" }
        }}
      />

      <div
        className="flex-1 overflow-y-auto cursor-text"
        onClick={() => editor.commands.focus()}
      >
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  )
}
