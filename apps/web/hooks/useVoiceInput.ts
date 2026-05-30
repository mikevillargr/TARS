"use client"

import { useState, useRef, useCallback } from "react"

export type VoiceInputState = "idle" | "recording" | "transcribing" | "error"

export interface UseVoiceInputResult {
  state: VoiceInputState
  error: string | null
  /**
   * Start recording.
   * `onDone` is called with the transcribed text when silence is detected
   * (VAD) OR when `stop()` is called manually.
   * Returns false if microphone access was denied.
   */
  start: (onDone?: (text: string) => void) => Promise<boolean>
  /**
   * Manually stop recording and trigger transcription.
   * Calls the same `onDone` callback passed to `start()`.
   */
  stop: () => void
  /** Cancel — stop recording without transcribing. */
  cancel: () => void
}

// ── Audio format preference ────────────────────────────────────────────────────
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
]

function bestMimeType(): string {
  for (const mt of PREFERRED_MIME_TYPES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mt)) return mt
  }
  return ""
}

// ── VAD settings ──────────────────────────────────────────────────────────────
const VAD_CHECK_INTERVAL_MS  = 80    // how often to sample audio levels
const VAD_SILENCE_THRESHOLD  = 0.015 // normalised RMS below which = silence
const VAD_SILENCE_DURATION   = 1400  // ms of sustained silence → auto-stop
const VAD_MIN_RECORDING_MS   = 600   // don't auto-stop before this (avoid false triggers)

export function useVoiceInput(): UseVoiceInputResult {
  const [state, setState]   = useState<VoiceInputState>("idle")
  const [error, setError]   = useState<string | null>(null)

  const recorderRef   = useRef<MediaRecorder | null>(null)
  const chunksRef     = useRef<Blob[]>([])
  const streamRef     = useRef<MediaStream | null>(null)
  const audioCTXRef   = useRef<AudioContext | null>(null)
  const analyserRef   = useRef<AnalyserNode | null>(null)
  const vadTimerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const onDoneRef     = useRef<((text: string) => void) | undefined>(undefined)
  const silenceRef    = useRef<number | null>(null)   // timestamp when silence started
  const startedAtRef  = useRef<number>(0)             // timestamp when recording started
  const stoppingRef   = useRef(false)                  // guard against double-stop

  // ── Transcription helper ───────────────────────────────────────────────────
  const _doTranscribe = useCallback(async (chunks: Blob[], mimeType: string): Promise<string> => {
    setState("transcribing")
    try {
      if (chunks.reduce((s, c) => s + c.size, 0) < 500) return ""

      const ext  = mimeType.includes("ogg") ? ".ogg" : mimeType.includes("mp4") ? ".mp4" : ".webm"
      const blob = new Blob(chunks, { type: mimeType })
      const form = new FormData()
      form.append("file", blob, `recording${ext}`)

      const res = await fetch("/api/proxy/transcribe", { method: "POST", body: form })
      if (!res.ok) throw new Error(`Server ${res.status}`)
      const data = await res.json() as { text?: string }
      return data.text?.trim() ?? ""
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`Transcription failed: ${msg}`)
      return ""
    } finally {
      setState("idle")
    }
  }, [])

  // ── Clean-up helper ────────────────────────────────────────────────────────
  const _cleanup = useCallback(() => {
    if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null }
    try { audioCTXRef.current?.close() } catch { /* ignore */ }
    audioCTXRef.current = null
    analyserRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    silenceRef.current = null
    stoppingRef.current = false
  }, [])

  // ── start ──────────────────────────────────────────────────────────────────
  const start = useCallback(async (onDone?: (text: string) => void): Promise<boolean> => {
    setError(null)
    stoppingRef.current = false
    onDoneRef.current = onDone

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg.includes("denied") || msg.includes("NotAllowed")
        ? "Microphone access denied."
        : `Could not access microphone: ${msg}`)
      setState("error")
      return false
    }

    streamRef.current = stream

    // ── MediaRecorder ──────────────────────────────────────────────────────
    const mimeType = bestMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorderRef.current = recorder
    chunksRef.current   = []

    recorder.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data) }

    recorder.onstop = async () => {
      const chunks   = chunksRef.current.slice()
      const mime     = recorder.mimeType || mimeType || "audio/webm"
      chunksRef.current = []
      _cleanup()

      const text = await _doTranscribe(chunks, mime)
      onDoneRef.current?.(text)
    }

    recorder.start(200)
    startedAtRef.current = Date.now()
    setState("recording")

    // ── Web Audio VAD ──────────────────────────────────────────────────────
    try {
      const ctx      = new AudioContext()
      const src      = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      src.connect(analyser)
      audioCTXRef.current  = ctx
      analyserRef.current  = analyser

      const buf = new Uint8Array(analyser.fftSize)

      vadTimerRef.current = setInterval(() => {
        if (!analyserRef.current || stoppingRef.current) return
        analyserRef.current.getByteTimeDomainData(buf)

        let sum = 0
        for (const v of buf) sum += ((v - 128) / 128) ** 2
        const rms = Math.sqrt(sum / buf.length)

        const now = Date.now()
        if (rms < VAD_SILENCE_THRESHOLD) {
          if (silenceRef.current === null) silenceRef.current = now
          const silentFor    = now - silenceRef.current
          const recordingFor = now - startedAtRef.current
          if (silentFor >= VAD_SILENCE_DURATION && recordingFor >= VAD_MIN_RECORDING_MS) {
            // Auto-stop on sustained silence
            if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null }
            stoppingRef.current = true
            recorder.stop()
          }
        } else {
          silenceRef.current = null  // speech detected — reset silence clock
        }
      }, VAD_CHECK_INTERVAL_MS)
    } catch {
      // AudioContext unavailable (e.g. old browser) — VAD disabled, manual stop only
    }

    return true
  }, [_cleanup, _doTranscribe])

  // ── stop (manual) ─────────────────────────────────────────────────────────
  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === "inactive" || stoppingRef.current) return
    if (vadTimerRef.current) { clearInterval(vadTimerRef.current); vadTimerRef.current = null }
    stoppingRef.current = true
    recorder.stop()   // triggers onstop → _doTranscribe → onDoneRef
  }, [])

  // ── cancel ────────────────────────────────────────────────────────────────
  const cancel = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.stop()
    }
    _cleanup()
    chunksRef.current    = []
    recorderRef.current  = null
    onDoneRef.current    = undefined
    setState("idle")
    setError(null)
  }, [_cleanup])

  return { state, error, start, stop, cancel }
}
