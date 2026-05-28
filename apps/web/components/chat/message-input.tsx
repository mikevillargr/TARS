"use client"

import { useState, useRef, useCallback } from "react"
import { Camera, Paperclip, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Props {
  onSend: (content: string, attachments: File[]) => void
  disabled?: boolean
}

export function MessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if ((!trimmed && attachments.length === 0) || disabled) return
    onSend(trimmed, attachments)
    setValue("")
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }, [value, attachments, disabled, onSend])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    setAttachments((prev) => [...prev, ...picked])
    e.target.value = ""
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="px-4 pb-4 pt-2">
      <div className="max-w-3xl mx-auto">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((file, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 bg-muted border border-border rounded-lg px-2 py-1 text-xs"
              >
                {file.type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="size-8 rounded object-cover shrink-0"
                  />
                ) : (
                  <Paperclip className="size-3 text-muted-foreground shrink-0" />
                )}
                <span className="max-w-[120px] truncate text-foreground">{file.name}</span>
                <button
                  onClick={() => removeAttachment(i)}
                  className="text-muted-foreground hover:text-foreground ml-0.5"
                  type="button"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border bg-muted/50 px-3 py-3 transition-colors",
            "focus-within:border-ring focus-within:bg-background"
          )}
        >
          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
            type="button"
            title="Attach file"
          >
            <Paperclip className="size-4" />
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="size-8 shrink-0 rounded-xl text-muted-foreground hover:text-foreground"
            onClick={() => cameraRef.current?.click()}
            disabled={disabled}
            type="button"
            title="Take photo"
          >
            <Camera className="size-4" />
          </Button>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Message TARS…"
            rows={1}
            disabled={disabled}
            className={cn(
              "flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground",
              "focus:outline-none disabled:opacity-50 leading-relaxed"
            )}
          />

          <Button
            size="icon"
            className="size-8 shrink-0 rounded-xl"
            onClick={submit}
            disabled={disabled || (!value.trim() && attachments.length === 0)}
          >
            <Send className="size-3.5" />
          </Button>
        </div>

        {/* Hidden inputs */}
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.md,image/*"
          className="hidden"
          onChange={handleFiles}
        />
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFiles}
        />

        <p className="text-center text-[10px] text-muted-foreground/50 mt-1.5">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}
