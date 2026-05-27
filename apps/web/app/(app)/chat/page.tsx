"use client"

import { useState, useEffect } from "react"
import {
  Send, Paperclip, Camera, Mic, Plus, Bot, User,
  Code, Terminal, ChevronLeft, PanelLeft, Maximize2,
  Minimize2, X,
} from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"
import { MOCK_CHATS } from "@/lib/mock-ui-data"

type Message = (typeof MOCK_CHATS)[number]["messages"][number]
type Chat    = (typeof MOCK_CHATS)[number]

// ─── Message renderer ────────────────────────────────────────────
function MessageContent({ content }: { content: string }) {
  return (
    <div className="space-y-2">
      {content.split("\n").map((line, i) => {
        if (line.startsWith("```")) {
          return (
            <pre key={i} className="my-2 p-3 rounded-md overflow-x-auto text-xs font-mono" style={{ backgroundColor: "#efeadf", border: "1px solid #d8d2c4" }}>
              <code>{line.replace(/```\w*/, "")}</code>
            </pre>
          )
        }
        if (/^\d+\./.test(line)) {
          return <li key={i} className="ml-4 text-sm leading-relaxed">{line.replace(/^\d+\.\s\*\*(.*?)\*\*/, "$1").replace(/^\d+\.\s/, "")}</li>
        }
        if (line.startsWith("**") && line.endsWith("**")) {
          return <p key={i} className="text-sm font-semibold leading-snug mt-3 first:mt-0">{line.replace(/\*\*/g, "")}</p>
        }
        if (!line.trim()) return null
        return <p key={i} className="text-sm leading-relaxed">{line.replace(/\*\*(.*?)\*\*/g, "$1")}</p>
      })}
    </div>
  )
}

// ─── Single message bubble ────────────────────────────────────────
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user"
  return (
    <div className={`flex gap-3 max-w-3xl mx-auto ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={isUser
          ? { backgroundColor: "#efeadf", border: "1px solid #d8d2c4" }
          : { backgroundColor: "#2d5a4f" }
        }
      >
        {isUser
          ? <User size={15} style={{ color: "#6b6357" }} />
          : <Bot size={15} style={{ color: "#fbfaf6" }} />
        }
      </div>

      <div className={`flex flex-col max-w-[80%] ${isUser ? "items-end" : "items-start"}`}>
        {/* Model badge */}
        {!isUser && (msg as any).model && (
          <span className="text-[10px] uppercase tracking-wider font-medium mb-1 ml-1" style={{ color: "#2d5a4f" }}>
            {(msg as any).model}
          </span>
        )}

        {/* Tool call chips */}
        {!isUser && (msg as any).toolCalls?.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {(msg as any).toolCalls.map((tool: string, idx: number) => (
              <span
                key={idx}
                className="badge badge-neutral text-[10px] flex items-center gap-1"
                style={{ backgroundColor: "#f6f3ec", border: "1px solid #e8e2d4" }}
              >
                <Terminal size={10} style={{ color: "#2d5a4f" }} /> {tool}
              </span>
            ))}
          </div>
        )}

        {/* Bubble */}
        <div
          className="p-4 rounded-2xl"
          style={isUser
            ? { backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }
            : { color: "#1a1714" }
          }
        >
          <MessageContent content={msg.content} />
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────
export default function ChatPage() {
  const { setOpen: setSidebarOpen, open: sidebarOpen } = useSidebar()
  const [activeChatId, setActiveChatId]         = useState(MOCK_CHATS[0].id)
  const [isConvListCollapsed, setConvListCollapsed] = useState(false)
  const [isContextDismissed, setContextDismissed]   = useState(false)
  const [inputValue, setInputValue]             = useState("")

  // Collapse the nav sidebar when entering chat — the conversation list
  // takes over that role. Restore it when leaving.
  useEffect(() => {
    setSidebarOpen(false)
    return () => setSidebarOpen(true)
  }, [setSidebarOpen])

  const activeChat = MOCK_CHATS.find((c) => c.id === activeChatId) ?? MOCK_CHATS[0]
  const isFocusMode = !sidebarOpen && isConvListCollapsed

  const toggleFocus = () => {
    if (isFocusMode) {
      setSidebarOpen(true)
      setConvListCollapsed(false)
    } else {
      setSidebarOpen(false)
      setConvListCollapsed(true)
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Conversation list (collapsible) ───────────────────── */}
      <div
        className={`border-r bg-canvas hidden lg:flex flex-col transition-all duration-300 ease-out overflow-hidden shrink-0 ${isConvListCollapsed ? "w-0 border-r-0" : "w-64"}`}
        style={{ borderColor: "#d8d2c4" }}
      >
        {/* List header */}
        <div
          className="px-3 py-3 border-b flex items-center gap-2 shrink-0 min-w-[256px]"
          style={{ borderColor: "#d8d2c4" }}
        >
          <button
            className="flex-1 flex items-center justify-center gap-2 btn-secondary text-sm"
            style={{ backgroundColor: "#fbfaf6" }}
          >
            <Plus size={15} /> New Chat
          </button>
          <button
            onClick={() => setConvListCollapsed(true)}
            className="p-1.5 rounded-md transition-colors shrink-0"
            style={{ color: "#948a7b" }}
            title="Collapse conversations"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1a1714"; (e.currentTarget as HTMLElement).style.backgroundColor = "#efeadf" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#948a7b"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-w-[256px]">
          {MOCK_CHATS.map((chat) => (
            <button
              key={chat.id}
              onClick={() => setActiveChatId(chat.id)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm truncate transition-colors ${
                activeChatId === chat.id
                  ? "font-medium shadow-sm"
                  : "text-ink-muted hover:bg-surface-2"
              }`}
              style={activeChatId === chat.id
                ? { backgroundColor: "#fbfaf6", border: "1px solid #d8d2c4", color: "#1a1714" }
                : {}
              }
            >
              {chat.title}
            </button>
          ))}
        </div>
      </div>

      {/* ── Chat area ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col relative" style={{ backgroundColor: "#fbfaf6" }}>
        {/* Chat toolbar */}
        <div
          className="h-11 border-b px-3 flex items-center justify-between gap-2 z-20 shrink-0"
          style={{ borderColor: "#d8d2c4", backgroundColor: "rgba(251,250,246,0.95)", backdropFilter: "blur(4px)" }}
        >
          <div className="flex items-center gap-1 min-w-0">
            {/* Expand conv list button — visible when collapsed */}
            {isConvListCollapsed && (
              <button
                onClick={() => setConvListCollapsed(false)}
                className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors text-xs font-medium shrink-0"
                style={{ color: "#948a7b" }}
                title="Show conversations"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1a1714"; (e.currentTarget as HTMLElement).style.backgroundColor = "#efeadf" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#948a7b"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
              >
                <PanelLeft size={15} />
                <span>Chats</span>
              </button>
            )}

            {/* Chat title */}
            <h1
              className="text-sm font-medium truncate ml-1"
              style={{ fontFamily: "var(--font-heading), serif", color: "#1a1714" }}
            >
              {activeChat.title}
            </h1>
          </div>

          {/* Focus mode toggle */}
          <button
            onClick={toggleFocus}
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors shrink-0"
            style={isFocusMode
              ? { backgroundColor: "#e3ede9", color: "#2d5a4f" }
              : { color: "#948a7b" }
            }
            title={isFocusMode ? "Exit focus mode" : "Enter focus mode"}
            onMouseEnter={e => { if (!isFocusMode) { (e.currentTarget as HTMLElement).style.color = "#1a1714"; (e.currentTarget as HTMLElement).style.backgroundColor = "#efeadf" } }}
            onMouseLeave={e => { if (!isFocusMode) { (e.currentTarget as HTMLElement).style.color = "#948a7b"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" } }}
          >
            {isFocusMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isFocusMode ? "Exit focus" : "Focus"}
          </button>
        </div>

        {/* Context bar (dismissable) */}
        {!isContextDismissed && (
          <div
            className="border-b px-4 py-2 flex items-center gap-2 text-xs shrink-0"
            style={{ borderColor: "#e8e2d4", backgroundColor: "rgba(246,243,236,0.9)", backdropFilter: "blur(4px)" }}
          >
            <span className="font-medium" style={{ color: "#6b6357" }}>Context:</span>
            <span className="badge badge-neutral flex items-center gap-1 text-[10px]">
              <Terminal size={10} /> Q2 Review Meeting
            </span>
            <span className="badge badge-neutral flex items-center gap-1 text-[10px]">
              <Code size={10} /> frontend-repo
            </span>
            <button
              onClick={() => setContextDismissed(true)}
              className="ml-auto p-1 rounded transition-colors"
              style={{ color: "#948a7b" }}
              title="Hide context bar"
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1a1714"; (e.currentTarget as HTMLElement).style.backgroundColor = "#efeadf" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#948a7b"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeChat.messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
        </div>

        {/* Input area */}
        <div className="p-4 shrink-0" style={{ backgroundColor: "#f6f3ec", borderTop: "1px solid #d8d2c4" }}>
          <div className="max-w-3xl mx-auto">
            <div
              className="rounded-xl shadow-sm transition-all p-2"
              style={{ backgroundColor: "#fbfaf6", border: "1px solid #d8d2c4" }}
              onFocus={e => (e.currentTarget.style.borderColor = "#2d5a4f")}
              onBlur={e => (e.currentTarget.style.borderColor = "#d8d2c4")}
            >
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) setInputValue("") }}
                className="w-full bg-transparent border-none focus:ring-0 resize-none p-2 text-sm focus:outline-none"
                style={{ minHeight: 60, maxHeight: 200, color: "#1a1714" }}
                placeholder="Ask anything or command an agent…"
              />
              <div className="flex justify-between items-center mt-1 px-1">
                <div className="flex gap-1" style={{ color: "#6b6357" }}>
                  {[
                    { icon: Paperclip, title: "Attach file" },
                    { icon: Camera,    title: "Take photo" },
                    { icon: Mic,       title: "Voice memo" },
                  ].map(({ icon: Icon, title }) => (
                    <button
                      key={title}
                      title={title}
                      className="p-1.5 rounded-md transition-colors"
                      onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
                      onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      <Icon size={17} />
                    </button>
                  ))}
                </div>
                <button
                  className="p-2 rounded-lg transition-colors"
                  style={{ backgroundColor: "#2d5a4f", color: "#fbfaf6" }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                >
                  <Send size={15} />
                </button>
              </div>
            </div>
            <p className="text-center mt-2 text-[10px]" style={{ color: "#948a7b" }}>
              TARS can make mistakes. Verify important information.
            </p>
          </div>
        </div>

        {/* Floating "Show context" button (when dismissed) */}
        {isContextDismissed && (
          <button
            onClick={() => setContextDismissed(false)}
            className="absolute top-12 right-3 px-2.5 py-1 rounded-full text-[10px] font-medium transition-colors shadow-sm"
            style={{ backgroundColor: "#fbfaf6", border: "1px solid #d8d2c4", color: "#6b6357" }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(45,90,79,0.4)")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "#d8d2c4")}
          >
            Show context
          </button>
        )}
      </div>
    </div>
  )
}
