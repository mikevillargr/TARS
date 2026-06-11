package com.tars.glasses

import android.os.Bundle
import android.util.Log
import android.view.MotionEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.tars.glasses.input.GestureHandler
import com.tars.glasses.service.PhoneConnectionService
import com.tars.glasses.ui.HudScreen
import com.tars.glasses.ui.HudSize
import com.tars.glasses.ui.HudChatEntry
import com.tars.glasses.ui.theme.TarsGlassesTheme
import com.tars.shared.*

class HudActivity : ComponentActivity() {

    private lateinit var phoneService: PhoneConnectionService
    private lateinit var gestureHandler: GestureHandler

    private val messages = mutableListOf<HudChatEntry>()
    private var streamingId: String? = null
    private var streamingContent = ""
    private var isThinking = false
    private var connectionStatus = "TARS"
    private var hudSize = HudSize.FULL
    private var selectedMenuIndex = -1
    private var fontSize = 13

    // Debug: visible on the HUD so we can confirm messages arrive without glasses logs.
    private var rxCount = 0
    private var lastRx = "—"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep the micro-LED on and show over lock/standby so streamed content is visible.
        window.addFlags(
            WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
        )

        // Set debugMode = true when running on emulator, false on hardware
        val debugMode = android.os.Build.FINGERPRINT.contains("generic")

        phoneService = PhoneConnectionService(
            context = this,
            onMessage = ::handlePhoneMessage,
            debugMode = debugMode,
        )

        gestureHandler = GestureHandler(
            onSwipeForward = ::onSwipeForward,
            onSwipeBackward = ::onSwipeBackward,
            onTap = ::onTap,
            onDoubleTap = ::onDoubleTap,
            onLongPress = ::onLongPress,
        )

        phoneService.start()
        renderHud()
    }

    override fun onDestroy() {
        super.onDestroy()
        phoneService.stop()
    }

    // Route all touch events through GestureHandler before normal dispatch
    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (gestureHandler.onTouchEvent(ev)) return true
        return super.dispatchTouchEvent(ev)
    }

    // ── Incoming messages from phone ──────────────────────────────────────────

    private fun handlePhoneMessage(json: String) {
        val type = extractMessageType(json) ?: return
        Log.i("HudActivity", "rx [$type]: ${json.take(120)}")
        runOnUiThread {
            rxCount++
            lastRx = type
            when (type) {
                "chat_message" -> {
                    val msg = ChatMessage.fromJson(json)
                    if (msg.role == "assistant" && streamingId == msg.id) {
                        streamingId = null
                        streamingContent = ""
                        isThinking = false
                    }
                    messages.add(HudChatEntry(msg.id, msg.role, msg.content))
                }
                "agent_thinking" -> {
                    val t = AgentThinking.fromJson(json)
                    streamingId = t.id
                    isThinking = true
                    streamingContent = ""
                }
                "chat_stream" -> {
                    val chunk = ChatStream.fromJson(json)
                    if (streamingId == null) streamingId = chunk.id
                    if (chunk.id == streamingId) {
                        isThinking = false
                        streamingContent += chunk.chunk
                    }
                }
                "chat_stream_end" -> {
                    // Final chat_message follows — clears streaming state above
                }
                "connection_update" -> {
                    val update = ConnectionUpdate.fromJson(json)
                    connectionStatus = update.sessionName ?: "TARS"
                }
                "wake_signal" -> {
                    phoneService.send(WakeAck().toJson())
                }
            }
            renderHud()
        }
    }

    // ── Gestures ──────────────────────────────────────────────────────────────

    private fun onSwipeForward() {
        if (selectedMenuIndex >= 0) selectedMenuIndex = (selectedMenuIndex - 1).coerceAtLeast(0)
        renderHud()
    }

    private fun onSwipeBackward() {
        if (selectedMenuIndex >= 0) selectedMenuIndex = (selectedMenuIndex + 1).coerceAtMost(3)
        renderHud()
    }

    private fun onTap() {
        if (selectedMenuIndex >= 0) executeMenuAction(selectedMenuIndex)
        renderHud()
    }

    private fun onDoubleTap() {
        selectedMenuIndex = if (selectedMenuIndex < 0) 0 else -1
        renderHud()
    }

    private fun onLongPress() {
        phoneService.send("""{"type":"start_voice"}""")
    }

    private fun executeMenuAction(index: Int) {
        when (index) {
            0 -> phoneService.send("""{"type":"capture_photo"}""")
            1 -> phoneService.send("""{"type":"list_sessions"}""")
            2 -> hudSize = when (hudSize) {
                HudSize.FULL -> HudSize.BOTTOM_HALF
                HudSize.BOTTOM_HALF -> HudSize.TOP_HALF
                HudSize.TOP_HALF -> HudSize.FULL
            }
            3 -> fontSize = when (fontSize) { 11 -> 13; 13 -> 15; 15 -> 17; else -> 11 }
        }
        renderHud()
    }

    // ── Render ────────────────────────────────────────────────────────────────

    private fun renderHud() {
        setContent {
            TarsGlassesTheme {
                HudScreen(
                    messages = messages.toList(),
                    streamingContent = streamingContent,
                    isThinking = isThinking,
                    connectionStatus = "$connectionStatus · rx:$rxCount $lastRx",
                    hudSize = hudSize,
                    selectedMenuIndex = selectedMenuIndex,
                    fontSize = fontSize,
                )
            }
        }
    }
}
