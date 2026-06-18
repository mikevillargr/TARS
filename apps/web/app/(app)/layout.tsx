"use client"

import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { Plus, Search, MessageSquare, CheckSquare, CalendarDays, Brain, MoreHorizontal, Mic, Loader2, Bell, BellOff } from "lucide-react"
import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useVoiceInput } from "@/hooks/useVoiceInput"
import { SelectionToolbar } from "@/components/chat/SelectionToolbar"
import { CaptureModal } from "@/components/second-brain/CaptureModal"
import { CommandPalette } from "@/components/shell/CommandPalette"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"
import { NotificationProvider, useNotificationContext } from "@/context/NotificationContext"
import { ContactPopupProvider } from "@/context/ContactPopupContext"

// ─── Notification sound (Web Audio API — no file needed) ────────────────────

function playNotificationChime() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    // Two-note rising chime: C5 → E5
    const notes = [523.25, 659.25]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = "sine"
      osc.frequency.value = freq
      const start = now + i * 0.18
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.18, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.55)
      osc.start(start)
      osc.stop(start + 0.6)
    })
    // Auto-close context after sound finishes
    setTimeout(() => ctx.close(), 1500)
  } catch {
    // AudioContext blocked or unavailable — silently skip
  }
}

// ─── Bottom tab bar ──────────────────────────────────────────────────────────

function BottomTabBar() {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()
  const { hasUnread } = useNotificationContext()
  const onChat = pathname.startsWith("/chat")

  const tabs = [
    { label: "Chat",        href: "/chat",         Icon: MessageSquare },
    { label: "Tasks",       href: "/tasks",        Icon: CheckSquare },
    { label: "Calendar",    href: "/calendar",     Icon: CalendarDays },
    { label: "Brain",       href: "/second-brain", Icon: Brain },
  ]

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t flex items-stretch"
      style={{
        backgroundColor: "color-mix(in srgb, var(--c-surface) 97%, transparent)",
        backdropFilter: "blur(12px)",
        borderColor: "var(--c-border)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {tabs.map(({ label, href, Icon }) => {
        const active = pathname.startsWith(href)
        const showDot = label === "Chat" && hasUnread && !onChat
        return (
          <Link
            key={href}
            href={href}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative"
            style={{ color: active ? "var(--c-moss)" : "var(--c-ink-faint)", minHeight: "56px" }}
          >
            <div className="relative">
              <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
              {showDot && (
                <span
                  className="absolute -top-0.5 -right-1 w-2 h-2 rounded-full border-2"
                  style={{
                    backgroundColor: "var(--c-moss)",
                    borderColor: "var(--c-surface)",
                  }}
                />
              )}
            </div>
            <span
              className="text-[10px] font-medium leading-none"
              style={{ color: active ? "var(--c-moss)" : "var(--c-ink-faint)" }}
            >
              {label}
            </span>
            {active && (
              <span
                className="absolute bottom-0 w-10 h-0.5 rounded-full"
                style={{ backgroundColor: "var(--c-moss)" }}
              />
            )}
          </Link>
        )
      })}

      {/* More → opens sidebar drawer */}
      <button
        onClick={() => setOpenMobile(true)}
        className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative"
        style={{ color: "var(--c-ink-faint)", minHeight: "56px" }}
      >
        <MoreHorizontal size={22} strokeWidth={1.8} />
        <span className="text-[10px] font-medium leading-none" style={{ color: "var(--c-ink-faint)" }}>
          More
        </span>
      </button>
    </nav>
  )
}

// ─── Inner layout (consumes notification context) ───────────────────────────

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const [captureOpen, setCaptureOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const voice = useVoiceInput()

  const { hasUnread, clearUnread, subscribe } = useNotificationContext()

  // Sound on/off — persisted in localStorage
  const [soundOn, setSoundOn] = useState(true)
  useEffect(() => {
    const stored = localStorage.getItem("tars_sound")
    if (stored !== null) setSoundOn(stored === "1")
  }, [])
  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev
      localStorage.setItem("tars_sound", next ? "1" : "0")
      return next
    })
  }, [])

  // Request browser Notification permission once on mount (non-intrusive)
  useEffect(() => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      // Delay slightly so it doesn't fire immediately on page load
      const t = setTimeout(() => Notification.requestPermission(), 4000)
      return () => clearTimeout(t)
    }
  }, [])

  // Clear global unread when on chat page
  useEffect(() => {
    if (pathname.startsWith("/chat")) clearUnread()
  }, [pathname, clearUnread])

  // Notification handler — audio chime + browser notification only (no toast)
  const soundOnRef = useRef(soundOn)
  useEffect(() => { soundOnRef.current = soundOn })

  useEffect(() => {
    const unsub = subscribe((notif) => {
      if (notif.type !== "new_message") return

      // Audio chime
      if (soundOnRef.current) playNotificationChime()

      // Browser / PWA system notification when tab is not focused
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        document.visibilityState !== "visible"
      ) {
        const n = new Notification("TARS", {
          body: notif.preview || "New message from TARS",
          icon: "/icon-192.png",
          tag: notif.conversation_id,
        })
        n.onclick = () => {
          window.focus()
          router.push(`/chat?open=${notif.conversation_id}`)
          n.close()
        }
      }
    })
    return unsub
  }, [subscribe, router])

  // Mobile header mic: records, then navigates to /chat?ask=<text> which AskLoader auto-sends
  const handleHeaderMicTap = useCallback(() => {
    if (voice.state === "recording") {
      voice.stop()
      return
    }
    if (voice.state !== "idle" && voice.state !== "error") return
    voice.start((text) => {
      if (!text) return
      router.push(`/chat?ask=${encodeURIComponent(text)}`)
    })
  }, [voice, router])

  // Auto-detect browser timezone on mount and silently sync to server
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!detected) return
    fetch("/api/proxy/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timezone: detected }),
    }).catch(() => {})
  }, [])

  // Global Cmd+K / Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setCmdOpen(prev => !prev)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])

  return (
    <>
    <SidebarProvider>
      <AppSidebar />
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Topbar — min-height so it expands to cover the status bar safe area on iOS */}
        <header
          className="border-b flex items-center justify-between px-4 shrink-0 backdrop-blur-sm z-10"
          style={{
            borderColor: "var(--c-border)",
            backgroundColor: "color-mix(in srgb, var(--c-surface) 80%, transparent)",
            paddingTop: "env(safe-area-inset-top, 0px)",
            minHeight: "calc(3.5rem + env(safe-area-inset-top, 0px))",
          }}
        >
          <div className="flex items-center gap-2 flex-1">
            <SidebarTrigger className="size-7 text-ink-muted hover:text-ink" />
            <button
              onClick={() => setCmdOpen(true)}
              className="relative max-w-md w-full hidden sm:flex items-center gap-2 ml-2 rounded-full pl-3 pr-3 py-1.5 text-sm transition-all text-left"
              style={{
                backgroundColor: "var(--c-surface-2)",
                border: "1px solid var(--c-border)",
                color: "var(--c-ink-faint)",
              }}
            >
              <Search size={14} className="shrink-0" />
              <span className="flex-1">Ask TARS or search…</span>
              <kbd
                className="hidden lg:inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0"
                style={{ backgroundColor: "var(--c-surface)", border: "1px solid var(--c-border)", color: "var(--c-ink-faint)" }}
              >
                ⌘K
              </kbd>
            </button>
          </div>

          <div className="flex items-center gap-3">
            {/* Mobile search icon */}
            <button
              onClick={() => setCmdOpen(true)}
              className="sm:hidden p-2 rounded-lg"
              style={{ color: "var(--c-ink-muted)" }}
              title="Search"
            >
              <Search size={18} />
            </button>

            {/* 8-bit TARS monolith pixel art — 8×12 pixel grid at 3px each */}
            <div className="hidden sm:flex items-center" aria-hidden="true" title="TARS">
              <svg width="24" height="36" viewBox="0 0 24 36" xmlns="http://www.w3.org/2000/svg" shapeRendering="crispEdges">
                {/* Top cap */}
                <rect x="0" y="0" width="24" height="3" fill="var(--c-moss)"/>
                {/* Segment 1 outer shell */}
                <rect x="0" y="3" width="3" height="12" fill="var(--c-moss)"/>
                <rect x="21" y="3" width="3" height="12" fill="var(--c-moss)"/>
                {/* Segment 1 inner cavity */}
                <rect x="3" y="3" width="18" height="12" fill="#0f1a15"/>
                {/* Segment 1 amber LED (centered, 2px tall) */}
                <rect x="9" y="6" width="6" height="6" fill="var(--c-amber)"/>
                {/* Joint band */}
                <rect x="0" y="15" width="24" height="6" fill="#0a1210"/>
                {/* Segment 2 outer shell */}
                <rect x="0" y="21" width="3" height="12" fill="var(--c-moss)"/>
                <rect x="21" y="21" width="3" height="12" fill="var(--c-moss)"/>
                {/* Segment 2 inner cavity */}
                <rect x="3" y="21" width="18" height="12" fill="#0f1a15"/>
                {/* Segment 2 amber LED */}
                <rect x="9" y="24" width="6" height="6" fill="var(--c-amber)"/>
                {/* Bottom cap */}
                <rect x="0" y="33" width="24" height="3" fill="var(--c-moss)"/>
              </svg>
            </div>

            {/* Sound toggle */}
            <button
              onClick={toggleSound}
              className="p-2 rounded-lg transition-opacity hover:opacity-70"
              style={{ color: soundOn ? "var(--c-ink-muted)" : "var(--c-ink-faint)" }}
              title={soundOn ? "Mute notifications" : "Unmute notifications"}
              aria-label={soundOn ? "Mute notifications" : "Unmute notifications"}
            >
              {soundOn ? <Bell size={17} /> : <BellOff size={17} />}
            </button>

            {/* Mobile-only voice new-chat button */}
            <button
              onClick={handleHeaderMicTap}
              disabled={voice.state === "transcribing"}
              className="sm:hidden p-2.5 rounded-xl relative"
              style={{
                color: voice.state === "recording" ? "var(--c-rose)" : "var(--c-ink-muted)",
                opacity: voice.state === "transcribing" ? 0.5 : 1,
              }}
              title={voice.state === "recording" ? "Tap to stop" : "New voice chat"}
            >
              {voice.state === "transcribing"
                ? <Loader2 size={22} className="animate-spin" />
                : <Mic size={22} className={voice.state === "recording" ? "animate-pulse" : ""} />
              }
              {voice.state === "recording" && (
                <span className="absolute inset-0 rounded-lg animate-ping"
                  style={{ backgroundColor: "var(--c-rose)", opacity: 0.15 }} />
              )}
            </button>

            <button
              onClick={() => setCaptureOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer hover:opacity-80"
              style={{ backgroundColor: "var(--c-ink)", color: "var(--c-canvas)" }}
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Capture</span>
            </button>
          </div>
        </header>

        {/* Page content — safe-area-aware bottom padding so content clears the tab bar + home indicator */}
        {/* min-w-0 + overflow-x-hidden enforce a hard horizontal boundary for every (app) page */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col pb-safe-tab lg:pb-0" style={{ maxWidth: "100%" }}>{children}</div>
      </main>

      {/* Bottom tab bar — sits outside <main> so it overlays correctly */}
      <BottomTabBar />

      {/* Global selection toolbar — fires on [data-selectable] regions across all pages */}
      <SelectionToolbar />

      {/* Global Capture modal */}
      <CaptureModal
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        defaultTab="file"
      />

      {/* Global Command Palette */}
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />

    </SidebarProvider>
    </>
  )
}

// ─── Root layout ─────────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <NotificationProvider>
      <ConfirmProvider>
        <ContactPopupProvider>
          <AppLayoutInner>{children}</AppLayoutInner>
        </ContactPopupProvider>
      </ConfirmProvider>
    </NotificationProvider>
  )
}
