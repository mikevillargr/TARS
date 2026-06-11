package com.tars.phone.tars

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import android.util.Log
import com.google.gson.JsonParser
import com.tars.phone.glasses.GlassesConnectionManager
import com.tars.phone.glasses.WakeSignalManager
import com.tars.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collectLatest

/**
 * Foreground service that keeps both connections alive:
 *   - TarsClient  ← WebSocket → TARS harness
 *   - GlassesConnectionManager ← Rokid CXR SDK → Glasses HUD
 *
 * Bridges messages between the two:
 *   TARS → Phone: relay chat_stream / chat_message / etc. to glasses
 *   Glasses → Phone: relay user_input / session actions to TARS
 */
class TarsBridgeService : Service() {

    companion object {
        private const val TAG = "TarsBridgeService"
        private const val NOTIF_CHANNEL = "tars_bridge"
        private const val NOTIF_ID = 1001
        const val ACTION_START_VOICE = "com.tars.phone.START_VOICE"
        const val ACTION_SEND_TEXT = "com.tars.phone.SEND_TEXT"
        const val EXTRA_TEXT = "text"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tarsConnected = false

    lateinit var tarsClient: TarsClient
    lateinit var glassesManager: GlassesConnectionManager
    lateinit var wakeSignalManager: WakeSignalManager
    lateinit var authManager: TarsAuthManager
    lateinit var voiceInput: VoiceInputManager

    override fun onCreate() {
        super.onCreate()
        tarsClient = TarsClient()
        glassesManager = GlassesConnectionManager.getInstance(this)
        wakeSignalManager = WakeSignalManager(glassesManager)
        authManager = TarsAuthManager(this)
        voiceInput = VoiceInputManager(
            context = this,
            onResult = { text ->
                Log.i(TAG, "voice → TARS: $text")
                tarsClient.sendUserInput(text)
            },
            onError = { reason ->
                Log.w(TAG, "voice error: $reason")
                // Surface a one-off assistant note on the HUD (no streaming id conflict).
                val note = ChatMessage(
                    id = java.util.UUID.randomUUID().toString(),
                    role = "assistant",
                    content = "[$reason]",
                )
                glassesManager.send(note.toJson())
            },
        )

        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())

        // After an app reinstall the in-process SDK state is fresh — re-attach to the
        // already-paired glasses so forwards aren't dropped with btConnected=false.
        glassesManager.tryAutoReconnect()

        bridgeGlassesToTars()
        bridgeTarsToGlasses()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START_VOICE -> {
                Log.i(TAG, "ACTION_START_VOICE — starting phone mic capture")
                voiceInput.start()
                return START_STICKY
            }
            ACTION_SEND_TEXT -> {
                val text = intent.getStringExtra(EXTRA_TEXT)?.trim().orEmpty()
                if (text.isNotEmpty()) {
                    Log.i(TAG, "ACTION_SEND_TEXT → TARS: $text")
                    tarsClient.sendUserInput(text)
                }
                return START_STICKY
            }
        }
        // Default start / restart: ensure the TARS connection is up (once).
        if (!tarsConnected) {
            val credentials = authManager.getSavedCredentials()
            if (credentials != null) {
                tarsClient.connect(authManager.getTarsClientConfig(credentials))
                tarsConnected = true
            } else {
                Log.w(TAG, "No TARS credentials saved — open Settings to configure")
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        tarsClient.destroy()
        glassesManager.stop()
        voiceInput.destroy()
        scope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Glasses → TARS: relay input and session commands */
    private fun bridgeGlassesToTars() {
        scope.launch {
            glassesManager.incomingMessages.collect { json ->
                try {
                    val type = extractMessageType(json) ?: return@collect
                    Log.i(TAG, "glasses→ [$type]")
                    when (type) {
                        "user_input" -> {
                            val input = UserInput.fromJson(json)
                            tarsClient.sendUserInput(input.text, input.imageBase64)
                        }
                        "list_sessions" -> tarsClient.listSessions()
                        "switch_session" -> {
                            val action = SessionAction.fromJson(json)
                            action.sessionKey?.let { tarsClient.switchSession(it) }
                        }
                        "create_session" -> tarsClient.createSession()
                        "wake_ack" -> {
                            val ack = WakeAck.fromJson(json)
                            wakeSignalManager.onWakeAck(ack)
                        }
                        "tts_toggle" -> {
                            // TTS toggle handled locally (ElevenLabs runs on phone)
                        }
                        "start_voice" -> {
                            // Glasses long-press → capture speech on the phone mic, then
                            // send the transcript to TARS as a user_input. The harness echoes
                            // the user turn and streams the reply back to the HUD.
                            voiceInput.start()
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error bridging glasses→TARS: ${e.message}")
                }
            }
        }
    }

    /** TARS → Glasses: relay all harness messages to the HUD */
    private fun bridgeTarsToGlasses() {
        scope.launch {
            // collect (NOT collectLatest) — every message must be forwarded; collectLatest
            // would cancel an in-flight forward when the next stream chunk arrives.
            tarsClient.incomingMessages.collect { json ->
                try {
                    val type = extractMessageType(json) ?: return@collect
                    if (type == "ping") return@collect

                    // Wake glasses before delivering content
                    when (type) {
                        "agent_thinking", "chat_stream", "chat_message" -> {
                            val msgId = try {
                                JsonParser.parseString(json).asJsonObject.get("id")?.asString
                            } catch (_: Exception) { null }
                            wakeSignalManager.wakeForContent(
                                reason = WakeSignal.REASON_STREAM_CONTENT,
                                messageId = msgId,
                            )
                        }
                    }

                    val glassesConnected = glassesManager.isConnected
                    Log.i(TAG, "forward→glasses [$type] (btConnected=$glassesConnected)")
                    glassesManager.send(json)

                } catch (e: Exception) {
                    Log.e(TAG, "Error bridging TARS→glasses: ${e.message}")
                }
            }
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            NOTIF_CHANNEL,
            "TARS Bridge",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "TARS ↔ Rokid glasses connection"
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        return Notification.Builder(this, NOTIF_CHANNEL)
            .setContentTitle("TARS")
            .setContentText("Connected to glasses")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .build()
    }
}
