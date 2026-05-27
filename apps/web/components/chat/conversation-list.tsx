"use client"

import { useEffect, useState } from "react"
import { useRouter, useParams } from "next/navigation"
import { Plus, MessageSquare, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { apiGet, apiPost, apiDelete } from "@/lib/api-client"

interface Conversation {
  id: string
  title: string | null
  created_at: string
}

export function ConversationList({
  onSelect,
}: {
  onSelect: (id: string) => void
}) {
  const router = useRouter()
  const params = useParams()
  const activeId = params?.id as string | undefined

  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiGet<Conversation[]>("/chat/conversations")
      .then(setConversations)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function handleNew() {
    const conv = await apiPost<Conversation>("/chat/conversations")
    setConversations((prev) => [conv, ...prev])
    onSelect(conv.id)
    router.push(`/chat/${conv.id}`)
  }

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    await apiDelete(`/chat/conversations/${id}`)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeId === id) {
      router.push("/chat")
    }
  }

  return (
    <div className="flex flex-col h-full w-64 border-r border-border bg-sidebar shrink-0">
      <div className="p-3 border-b border-border">
        <Button
          onClick={handleNew}
          size="sm"
          className="w-full gap-2"
          variant="outline"
        >
          <Plus className="size-3.5" />
          New chat
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading...</div>
        ) : conversations.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No conversations yet.</div>
        ) : (
          <ul className="p-2 space-y-0.5">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <button
                  onClick={() => {
                    onSelect(conv.id)
                    router.push(`/chat/${conv.id}`)
                  }}
                  className={cn(
                    "group w-full flex items-center gap-2 px-2 py-2 rounded-md text-left text-sm transition-colors",
                    activeId === conv.id
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                  )}
                >
                  <MessageSquare className="size-3.5 shrink-0 opacity-50" />
                  <span className="flex-1 truncate">
                    {conv.title ?? "New conversation"}
                  </span>
                  <button
                    onClick={(e) => handleDelete(e, conv.id)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-destructive transition-opacity"
                    aria-label="Delete"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
