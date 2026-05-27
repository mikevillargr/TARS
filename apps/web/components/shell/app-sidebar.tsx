"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  MessageSquare, CheckSquare, Video, CalendarDays, Brain, Cpu,
  Mail, Clock, Plug, Database, Settings, Archive,
} from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { navItems } from "./nav-items"

const iconMap = {
  MessageSquare, CheckSquare, Video, CalendarDays, Brain, Cpu,
  Mail, Clock, Plug, Database, Settings, Archive,
} as const

function TarsLogo() {
  return (
    <svg
      width="22"
      height="40"
      viewBox="0 0 22 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      <rect x="1" y="1" width="20" height="8.5" rx="1" fill="#1a1714" stroke="#3a342d" strokeWidth="0.5" />
      <rect x="3" y="3" width="2" height="1" fill="#6b6357" opacity="0.6" />
      <rect x="3" y="5.5" width="3" height="0.5" fill="#6b6357" opacity="0.4" />
      <rect x="0" y="9.5" width="22" height="1" fill="#f6f3ec" />
      <rect x="1" y="10.5" width="20" height="8.5" rx="1" fill="#1a1714" stroke="#3a342d" strokeWidth="0.5" />
      <rect x="3" y="12.5" width="6" height="1" fill="#6b6357" opacity="0.4" />
      <circle cx="17" cy="13" r="0.6" fill="#b8651a" opacity="0.8" />
      <rect x="0" y="19" width="22" height="1" fill="#f6f3ec" />
      <rect x="1" y="20" width="20" height="8.5" rx="1" fill="#1a1714" stroke="#3a342d" strokeWidth="0.5" />
      <rect x="3" y="22" width="3" height="0.5" fill="#6b6357" opacity="0.4" />
      <rect x="3" y="24" width="5" height="0.5" fill="#6b6357" opacity="0.4" />
      <rect x="0" y="28.5" width="22" height="1" fill="#f6f3ec" />
      <rect x="1" y="29.5" width="20" height="8.5" rx="1" fill="#1a1714" stroke="#3a342d" strokeWidth="0.5" />
      <rect x="3" y="31.5" width="2" height="1" fill="#6b6357" opacity="0.5" />
      <rect x="3" y="34" width="4" height="0.5" fill="#6b6357" opacity="0.4" />
    </svg>
  )
}

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <TarsLogo />
          <span
            className="font-semibold text-lg tracking-[0.25em] text-sidebar-foreground"
            style={{ fontFamily: "var(--font-heading), serif" }}
          >
            TARS
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const Icon = iconMap[item.icon as keyof typeof iconMap]
                const isActive = pathname.startsWith(item.href)
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      render={<Link href={item.href} />}
                      className={
                        isActive
                          ? "bg-[#e3ede9] text-[#2d5a4f] hover:bg-[#e3ede9] hover:text-[#2d5a4f]"
                          : "text-[#6b6357] hover:bg-[#efeadf] hover:text-[#1a1714]"
                      }
                    >
                      <Icon
                        className={`size-4 ${isActive ? "text-[#2d5a4f]" : "text-[#948a7b]"}`}
                      />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="px-3 py-3 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-2">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs bg-[#efeadf] text-[#6b6357]">MV</AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-sidebar-foreground truncate">Mike Villar</span>
            <span className="text-xs text-[#948a7b] truncate">CEO, Growth Rocket</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
