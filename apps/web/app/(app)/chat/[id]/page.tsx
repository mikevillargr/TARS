"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  useEffect(() => {
    if (id) router.replace(`/chat?open=${id}`)
  }, [id, router])

  return null
}
