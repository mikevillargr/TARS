"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import {
  Send, Paperclip, Camera, Mic, Plus, Bot, User,
  Code, Terminal, ChevronLeft, PanelLeft, Maximize2,
  Minimize2, X, Calendar, CheckSquare, Loader2, Menu,
  Square, Trash2,
} from "lucide-react"
import { useSidebar } from "@/components/ui/sidebar"
import { apiGet, apiPost, apiDelete } from "@/lib/api-client"

// ─── Types ────────────────────────────────────────────────────────
interface Conversation {
  id: string
  title: string | null
  created_at: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  model_used?: string
  tool_calls?: string[]
  created_at: string
}

interface StreamingMsg {
  role: "assistant"
  content: string
  streaming: true
}

interface TaskSuggestion {
  tool_use_id: string
  title: string
  description?: string
  priority?: "urgent" | "high" | "normal" | "low"
  due_at?: string
}

interface CalendarSuggestion {
  tool_use_id: string
  title: string
  datetime_iso: string
  duration_min?: number
  description?: string
  location?: string
}

function formatSuggestTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
  } catch { return iso }
}

function CalendarSuggestChip({ suggestion, onDismiss }: { suggestion: CalendarSuggestion; onDismiss: () => void }) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState(false)

  async function addToCalendar() {
    setAdding(true)
    try {
      await apiPost("/calendar/events", {
        title: suggestion.title,
        start: suggestion.datetime_iso,
        duration_min: suggestion.duration_min ?? 60,
        description: suggestion.description,
        location: suggestion.location,
      })
      setAdded(true)
    } catch (err) {
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  if (added) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs max-w-sm" style={{ backgroundColor: "#e3ede9", border: "1px solid rgba(45,90,79,0.2)" }}>
        <Calendar size={12} style={{ color: "#2d5a4f", flexShrink: 0 }} />
        <span className="flex-1 font-medium" style={{ color: "#2d5a4f" }}>Added to calendar</span>
        <button onClick={onDismiss} style={{ color: "#948a7b" }}><X size={11} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs max-w-sm" style={{ backgroundColor: "#f6f3ec", border: "1px solid #e8e2d4" }}>
      <Calendar size={12} style={{ color: "#2d5a4f", flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <span className="font-medium" style={{ color: "#1a1714" }}>{suggestion.title}</span>
        <span className="ml-1.5" style={{ color: "#948a7b" }}>{formatSuggestTime(suggestion.datetime_iso)}</span>
      </div>
      <button
        onClick={addToCalendar}
        disabled={adding}
        className="shrink-0 font-medium disabled:opacity-50 flex items-center gap-1"
        style={{ color: "#2d5a4f" }}
        onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
        onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
      >
        {adding ? <Loader2 size={10} className="animate-spin" /> : null}
        Add to Calendar
      </button>
      <button onClick={onDismiss} style={{ color: "#948a7b" }}><X size={11} /></button>
    </div>
  )
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#a04848",
  high:   "#b07030",
  normal: "#2d5a4f",
  low:    "#948a7b",
}

function TaskSuggestChip({ suggestion, onDismiss }: { suggestion: TaskSuggestion; onDismiss: () => void }) {
  const [adding, setAdding] = useState(false)
  const [added, setAdded]   = useState(false)

  async function addTask() {
    setAdding(true)
    try {
      await apiPost("/tasks", {
        title:       suggestion.title,
        description: suggestion.description,
        priority:    suggestion.priority ?? "normal",
        due_at:      suggestion.due_at ?? null,
      })
      setAdded(true)
    } catch (err) {
      console.error(err)
    } finally {
      setAdding(false)
    }
  }

  const priorityColor = PRIORITY_COLORS[suggestion.priority ?? "normal"]

  if (added) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs max-w-sm" style={{ backgroundColor: "#e3ede9", border: "1px solid rgba(45,90,79,0.2)" }}>
        <CheckSquare size={12} style={{ color: "#2d5a4f", flexShrink: 0 }} />
        <span className="flex-1 font-medium" style={{ color: "#2d5a4f" }}>Added to tasks</span>
        <button onClick={onDismiss} style={{ color: "#948a7b" }}><X size={11} /></button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs max-w-sm" style={{ backgroundColor: "#f6f3ec", border: "1px solid #e8e2d4" }}>
      <CheckSquare size={12} style={{ color: priorityColor, flexShrink: 0 }} />
      <div className="flex-1 min-w-0">
        <span className="font-medium" style={{ color: "#1a1714" }}>{suggestion.title}</span>
        {suggestion.priority && suggestion.priority !== "normal" && (
          <span className="ml-1.5 uppercase text-[9px] font-semibold tracking-wider" style={{ color: priorityColor }}>
            {suggestion.priority}
          </span>
        )}
        {suggestion.due_at && (
          <span className="ml-1.5" style={{ color: "#948a7b" }}>
            due {new Date(suggestion.due_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </span>
        )}
      </div>
      <button
        onClick={addTask}
        disabled={adding}
        className="shrink-0 font-medium disabled:opacity-50 flex items-center gap-1"
        style={{ color: "#2d5a4f" }}
        onMouseEnter={e => (e.currentTarget.style.textDecoration = "underline")}
        onMouseLeave={e => (e.currentTarget.style.textDecoration = "none")}
      >
        {adding ? <Loader2 size={10} className="animate-spin" /> : null}
        Add Task
      </button>
      <button onClick={onDismiss} style={{ color: "#948a7b" }}><X size={11} /></button>
    </div>
  )
}

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
function MessageBubble({ msg }: { msg: Message | StreamingMsg }) {
  const isUser = msg.role === "user"
  const toolCalls = !isUser && "tool_calls" in msg ? msg.tool_calls : undefined

  return (
    <div className={`flex gap-3 max-w-3xl mx-auto ${isUser ? "flex-row-reverse" : ""}`}>
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
        {!isUser && "model_used" in msg && msg.model_used && (
          <span className="text-[10px] uppercase tracking-wider font-medium mb-1 ml-1" style={{ color: "#2d5a4f" }}>
            {msg.model_used}
          </span>
        )}

        {toolCalls && toolCalls.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {toolCalls.map((tool, idx) => (
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

        <div
          className="p-4 rounded-2xl"
          style={isUser
            ? { backgroundColor: "#f6f3ec", border: "1px solid #d8d2c4", color: "#1a1714" }
            : { color: "#1a1714" }
          }
        >
          <MessageContent content={msg.content} />
          {"streaming" in msg && (
            <span className="inline-flex items-center gap-0.5 ml-1 align-middle">
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "rgba(45,90,79,0.55)", animationDelay: "0ms" }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "rgba(45,90,79,0.55)", animationDelay: "160ms" }} />
              <span className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ backgroundColor: "rgba(45,90,79,0.55)", animationDelay: "320ms" }} />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────
export default function ChatPage() {
  const { setOpen: setSidebarOpen, open: sidebarOpen } = useSidebar()
  const [conversations, setConversations]           = useState<Conversation[]>([])
  const [activeChatId, setActiveChatId]             = useState<string | null>(null)
  const [messages, setMessages]                     = useState<Message[]>([])
  const [streaming, setStreaming]                   = useState<StreamingMsg | null>(null)
  const [busy, setBusy]                             = useState(false)
  const [calendarSuggestions, setCalendarSuggestions] = useState<CalendarSuggestion[]>([])
  const [taskSuggestions, setTaskSuggestions]         = useState<TaskSuggestion[]>([])
  const [isConvListCollapsed, setConvListCollapsed] = useState(false)
  const [mobileConvOpen, setMobileConvOpen]         = useState(false)
  const [isContextDismissed, setContextDismissed]   = useState(false)
  const [inputValue, setInputValue]                 = useState("")
  const [attachments, setAttachments]               = useState<File[]>([])
  const messagesEndRef                              = useRef<HTMLDivElement>(null)
  const fileInputRef                                = useRef<HTMLInputElement>(null)
  const cameraInputRef                              = useRef<HTMLInputElement>(null)
  const activeChatIdRef                             = useRef<string | null>(activeChatId)
  const abortControllerRef                          = useRef<AbortController | null>(null)
  const pollTimerRef                                = useRef<ReturnType<typeof setInterval> | null>(null)
  const accumulatedRef                              = useRef<string>("")  // live text during streaming

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    setAttachments(prev => [...prev, ...picked])
    e.target.value = ""
  }

  // Cancel any in-flight fetch or poll on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [])

  // Keep ref in sync; cancel in-flight request + poll when switching conversations
  useEffect(() => {
    abortControllerRef.current?.abort()
    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    activeChatIdRef.current = activeChatId
    setStreaming(null)
    setBusy(false)
    setCalendarSuggestions([])
    setTaskSuggestions([])
  }, [activeChatId])

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, streaming?.content])

  // Load conversation list and auto-select the most recent one
  useEffect(() => {
    apiGet<Conversation[]>("/chat/conversations")
      .then((convs) => {
        setConversations(convs)
        if (convs.length > 0 && !activeChatIdRef.current) {
          setActiveChatId(convs[0].id)
        }
      })
      .catch(console.error)
  }, [])

  // Load messages when active conversation changes.
  // If the last message is from the user and recent, the server is still generating —
  // show a loading indicator and poll until the assistant response lands.
  useEffect(() => {
    if (!activeChatId) { setMessages([]); return }

    const chatId = activeChatId

    apiGet<{ id: string; title: string | null; messages: Message[] }>(`/chat/conversations/${chatId}`)
      .then((d) => {
        if (chatId !== activeChatIdRef.current) return
        setMessages(d.messages)
        if (d.title) {
          setConversations((prev) => prev.map((c) =>
            c.id === chatId ? { ...c, title: d.title } : c
          ))
        }

        // If last message is from user and was sent in the last 10 minutes,
        // the server is still generating — show loading and poll.
        const msgs = d.messages
        const lastMsg = msgs[msgs.length - 1]
        const recentThreshold = 10 * 60 * 1000
        const isRecent = lastMsg && (Date.now() - new Date(lastMsg.created_at).getTime()) < recentThreshold
        if (lastMsg?.role === "user" && isRecent) {
          setBusy(true)
          setStreaming({ role: "assistant", content: "", streaming: true })

          let attempts = 0
          const MAX_ATTEMPTS = 60 // 2 minutes at 2s intervals
          pollTimerRef.current = setInterval(async () => {
            attempts++
            if (chatId !== activeChatIdRef.current || attempts > MAX_ATTEMPTS) {
              clearInterval(pollTimerRef.current!)
              if (chatId === activeChatIdRef.current) {
                setStreaming(null)
                setBusy(false)
              }
              return
            }
            try {
              const fresh = await apiGet<{ id: string; title: string | null; messages: Message[] }>(
                `/chat/conversations/${chatId}`
              )
              const freshLast = fresh.messages[fresh.messages.length - 1]
              if (freshLast?.role === "assistant") {
                clearInterval(pollTimerRef.current!)
                if (chatId === activeChatIdRef.current) {
                  setMessages(fresh.messages)
                  setStreaming(null)
                  setBusy(false)
                  if (fresh.title) {
                    setConversations((prev) => prev.map((c) =>
                      c.id === chatId ? { ...c, title: fresh.title } : c
                    ))
                  }
                }
              }
            } catch { /* keep polling */ }
          }, 2000)
        }
      })
      .catch(console.error)

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [activeChatId])

  const activeChat = conversations.find((c) => c.id === activeChatId)
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

  async function handleNewChat() {
    try {
      const conv = await apiPost<Conversation>("/chat/conversations")
      setConversations((prev) => [conv, ...prev])
      setActiveChatId(conv.id)
      setMessages([])
    } catch (err) {
      console.error(err)
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort()
    // State cleanup is handled by the AbortError catch block in handleSend
  }

  async function handleDeleteConversation(convId: string, e: React.MouseEvent) {
    e.stopPropagation()  // don't select the conversation when clicking delete
    try {
      await apiDelete(`/chat/conversations/${convId}`)
      setConversations(prev => {
        const remaining = prev.filter(c => c.id !== convId)
        // If we deleted the active conversation, switch to the next one
        if (convId === activeChatIdRef.current) {
          const next = remaining[0] ?? null
          setActiveChatId(next?.id ?? null)
          if (!next) setMessages([])
        }
        return remaining
      })
    } catch (err) {
      console.error(err)
    }
  }

  const handleSend = useCallback(async () => {
    const content = inputValue.trim()
    if (busy || (!content && attachments.length === 0)) return

    // If no active conversation, create one first
    let chatId = activeChatId
    if (!chatId) {
      try {
        const conv = await apiPost<Conversation>("/chat/conversations")
        setConversations((prev) => [conv, ...prev])
        setActiveChatId(conv.id)
        chatId = conv.id
      } catch (err) {
        console.error(err)
        return
      }
    }

    setBusy(true)
    setInputValue("")
    setCalendarSuggestions([])
    setTaskSuggestions([])
    const pendingAttachments = attachments
    setAttachments([])

    const tempUser: Message = {
      id: `temp-${Date.now()}`,
      role: "user",
      content,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, tempUser])
    setStreaming({ role: "assistant", content: "", streaming: true })

    try {
      const fd = new FormData()
      fd.append("content", content)
      for (const f of pendingAttachments) fd.append("files", f)

      const controller = new AbortController()
      abortControllerRef.current = controller

      const res = await fetch(`/api/proxy/chat/conversations/${chatId}/messages`, {
        method: "POST",
        body: fd,
        signal: controller.signal,
      })

      if (!res.ok || !res.body) throw new Error("Stream failed")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let accumulated = ""
      accumulatedRef.current = ""

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
            if (evt.type === "chunk") {
              accumulated += evt.text
              accumulatedRef.current = accumulated
              // Only update UI if still on this conversation
              if (chatId === activeChatIdRef.current) {
                setStreaming({ role: "assistant", content: accumulated, streaming: true })
              }
            } else if (evt.type === "calendar_suggest") {
              if (chatId === activeChatIdRef.current) {
                setCalendarSuggestions(prev => [...prev, evt as CalendarSuggestion])
              }
            } else if (evt.type === "task_suggest") {
              if (chatId === activeChatIdRef.current) {
                setTaskSuggestions(prev => [...prev, evt as TaskSuggestion])
              }
            } else if (evt.type === "done") {
              const finalMsg: Message = {
                id: `done-${Date.now()}`,
                role: "assistant",
                content: accumulated,
                model_used: evt.model,
                created_at: new Date().toISOString(),
              }
              if (chatId === activeChatIdRef.current) {
                setMessages((prev) => [...prev.filter((m) => m.id !== tempUser.id), tempUser, finalMsg])
                setStreaming(null)
              }
              // Refresh conversation list to pick up the title (generated async after done)
              apiGet<Conversation[]>("/chat/conversations").then(setConversations).catch(console.error)
            } else if (evt.type === "error") {
              console.error("TARS stream error:", evt.error)
              if (chatId === activeChatIdRef.current) setStreaming(null)
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
      // Safety net: if stream ended without a done event, clear any stuck loading state
      if (chatId === activeChatIdRef.current) setStreaming(null)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // User hit Stop — commit whatever text arrived so far as a truncated reply
        const partial = accumulatedRef.current
        if (chatId === activeChatIdRef.current) {
          if (partial) {
            const stoppedMsg: Message = {
              id: `stopped-${Date.now()}`,
              role: "assistant",
              content: partial,
              created_at: new Date().toISOString(),
            }
            setMessages(prev => [...prev.filter(m => !m.id.startsWith("temp-")), tempUser, stoppedMsg])
          }
          setStreaming(null)
        }
        return
      }
      console.error(err)
      if (chatId === activeChatIdRef.current) setStreaming(null)
    } finally {
      setBusy(false)
    }
  }, [activeChatId, attachments, busy, inputValue])

  const allMessages = streaming ? [...messages, streaming] : messages

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Mobile conversation drawer ────────────────────────── */}
      {mobileConvOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setMobileConvOpen(false)}
          />
          <div
            className="relative flex flex-col h-full w-72 max-w-[80vw] shadow-xl z-10"
            style={{ backgroundColor: "#fbfaf6" }}
          >
            <div
              className="px-3 py-3 border-b flex items-center gap-2 shrink-0"
              style={{ borderColor: "#d8d2c4" }}
            >
              <button
                onClick={async () => { await handleNewChat(); setMobileConvOpen(false) }}
                className="flex-1 flex items-center justify-center gap-2 btn-secondary text-sm"
                style={{ backgroundColor: "#f6f3ec" }}
              >
                <Plus size={15} /> New Chat
              </button>
              <button
                onClick={() => setMobileConvOpen(false)}
                className="p-1.5 rounded-md"
                style={{ color: "#948a7b" }}
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {conversations.length === 0 ? (
                <p className="px-3 py-4 text-xs" style={{ color: "#948a7b" }}>No conversations yet.</p>
              ) : conversations.map((conv) => (
                <div key={conv.id} className="group relative flex items-center">
                  <button
                    onClick={() => { setActiveChatId(conv.id); setMobileConvOpen(false) }}
                    className={`flex-1 text-left px-3 py-2.5 rounded-md text-sm truncate transition-colors pr-9 ${
                      activeChatId === conv.id ? "font-medium shadow-sm" : "text-ink-muted"
                    }`}
                    style={activeChatId === conv.id
                      ? { backgroundColor: "#fbfaf6", border: "1px solid #d8d2c4", color: "#1a1714" }
                      : {}
                    }
                  >
                    {conv.title ?? "New conversation"}
                  </button>
                  {/* Always visible on mobile (no hover state on touch) */}
                  <button
                    onClick={(e) => { handleDeleteConversation(conv.id, e); setMobileConvOpen(false) }}
                    className="absolute right-1 p-1.5 rounded transition-colors"
                    style={{ color: "#c4b8a8" }}
                    title="Delete"
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#a04848"; (e.currentTarget as HTMLElement).style.backgroundColor = "#f0dcdc" }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#c4b8a8"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Conversation list (collapsible, desktop only) ─────── */}
      <div
        className={`border-r bg-canvas hidden lg:flex flex-col transition-all duration-300 ease-out overflow-hidden shrink-0 ${isConvListCollapsed ? "w-0 border-r-0" : "w-64"}`}
        style={{ borderColor: "#d8d2c4" }}
      >
        <div
          className="px-3 py-3 border-b flex items-center gap-2 shrink-0 min-w-[256px]"
          style={{ borderColor: "#d8d2c4" }}
        >
          <button
            onClick={handleNewChat}
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

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-w-[256px]">
          {conversations.length === 0 ? (
            <p className="px-3 py-4 text-xs" style={{ color: "#948a7b" }}>No conversations yet.</p>
          ) : conversations.map((conv) => (
            <div
              key={conv.id}
              className="group relative flex items-center"
            >
              <button
                onClick={() => setActiveChatId(conv.id)}
                className={`flex-1 text-left px-3 py-2 rounded-md text-sm truncate transition-colors pr-8 ${
                  activeChatId === conv.id ? "font-medium shadow-sm" : "text-ink-muted hover:bg-surface-2"
                }`}
                style={activeChatId === conv.id
                  ? { backgroundColor: "#fbfaf6", border: "1px solid #d8d2c4", color: "#1a1714" }
                  : {}
                }
              >
                {conv.title ?? "New conversation"}
              </button>
              <button
                onClick={(e) => handleDeleteConversation(conv.id, e)}
                className="absolute right-1 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: "#948a7b" }}
                title="Delete conversation"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#a04848"; (e.currentTarget as HTMLElement).style.backgroundColor = "#f0dcdc" }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#948a7b"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
              >
                <Trash2 size={13} />
              </button>
            </div>
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
            {/* Mobile: open conversation drawer */}
            <button
              onClick={() => setMobileConvOpen(true)}
              className="lg:hidden p-1.5 rounded-md shrink-0"
              style={{ color: "#948a7b" }}
            >
              <Menu size={18} />
            </button>
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

            <h1
              className="text-sm font-medium truncate ml-1"
              style={{ fontFamily: "var(--font-heading), serif", color: "#1a1714" }}
            >
              {activeChat?.title ?? (activeChatId ? "New conversation" : "TARS")}
            </h1>
          </div>

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

        {/* Context bar */}
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
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#1a1714"; (e.currentTarget as HTMLElement).style.backgroundColor = "#efeadf" }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#948a7b"; (e.currentTarget as HTMLElement).style.backgroundColor = "transparent" }}
            >
              <X size={12} />
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {allMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: "#948a7b" }}>
              <p className="text-2xl font-semibold" style={{ fontFamily: "var(--font-heading), serif", color: "#1a1714" }}>TARS</p>
              <p className="text-sm">What do you need?</p>
            </div>
          ) : allMessages.map((msg, i) => (
            <MessageBubble key={"id" in msg ? msg.id : `stream-${i}`} msg={msg} />
          ))}
          {(calendarSuggestions.length > 0 || taskSuggestions.length > 0) && (
            <div className="max-w-3xl mx-auto pl-11 flex flex-col gap-2">
              {calendarSuggestions.map((s) => (
                <CalendarSuggestChip
                  key={s.tool_use_id}
                  suggestion={s}
                  onDismiss={() => setCalendarSuggestions(prev => prev.filter(x => x.tool_use_id !== s.tool_use_id))}
                />
              ))}
              {taskSuggestions.map((s) => (
                <TaskSuggestChip
                  key={s.tool_use_id}
                  suggestion={s}
                  onDismiss={() => setTaskSuggestions(prev => prev.filter(x => x.tool_use_id !== s.tool_use_id))}
                />
              ))}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="p-4 shrink-0" style={{ backgroundColor: "#f6f3ec", borderTop: "1px solid #d8d2c4" }}>
          <div className="max-w-3xl mx-auto">
            {/* Attachment chips */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {attachments.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs"
                    style={{ backgroundColor: "#efeadf", border: "1px solid #d8d2c4", color: "#1a1714" }}
                  >
                    {file.type.startsWith("image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={URL.createObjectURL(file)} alt={file.name} className="size-6 rounded object-cover shrink-0" />
                    ) : (
                      <Paperclip size={11} style={{ color: "#6b6357", flexShrink: 0 }} />
                    )}
                    <span className="max-w-[120px] truncate">{file.name}</span>
                    <button
                      onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                      style={{ color: "#948a7b" }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              className="rounded-xl shadow-sm transition-all p-2"
              style={{ backgroundColor: "#fbfaf6", border: "1px solid #d8d2c4" }}
              onFocus={e => (e.currentTarget.style.borderColor = "#2d5a4f")}
              onBlur={e => (e.currentTarget.style.borderColor = "#d8d2c4")}
            >
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleSend()
                  }
                }}
                className="w-full bg-transparent border-none focus:ring-0 resize-none p-2 text-sm focus:outline-none"
                style={{ minHeight: 60, maxHeight: 200, color: "#1a1714" }}
                placeholder="Ask anything or command an agent…"
                disabled={busy}
              />
              <div className="flex justify-between items-center mt-1 px-1">
                <div className="flex gap-1" style={{ color: "#6b6357" }}>
                  <label
                    htmlFor="chat-attach-file"
                    title="Attach file"
                    className="p-1.5 rounded-md transition-colors cursor-pointer"
                    style={busy ? { opacity: 0.4, pointerEvents: "none" } : {}}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <Paperclip size={17} />
                  </label>
                  <label
                    htmlFor="chat-attach-camera"
                    title="Take photo"
                    className="p-1.5 rounded-md transition-colors cursor-pointer"
                    style={busy ? { opacity: 0.4, pointerEvents: "none" } : {}}
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <Camera size={17} />
                  </label>
                  <button
                    title="Voice memo"
                    className="p-1.5 rounded-md transition-colors"
                    onMouseEnter={e => (e.currentTarget.style.backgroundColor = "#efeadf")}
                    onMouseLeave={e => (e.currentTarget.style.backgroundColor = "transparent")}
                  >
                    <Mic size={17} />
                  </button>
                </div>
                {busy ? (
                  <button
                    onClick={handleStop}
                    className="p-2 rounded-lg transition-colors"
                    style={{ backgroundColor: "#a04848", color: "#fbfaf6" }}
                    title="Stop generating"
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                  >
                    <Square size={14} strokeWidth={0} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() && attachments.length === 0}
                    className="p-2 rounded-lg transition-colors disabled:opacity-40"
                    style={{ backgroundColor: "#2d5a4f", color: "#fbfaf6" }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                    onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                  >
                    <Send size={15} />
                  </button>
                )}
              </div>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={fileInputRef}
              id="chat-attach-file"
              type="file"
              multiple
              accept=".pdf,.docx,.txt,.md,image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <input
              ref={cameraInputRef}
              id="chat-attach-camera"
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileChange}
            />

            <p className="text-center mt-2 text-[10px]" style={{ color: "#948a7b" }}>
              TARS can make mistakes. Verify important information.
            </p>
          </div>
        </div>

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
