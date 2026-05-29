"use client"

import { useState } from "react"
import { BookOpen, CheckSquare, Check } from "lucide-react"
import { apiPost } from "@/lib/api-client"

interface MessageActionsProps {
  content: string
}

export function MessageActions({ content }: MessageActionsProps) {
  const [savingBrain, setSavingBrain] = useState(false)
  const [savedBrain, setSavedBrain]   = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [createdTask, setCreatedTask]   = useState(false)

  function deriveTitle(text: string): string {
    const first = text.split("\n").find((l) => l.trim()) || text
    return first.trim().replace(/^#+\s*/, "").slice(0, 80)
  }

  const saveToSecondBrain = async () => {
    setSavingBrain(true)
    try {
      await apiPost("/second-brain/ingest/text", {
        content,
        title: deriveTitle(content),
        tags: ["chat"],
        domain: "work",
      })
      setSavedBrain(true)
      setTimeout(() => setSavedBrain(false), 3000)
    } catch (err) {
      console.error(err)
    } finally {
      setSavingBrain(false)
    }
  }

  const createTask = async () => {
    setCreatingTask(true)
    try {
      await apiPost("/tasks", {
        title: deriveTitle(content),
        description: content.slice(0, 500),
        priority: "normal",
        source: "chat",
      })
      setCreatedTask(true)
      setTimeout(() => setCreatedTask(false), 3000)
    } catch (err) {
      console.error(err)
    } finally {
      setCreatingTask(false)
    }
  }

  return (
    <div
      className="flex items-center gap-1.5 mt-1.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
      style={{ minHeight: "22px" }}
    >
      <button
        onClick={saveToSecondBrain}
        disabled={savingBrain || savedBrain}
        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-all"
        style={{
          backgroundColor: savedBrain ? "#e3ede9" : "transparent",
          color: savedBrain ? "#2d5a4f" : "#c4bdb2",
          border: `1px solid ${savedBrain ? "rgba(45,90,79,0.2)" : "transparent"}`,
        }}
      >
        {savedBrain ? <Check size={9} /> : <BookOpen size={9} />}
        {savedBrain ? "Saved" : savingBrain ? "Saving…" : "Second Brain"}
      </button>

      <button
        onClick={createTask}
        disabled={creatingTask || createdTask}
        className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full transition-all"
        style={{
          backgroundColor: createdTask ? "#e3ede9" : "transparent",
          color: createdTask ? "#2d5a4f" : "#c4bdb2",
          border: `1px solid ${createdTask ? "rgba(45,90,79,0.2)" : "transparent"}`,
        }}
      >
        {createdTask ? <Check size={9} /> : <CheckSquare size={9} />}
        {createdTask ? "Added" : creatingTask ? "Adding…" : "Task"}
      </button>
    </div>
  )
}
