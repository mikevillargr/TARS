"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  MessageSquare, CheckSquare, Video, CalendarDays, Brain, Bot,
  FolderOpen, Mail, Clock, Plug, Database, Settings,
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
  MessageSquare, CheckSquare, Video, CalendarDays, Brain, Bot,
  FolderOpen, Mail, Clock, Plug, Database, Settings,
} as const

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4 border-b border-sidebar-border">
        <span className="text-xl font-bold tracking-widest text-sidebar-foreground">TARS</span>
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
                    >
                      <Icon className="size-4" />
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
            <AvatarFallback className="text-xs">MV</AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-medium text-sidebar-foreground truncate">Mike Villar</span>
            <span className="text-xs text-sidebar-foreground/50 truncate">CEO, Growth Rocket</span>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
