"use client"

import { useState, useRef, useCallback } from "react"

export type VoiceInputState = "idle" | "recording" | "transcribing" | "error"

export interface UseVoiceInputResult {
  state: VoiceInputState
  error: string | null
  /** Start recording. Returns false if microphone access was denied. */
  startRecording: () => Promise<boolean>
  /**
   * Stop recording and transcribe.
   * Resolves to the transcribed text, or "" on failure.
   */
  stopAndTranscribe: () => Promise<string>
  /** Cancel an in-progress recording without transcribing. */
  cancel: () => void
}

// Preferred MIME types in order — pick the first one the browser supports
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
]

function bestMimeType(): string {
  for (const mt of PREFERRED_MIME_TYPES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) {
      return mt
    }
  }
  return ""   // let the browser pick
}

export function useVoiceInput(): UseVoiceInputResult {
  const [state, setState] = useState<VoiceInputState>("idle")
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef   = useRef<Blob[]>([])
  const streamRef   = useRef<MediaStream | null>(null)

  const startRecording = useCallback(async (): Promise<boolean> => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = bestMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start(250)   // collect chunks every 250 ms
      setState("recording")
      return true
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes("denied") || msg.includes("NotAllowed")
        ? "Microphone access denied. Check your browser settings."
        : `Could not start recording: ${msg}`)
      setState("error")
      return false
    }
  }, [])

  const stopAndTranscribe = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current
      if (!recorder || recorder.state === "inactive") {
        setState("idle")
        resolve("")
        return
      }

      recorder.onstop = async () => {
        // Release mic immediately so browser indicator disappears
        streamRef.current?.getTracks().forEach((t) => t.stop())
        streamRef.current = null

        setState("transcribing")
        try {
          const mimeType = recorder.mimeType || "audio/webm"
          const blob = new Blob(chunksRef.current, { type: mimeType })
          chunksRef.current = []

          if (blob.size < 500) {
            // Too short — likely just background noise, don't send
            setState("idle")
            resolve("")
            return
          }

          const ext = mimeType.includes("ogg") ? ".ogg"
            : mimeType.includes("mp4") ? ".mp4"
            : ".webm"

          const form = new FormData()
          form.append("file", blob, `recording${ext}`)

          const res = await fetch("/api/proxy/transcribe", {
            method: "POST",
            body: form,
          })

          if (!res.ok) {
            throw new Error(`Server error ${res.status}`)
          }

          const data = await res.json() as { text?: string }
          setState("idle")
          resolve(data.text?.trim() ?? "")
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(`Transcription failed: ${msg}`)
          setState("error")
          resolve("")
        }
      }

      recorder.stop()
    })
  }, [])

  const cancel = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.stop()
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    chunksRef.current = []
    recorderRef.current = null
    setState("idle")
    setError(null)
  }, [])

  return { state, error, startRecording, stopAndTranscribe, cancel }
}
