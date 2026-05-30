"use client"

import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { Bell, Plus, Search, MessageSquare, CheckSquare, CalendarDays, Brain, MoreHorizontal, Mic, Loader2 } from "lucide-react"
import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useVoiceInput } from "@/hooks/useVoiceInput"
import { SelectionToolbar } from "@/components/chat/SelectionToolbar"
import { CaptureModal } from "@/components/second-brain/CaptureModal"
import { useTheme } from "@/components/ThemeProvider"
import { CommandPalette } from "@/components/shell/CommandPalette"
import { ConfirmProvider } from "@/components/ui/confirm-dialog"

// Bottom tab bar — rendered inside SidebarProvider so it can call useSidebar()
function BottomTabBar() {
  const pathname = usePathname()
  const { setOpenMobile } = useSidebar()

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
        return (
          <Link
            key={href}
            href={href}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors"
            style={{ color: active ? "var(--c-moss)" : "var(--c-ink-faint)", minHeight: "56px" }}
          >
            <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
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

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [agentActive] = useState(true)
  const [captureOpen, setCaptureOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const { theme, toggle: toggleTheme } = useTheme()
  const router = useRouter()
  const voice = useVoiceInput()

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
    <ConfirmProvider>
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

            {agentActive && (
              <div
                className="flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-medium hidden sm:flex"
                style={{
                  backgroundColor: "var(--c-moss-soft)",
                  borderColor: "color-mix(in srgb, var(--c-moss) 25%, transparent)",
                  color: "var(--c-moss)",
                }}
              >
                <span className="w-2 h-2 rounded-full bg-moss animate-pulse" />
                Agent Active
              </div>
            )}

            <button className="p-2 relative" style={{ color: "var(--c-ink-muted)" }}>
              <Bell size={20} />
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full border-2"
                style={{ backgroundColor: "var(--c-amber)", borderColor: "var(--c-surface)" }}
              />
            </button>

            {/* Mobile-only voice new-chat button */}
            <button
              onClick={handleHeaderMicTap}
              disabled={voice.state === "transcribing"}
              className="sm:hidden p-2 rounded-lg relative"
              style={{
                color: voice.state === "recording" ? "var(--c-rose)" : "var(--c-ink-muted)",
                opacity: voice.state === "transcribing" ? 0.5 : 1,
              }}
              title={voice.state === "recording" ? "Tap to stop" : "New voice chat"}
            >
              {voice.state === "transcribing"
                ? <Loader2 size={18} className="animate-spin" />
                : <Mic size={18} className={voice.state === "recording" ? "animate-pulse" : ""} />
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
    </ConfirmProvider>
  )
}
