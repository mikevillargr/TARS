"use client"

import { useState, useRef, useCallback } from "react"

// Don't synthesize tiny fragments — wait until enough text has accumulated
const MIN_SENTENCE_CHARS = 10

/**
 * Split buffered text into complete sentences.
 * Returns the complete sentences and the remaining partial sentence still in the buffer.
 * Uses lookbehind on sentence-terminating punctuation followed by whitespace.
 */
function extractSentences(buffer: string): { sentences: string[]; remaining: string } {
  // Split after sentence-ending punctuation (. ! ?) followed by one or more whitespace chars,
  // or on blank-line paragraph breaks.
  const parts = buffer.split(/(?<=[.!?])\s+|\n{2,}/)
  if (parts.length <= 1) return { sentences: [], remaining: buffer }
  return {
    sentences: parts.slice(0, -1).map(s => s.trim()).filter(s => s.length >= MIN_SENTENCE_CHARS),
    remaining: parts[parts.length - 1],
  }
}

export interface UseTtsPlaybackResult {
  isPlaying: boolean
  isSynthesizing: boolean
  /** Feed incremental SSE text — complete sentences are extracted and queued for synthesis */
  feedText: (chunk: string) => void
  /** Call on SSE done — synthesizes any text remaining in the buffer */
  flushBuffer: () => void
  /** Stop all playback and synthesis immediately */
  stop: () => void
}

export function useTtsPlayback(): UseTtsPlaybackResult {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isSynthesizing, setIsSynthesizing] = useState(false)

  const bufferRef            = useRef("")
  const audioQueueRef        = useRef<Blob[]>([])
  const synthCountRef        = useRef(0)    // in-flight synthesis requests
  const playingRef           = useRef(false) // true while an Audio element is active
  const stopRef              = useRef(false)
  const activeAudioRef       = useRef<HTMLAudioElement | null>(null)
  // Track every in-flight AbortController so stop() can cancel all concurrent synth requests
  const activeControllersRef = useRef<Set<AbortController>>(new Set())

  // Called whenever synthesis or playback finishes to see if we can clear state
  const checkDone = useCallback(() => {
    if (synthCountRef.current === 0 && audioQueueRef.current.length === 0 && !playingRef.current) {
      setIsPlaying(false)
      setIsSynthesizing(false)
    }
  }, [])

  const playNext = useCallback(() => {
    if (stopRef.current) return
    const blob = audioQueueRef.current.shift()
    if (!blob) {
      playingRef.current = false
      checkDone()
      return
    }

    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    activeAudioRef.current = audio
    playingRef.current = true

    const cleanup = () => {
      URL.revokeObjectURL(url)
      activeAudioRef.current = null
      playNext()
    }
    audio.onended = cleanup
    audio.onerror = cleanup
    audio.play().catch(cleanup)
  }, [checkDone])

  const synth = useCallback(async (text: string) => {
    if (stopRef.current || !text.trim()) return

    synthCountRef.current++
    setIsSynthesizing(true)
    setIsPlaying(true)

    const ctrl = new AbortController()
    activeControllersRef.current.add(ctrl)

    // Read preferences at call time so changes in Settings take effect immediately
    const voice = typeof window !== "undefined" ? (localStorage.getItem("tars-voice") ?? undefined) : undefined
    const speed = typeof window !== "undefined" ? parseFloat(localStorage.getItem("tars-voice-speed") ?? "1.0") : 1.0

    try {
      const res = await fetch("/api/proxy/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, speed }),
        signal: ctrl.signal,
      })
      if (!res.ok || stopRef.current) return
      const blob = await res.blob()
      if (!stopRef.current) {
        audioQueueRef.current.push(blob)
        if (!playingRef.current) playNext()
      }
    } catch {
      // silence — network error, 503 (Kokoro down), or intentional abort
    } finally {
      activeControllersRef.current.delete(ctrl)
      synthCountRef.current = Math.max(0, synthCountRef.current - 1)
      if (synthCountRef.current === 0) setIsSynthesizing(false)
      checkDone()
    }
  }, [playNext, checkDone])

  const feedText = useCallback((chunk: string) => {
    bufferRef.current += chunk
    const { sentences, remaining } = extractSentences(bufferRef.current)
    bufferRef.current = remaining
    for (const s of sentences) synth(s)
  }, [synth])

  const flushBuffer = useCallback(() => {
    const tail = bufferRef.current.trim()
    bufferRef.current = ""
    if (tail.length >= 5) {
      synth(tail)
    } else {
      if (synthCountRef.current === 0) setIsSynthesizing(false)
      checkDone()
    }
  }, [synth, checkDone])

  const stop = useCallback(() => {
    stopRef.current = true
    // Abort every in-flight synthesis request — previously only the last one was tracked,
    // causing earlier sentences to continue playing after stop was clicked
    for (const ctrl of activeControllersRef.current) ctrl.abort()
    activeControllersRef.current.clear()
    if (activeAudioRef.current) {
      activeAudioRef.current.pause()
      activeAudioRef.current = null
    }
    audioQueueRef.current = []
    bufferRef.current = ""
    synthCountRef.current = 0
    playingRef.current = false
    setIsPlaying(false)
    setIsSynthesizing(false)
    // Re-arm for the next voice interaction
    setTimeout(() => { stopRef.current = false }, 0)
  }, [])

  return { isPlaying, isSynthesizing, feedText, flushBuffer, stop }
}
