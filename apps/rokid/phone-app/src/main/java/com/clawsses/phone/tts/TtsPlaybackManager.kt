package com.clawsses.phone.tts

import android.content.Context
import android.media.MediaPlayer
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import java.io.File
import java.io.FileOutputStream
import kotlin.coroutines.resume

/**
 * Streams TTS playback in sentence groups (like the TARS web app): the reply is
 * split into ~250-char sentence-bounded chunks; chunk N plays while chunk N+1
 * synthesizes on the server — first audio starts after one short synthesis
 * instead of waiting for the whole reply, and Kokoro's per-call phoneme limit
 * is never approached. New messages interrupt current playback.
 */
class TtsPlaybackManager(
    private val context: Context,
    private val client: ElevenLabsClient,
    private val settings: TtsSettingsManager
) {
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var speakJob: Job? = null
    private var mediaPlayer: MediaPlayer? = null

    /**
     * Speak the given text via Kokoro on the TARS server.
     * Stops any current playback first.
     */
    fun speak(text: String) {
        if (!settings.isEnabled.value) {
            Log.d(TAG, "TTS disabled, skipping")
            return
        }
        val voiceId = settings.selectedVoiceId.value
        val speed = settings.speed.value.toDouble()

        stop()

        val chunks = splitForTts(text)
        Log.d(TAG, "Speaking ${text.length} chars in ${chunks.size} chunk(s)")

        speakJob = scope.launch {
            var nextAudio: Deferred<File?> = async { synthesizeToFile(chunks[0], voiceId, speed, 0) }
            try {
                for (i in chunks.indices) {
                    val file = nextAudio.await()
                    if (!isActive) { file?.delete(); break }
                    // Prefetch the next chunk while this one plays
                    if (i + 1 < chunks.size) {
                        nextAudio = async { synthesizeToFile(chunks[i + 1], voiceId, speed, i + 1) }
                    }
                    if (file == null) continue   // synthesis failed — skip chunk
                    playAndAwait(file)
                    file.delete()
                    if (!isActive) break
                }
            } finally {
                releasePlayer()
            }
        }
    }

    private suspend fun synthesizeToFile(chunk: String, voiceId: String?, speed: Double, index: Int): File? {
        return try {
            val result = client.synthesize("", voiceId, chunk, speed)
            result.fold(
                onSuccess = { input ->
                    val f = File.createTempFile("tts_${index}_", ".wav", context.cacheDir)
                    FileOutputStream(f).use { out -> input.use { it.copyTo(out) } }
                    f
                },
                onFailure = { e ->
                    Log.e(TAG, "TTS synthesis failed for chunk $index", e)
                    null
                }
            )
        } catch (e: Exception) {
            Log.e(TAG, "Error during TTS chunk $index", e)
            null
        }
    }

    /** Play a WAV file and suspend until playback finishes (or fails). */
    private suspend fun playAndAwait(file: File) = suspendCancellableCoroutine { cont ->
        try {
            releasePlayer()
            val player = MediaPlayer().apply {
                setDataSource(file.absolutePath)
                setOnCompletionListener {
                    if (cont.isActive) cont.resume(Unit)
                }
                setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "MediaPlayer error: what=$what, extra=$extra")
                    if (cont.isActive) cont.resume(Unit)
                    true
                }
                prepare()
                start()
            }
            mediaPlayer = player
            cont.invokeOnCancellation {
                try { player.stop() } catch (_: Exception) {}
                try { player.release() } catch (_: Exception) {}
            }
            Log.d(TAG, "Playback started (${file.length() / 1024} KB)")
        } catch (e: Exception) {
            Log.e(TAG, "Error playing audio file", e)
            if (cont.isActive) cont.resume(Unit)
        }
    }

    /**
     * Stop current playback (and any queued chunks).
     */
    fun stop() {
        speakJob?.cancel()
        speakJob = null
        releasePlayer()
    }

    private fun releasePlayer() {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error releasing MediaPlayer", e)
        }
        mediaPlayer = null
    }

    /**
     * Called when a chat message stream ends.
     * Speaks the message if TTS is enabled.
     */
    fun onMessageComplete(text: String) {
        if (settings.isEnabled.value && text.isNotBlank()) {
            speak(text)
        }
    }

    companion object {
        private const val TAG = "TtsPlaybackManager"
        private const val MAX_CHUNK_CHARS = 250

        /** Sentence-bounded chunks ≤ MAX_CHUNK_CHARS (hard-split as fallback). */
        fun splitForTts(text: String): List<String> {
            val sentences = text.trim().split(Regex("(?<=[.!?…])\\s+"))
            val chunks = mutableListOf<String>()
            val current = StringBuilder()
            for (raw in sentences) {
                var s = raw.trim()
                if (s.isEmpty()) continue
                while (s.length > MAX_CHUNK_CHARS) {
                    var cut = s.lastIndexOf(',', MAX_CHUNK_CHARS)
                    if (cut < MAX_CHUNK_CHARS / 2) cut = s.lastIndexOf(' ', MAX_CHUNK_CHARS)
                    if (cut <= 0) cut = MAX_CHUNK_CHARS
                    if (current.isNotEmpty()) { chunks.add(current.toString()); current.clear() }
                    chunks.add(s.substring(0, cut).trim())
                    s = s.substring(cut).trimStart(',', ' ')
                }
                if (s.isEmpty()) continue
                if (current.length + s.length + 1 <= MAX_CHUNK_CHARS) {
                    if (current.isNotEmpty()) current.append(' ')
                    current.append(s)
                } else {
                    if (current.isNotEmpty()) chunks.add(current.toString())
                    current.clear()
                    current.append(s)
                }
            }
            if (current.isNotEmpty()) chunks.add(current.toString())
            return chunks.ifEmpty { listOf(text.take(MAX_CHUNK_CHARS)) }
        }
    }
}
