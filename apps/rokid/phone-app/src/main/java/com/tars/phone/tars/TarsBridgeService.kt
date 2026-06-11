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
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    lateinit var tarsClient: TarsClient
    lateinit var glassesManager: GlassesConnectionManager
    lateinit var wakeSignalManager: WakeSignalManager
    lateinit var authManager: TarsAuthManager

    override fun onCreate() {
        super.onCreate()
        tarsClient = TarsClient()
        glassesManager = GlassesConnectionManager.getInstance(this)
        wakeSignalManager = WakeSignalManager(glassesManager)
        authManager = TarsAuthManager(this)

        createNotificationChannel()
        startForeground(NOTIF_ID, buildNotification())

        bridgeGlassesToTars()
        bridgeTarsToGlasses()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val credentials = authManager.getSavedCredentials()
        if (credentials != null) {
            tarsClient.connect(authManager.getTarsClientConfig(credentials))
        } else {
            Log.w(TAG, "No TARS credentials saved — open Settings to configure")
        }
        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        tarsClient.destroy()
        glassesManager.stop()
        scope.cancel()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    /** Glasses → TARS: relay input and session commands */
    private fun bridgeGlassesToTars() {
        scope.launch {
            glassesManager.incomingMessages.collectLatest { json ->
                try {
                    val type = extractMessageType(json) ?: return@collectLatest
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
                            // Voice input handled by VoiceCommandHandler — see that module
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
            tarsClient.incomingMessages.collectLatest { json ->
                try {
                    val type = extractMessageType(json) ?: return@collectLatest

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

                    // Forward to glasses
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
