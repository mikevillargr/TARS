"use client"

import { SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { Bell, Plus, Search, MessageSquare, CheckSquare, CalendarDays, Brain, MoreHorizontal, Sun, Moon } from "lucide-react"
import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { SelectionToolbar } from "@/components/chat/SelectionToolbar"
import { CaptureModal } from "@/components/second-brain/CaptureModal"
import { useTheme } from "@/components/ThemeProvider"

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
            style={{ color: active ? "#2d5a4f" : "#948a7b", minHeight: "56px" }}
          >
            <Icon size={22} strokeWidth={active ? 2.2 : 1.8} />
            <span
              className="text-[10px] font-medium leading-none"
              style={{ color: active ? "#2d5a4f" : "#948a7b" }}
            >
              {label}
            </span>
            {active && (
              <span
                className="absolute bottom-0 w-10 h-0.5 rounded-full"
                style={{ backgroundColor: "#2d5a4f" }}
              />
            )}
          </Link>
        )
      })}

      {/* More → opens sidebar drawer */}
      <button
        onClick={() => setOpenMobile(true)}
        className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors relative"
        style={{ color: "#948a7b", minHeight: "56px" }}
      >
        <MoreHorizontal size={22} strokeWidth={1.8} />
        <span className="text-[10px] font-medium leading-none" style={{ color: "#948a7b" }}>
          More
        </span>
      </button>
    </nav>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [agentActive] = useState(true)
  const [captureOpen, setCaptureOpen] = useState(false)
  const { theme, toggle: toggleTheme } = useTheme()

  return (
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
            <SidebarTrigger className="size-7 text-[#6b6357] hover:text-[#1a1714]" />
            <div className="relative max-w-md w-full hidden sm:block ml-2">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#948a7b]" />
              <input
                type="text"
                placeholder="Ask TARS or search… (⌘K)"
                className="w-full rounded-full pl-9 pr-4 py-1.5 text-sm focus:outline-none transition-all"
                style={{
                  backgroundColor: "#f6f3ec",
                  border: "1px solid #d8d2c4",
                  color: "#1a1714",
                }}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {agentActive && (
              <div
                className="flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs font-medium hidden sm:flex"
                style={{
                  backgroundColor: "#e3ede9",
                  borderColor: "rgba(45,90,79,0.2)",
                  color: "#2d5a4f",
                }}
              >
                <span className="w-2 h-2 rounded-full bg-[#2d5a4f] animate-pulse" />
                Agent Active
              </div>
            )}

            {/* Dark mode toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg transition-colors"
              style={{ color: "var(--c-ink-muted)" }}
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button className="p-2 relative" style={{ color: "#6b6357" }}>
              <Bell size={20} />
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full border-2"
                style={{ backgroundColor: "#b8651a", borderColor: "#fbfaf6" }}
              />
            </button>

            <button
              onClick={() => setCaptureOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors cursor-pointer hover:opacity-80"
              style={{ backgroundColor: "#1a1714", color: "#fbfaf6" }}
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Capture</span>
            </button>
          </div>
        </header>

        {/* Page content — safe-area-aware bottom padding so content clears the tab bar + home indicator */}
        <div className="flex-1 overflow-hidden flex flex-col pb-safe-tab lg:pb-0">{children}</div>
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
    </SidebarProvider>
  )
}
