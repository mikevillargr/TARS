import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/shell/app-sidebar"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-12 flex items-center px-4 border-b border-border shrink-0">
          <SidebarTrigger className="size-7" />
        </header>
        <div className="flex-1 overflow-auto">{children}</div>
      </main>
    </SidebarProvider>
  )
}
