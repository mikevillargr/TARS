package com.tars.phone.tars

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.util.Log

/**
 * Wraps Android's on-device SpeechRecognizer for the glasses long-press → voice flow.
 *
 * Triggered when the glasses send {"type":"start_voice"}. Records on the PHONE mic,
 * transcribes locally (no server round-trip), and hands the final text back via
 * [onResult]. A short tone plays when the mic opens so the user knows it's listening.
 *
 * SpeechRecognizer must be created and driven on the main thread, so every public
 * entry point hops to the main looper.
 */
class VoiceInputManager(
    private val context: Context,
    private val onResult: (String) -> Unit,
    private val onError: (String) -> Unit,
) {
    companion object {
        private const val TAG = "VoiceInput"
    }

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private val tone by lazy { ToneGenerator(AudioManager.STREAM_MUSIC, 80) }

    val isListening: Boolean get() = listening

    /** Begin a single voice capture. No-op if already listening or unavailable. */
    fun start() {
        main.post {
            if (listening) {
                Log.d(TAG, "already listening — ignoring")
                return@post
            }
            if (!SpeechRecognizer.isRecognitionAvailable(context)) {
                onError("Speech recognition isn't available on this phone.")
                return@post
            }
            val sr = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
                it.setRecognitionListener(listener)
                recognizer = it
            }
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }
            listening = true
            try {
                sr.startListening(intent)
                beep(ToneGenerator.TONE_PROP_BEEP)
                Log.i(TAG, "listening…")
            } catch (e: Exception) {
                listening = false
                onError("Couldn't start the mic: ${e.message}")
            }
        }
    }

    fun stop() {
        main.post {
            try { recognizer?.stopListening() } catch (_: Exception) {}
        }
    }

    fun destroy() {
        main.post {
            try { recognizer?.destroy() } catch (_: Exception) {}
            recognizer = null
            listening = false
        }
    }

    private fun beep(toneType: Int) {
        try { tone.startTone(toneType, 150) } catch (_: Exception) {}
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: android.os.Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() { Log.d(TAG, "end of speech") }
        override fun onPartialResults(partialResults: android.os.Bundle?) {}
        override fun onEvent(eventType: Int, params: android.os.Bundle?) {}

        override fun onError(error: Int) {
            listening = false
            val reason = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH,
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Didn't catch that"
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Mic permission denied"
                SpeechRecognizer.ERROR_AUDIO -> "Mic error"
                SpeechRecognizer.ERROR_NETWORK,
                SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network error"
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Recognizer busy"
                else -> "Voice error ($error)"
            }
            Log.w(TAG, "onError: $reason ($error)")
            onError(reason)
        }

        override fun onResults(results: android.os.Bundle?) {
            listening = false
            val text = results
                ?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                ?.firstOrNull()
                ?.trim()
                .orEmpty()
            if (text.isNotEmpty()) {
                beep(ToneGenerator.TONE_PROP_ACK)
                Log.i(TAG, "result: $text")
                onResult(text)
            } else {
                onError("Didn't catch that")
            }
        }
    }
}
