"use client"

import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { Bell, Plus, Search } from "lucide-react"
import { useState } from "react"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [agentActive] = useState(true)

  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Topbar */}
        <header
          className="h-14 border-b flex items-center justify-between px-4 shrink-0 backdrop-blur-sm z-10"
          style={{ borderColor: "#d8d2c4", backgroundColor: "rgba(251,250,246,0.8)" }}
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

            <button className="p-2 relative" style={{ color: "#6b6357" }}>
              <Bell size={20} />
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full border-2"
                style={{ backgroundColor: "#b8651a", borderColor: "#fbfaf6" }}
              />
            </button>

            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
              style={{ backgroundColor: "#1a1714", color: "#fbfaf6" }}
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Capture</span>
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex flex-col">{children}</div>
      </main>
    </SidebarProvider>
  )
}
