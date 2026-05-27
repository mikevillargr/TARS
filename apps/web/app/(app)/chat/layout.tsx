"use client"

import { useState } from "react"
import { ConversationList } from "@/components/chat/conversation-list"

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const [, setActiveId] = useState<string | null>(null)

  return (
    <div className="flex h-full">
      <ConversationList onSelect={setActiveId} />
      <div className="flex-1 flex flex-col min-w-0">{children}</div>
    </div>
  )
}
