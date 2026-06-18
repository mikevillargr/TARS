"use client"

import React, { useState, useRef, useCallback, useEffect } from "react"
import { Camera, FileCode, FileSpreadsheet, FileText, Loader2, Paperclip, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useMentionAutocomplete } from "@/hooks/useMentionAutocomplete"
import { MentionDropdown } from "@/components/ui/MentionDropdown"

interface Props {
  onSend: (content: string, attachments: File[]) => void
  disabled?: boolean
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function FileTypeIcon({ file, className }: { file: File; className?: string }) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  const ct = file.type.toLowerCase()

  if (ct.startsWith("image/")) return null // thumbnails handle their own display

  if (ct === "application/pdf" || ext === "pdf")
    return <FileText className={cn("text-red-400", className)} />
  if (ct.includes("spreadsheet") || ["xlsx", "xls", "csv"].includes(ext))
    return <FileSpreadsheet className={cn("text-green-400", className)} />
  if (ct.includes("presentation") || ext === "pptx")
    return <FileText className={cn("text-orange-400", className)} />
  if (["json", "yaml", "yml", "xml"].includes(ext))
    return <FileCode className={cn("text-purple-400", className)} />
  return <FileText className={cn("text-muted-foreground", className)} />
}

export function MessageInput({ onSend, disabled }: Props) {
  const [value, setValue] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const mention = useMentionAutocomplete(setValue, textareaRef)

  const submit = useCallback(() => {
    const trimmed = value.trim()
    if ((!trimmed && attachments.length === 0) || disabled) return
    onSend(trimmed, attachments)
    setValue("")
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }, [value, attachments, disabled, onSend])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.handleKeyDown(e)) return
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    mention.onInput(e)
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

  function handlePastedImages(e: React.ClipboardEvent | ClipboardEvent) {
    const cd = (e as React.ClipboardEvent).clipboardData ?? (e as ClipboardEvent).clipboardData
    // Diagnostic: log what's in the clipboard every time paste fires
    console.log("[TARS paste]", {
      itemCount: cd?.items?.length ?? 0,
      fileCount: cd?.files?.length ?? 0,
      items: cd ? Array.from(cd.items).map((i) => ({ kind: i.kind, type: i.type })) : [],
    })
    if (!cd) return
    const images = Array.from(cd.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null)
    if (images.length === 0) return
    e.preventDefault()
    images.forEach((f) => {
      const ext = f.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"
      setAttachments((prev) => [...prev, new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type })])
    })
  }

  useEffect(() => {
    function onDocumentPaste(e: ClipboardEvent) {
      if (e.defaultPrevented) return
      handlePastedImages(e)
    }
    document.addEventListener("paste", onDocumentPaste)
    return () => document.removeEventListener("paste", onDocumentPaste)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="px-4 pb-4 pt-2" onPaste={handlePastedImages as React.ClipboardEventHandler<HTMLDivElement>}>
      <div className="max-w-3xl mx-auto">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((file, i) => (
              <div
                key={i}
                className={cn(
                  "relative flex items-center gap-1.5 bg-muted border border-border rounded-lg px-2 py-1 text-xs transition-opacity",
                  disabled && "opacity-60"
                )}
              >
                {file.type.startsWith("image/") ? (
                  <button
                    type="button"
                    onClick={() => setPreviewSrc(URL.createObjectURL(file))}
                    className="focus:outline-none"
                    title="Preview image"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="size-8 rounded object-cover shrink-0 hover:opacity-80 transition-opacity cursor-zoom-in"
                    />
                  </button>
                ) : (
                  <FileTypeIcon file={file} className="size-3.5 shrink-0" />
                )}
                <div className="flex flex-col min-w-0">
                  <span className="max-w-[120px] truncate text-foreground leading-tight">{file.name}</span>
                  <span className="text-muted-foreground text-[10px] leading-tight">{formatSize(file.size)}</span>
                </div>
                {disabled ? (
                  <Loader2 className="size-3 text-muted-foreground shrink-0 animate-spin ml-0.5" />
                ) : (
                  <button
                    onClick={() => removeAttachment(i)}
                    className="text-muted-foreground hover:text-foreground ml-0.5 shrink-0"
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            ))}
            {disabled && (
              <span className="self-center text-[10px] text-muted-foreground italic">Sending…</span>
            )}
          </div>
        )}

        <div className="relative">
          {mention.open && mention.anchor && (
            <div
              style={{
                position: "fixed",
                bottom: `calc(100vh - ${mention.anchor.top}px + 8px)`,
                left: mention.anchor.left,
                width: mention.anchor.width,
                zIndex: 9999,
              }}
            >
              <MentionDropdown
                open={mention.open}
                results={mention.results}
                selectedIndex={mention.selectedIndex}
                onSelect={mention.select}
              />
            </div>
          )}

        <div
          className={cn(
            "flex items-end gap-2 rounded-2xl border border-border bg-muted/50 px-3 py-3 transition-colors",
            "focus-within:border-ring focus-within:bg-background"
          )}
        >
          <label
            htmlFor="chat-file-input"
            className={cn(
              "inline-flex items-center justify-center size-8 shrink-0 rounded-xl",
              "text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer",
              disabled && "pointer-events-none opacity-50"
            )}
            title="Attach file"
          >
            <Paperclip className="size-4" />
          </label>

          <label
            htmlFor="chat-camera-input"
            className={cn(
              "inline-flex items-center justify-center size-8 shrink-0 rounded-xl",
              "text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer",
              disabled && "pointer-events-none opacity-50"
            )}
            title="Take photo"
          >
            <Camera className="size-4" />
          </label>

          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            onBlur={mention.dismiss}
            placeholder="Message TARS… (type [[ to mention)"
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
            {disabled ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </Button>
        </div>
        </div>{/* end relative dropdown wrapper */}

        {/* Hidden inputs */}
        <input
          ref={fileRef}
          id="chat-file-input"
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.xlsx,.xls,.pptx,.csv,.txt,.md,.json,.yaml,.yml,.xml,image/*"
          className="hidden"
          onChange={handleFiles}
        />
        <input
          ref={cameraRef}
          id="chat-camera-input"
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={handleFiles}
        />

        <p className="text-center text-[10px] text-muted-foreground/50 mt-1.5">
          Enter to send · Shift+Enter for newline · Paste images with ⌘V
        </p>
      </div>

      {/* Image preview lightbox */}
      {previewSrc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 cursor-zoom-out"
          onClick={() => setPreviewSrc(null)}
        >
          <button
            onClick={() => setPreviewSrc(null)}
            className="absolute top-4 right-4 text-white/70 hover:text-white transition-colors"
            type="button"
          >
            <X className="size-6" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewSrc}
            alt="Preview"
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
