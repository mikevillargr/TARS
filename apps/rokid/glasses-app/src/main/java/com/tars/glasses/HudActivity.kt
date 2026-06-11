package com.tars.glasses

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.tars.glasses.input.GestureHandler
import com.tars.glasses.service.PhoneConnectionService
import com.tars.glasses.ui.HudScreen
import com.tars.glasses.ui.HudSize
import com.tars.glasses.ui.HudChatEntry
import com.tars.glasses.ui.theme.TarsGlassesTheme
import com.tars.shared.*
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

/**
 * Main activity for the glasses HUD.
 *
 * Receives messages from the phone via PhoneConnectionService (Rokid CXR SDK
 * or debug WebSocket), maintains display state, handles touchpad gestures.
 */
class HudActivity : ComponentActivity() {

    private lateinit var phoneService: PhoneConnectionService
    private lateinit var gestureHandler: GestureHandler

    // ── Display state (driven by TARS streaming events) ───────────────────────
    private val messages = mutableListOf<HudChatEntry>()
    private var streamingId: String? = null
    private var streamingContent = ""
    private var isThinking = false
    private var connectionStatus = "TARS"
    private var hudSize = HudSize.FULL
    private var selectedMenuIndex = -1  // -1 = chat focus
    private var fontSize = 13

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        phoneService = PhoneConnectionService(this) { json -> handlePhoneMessage(json) }
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

    // ── Incoming messages from phone (TARS streaming events) ─────────────────

    private fun handlePhoneMessage(json: String) {
        val type = extractMessageType(json) ?: return

        when (type) {
            "chat_message" -> {
                val msg = ChatMessage.fromJson(json)
                // Finalize any streaming entry for this id
                if (msg.role == "assistant" && streamingId == msg.id) {
                    streamingId = null
                    streamingContent = ""
                    isThinking = false
                }
                messages.add(HudChatEntry(msg.id, msg.role, msg.content))
                renderHud()
            }

            "agent_thinking" -> {
                val thinking = AgentThinking.fromJson(json)
                streamingId = thinking.id
                isThinking = true
                streamingContent = ""
                renderHud()
            }

            "chat_stream" -> {
                val chunk = ChatStream.fromJson(json)
                if (streamingId == null) streamingId = chunk.id
                if (chunk.id == streamingId) {
                    isThinking = false
                    streamingContent += chunk.chunk
                    renderHud()
                }
            }

            "chat_stream_end" -> {
                val end = ChatStreamEnd.fromJson(json)
                if (end.id == streamingId) {
                    // chat_message with final content follows — handled above
                    isThinking = false
                }
                renderHud()
            }

            "connection_update" -> {
                val update = ConnectionUpdate.fromJson(json)
                connectionStatus = update.sessionName ?: "TARS"
                renderHud()
            }

            "wake_signal" -> {
                // Wake the display and ack immediately
                phoneService.send(WakeAck().toJson())
                renderHud()
            }
        }
    }

    // ── Touchpad gestures ────────────────────────────────────────────────────

    private fun onSwipeForward() {
        if (selectedMenuIndex >= 0) {
            selectedMenuIndex = (selectedMenuIndex - 1).coerceAtLeast(0)
        }
        // else: scroll handled by LazyColumn gesture
        renderHud()
    }

    private fun onSwipeBackward() {
        if (selectedMenuIndex >= 0) {
            selectedMenuIndex = (selectedMenuIndex + 1).coerceAtMost(3)
        }
        renderHud()
    }

    private fun onTap() {
        if (selectedMenuIndex >= 0) {
            executeMenuAction(selectedMenuIndex)
        }
        // else: scroll to bottom handled by LazyColumn state
        renderHud()
    }

    private fun onDoubleTap() {
        selectedMenuIndex = if (selectedMenuIndex < 0) 0 else -1
        renderHud()
    }

    private fun onLongPress() {
        // Request voice input from phone
        phoneService.send("""{"type":"start_voice"}""")
    }

    private fun executeMenuAction(index: Int) {
        when (index) {
            0 -> phoneService.send("""{"type":"capture_photo"}""")
            1 -> phoneService.send("""{"type":"list_sessions"}""")
            2 -> {
                hudSize = when (hudSize) {
                    HudSize.FULL -> HudSize.BOTTOM_HALF
                    HudSize.BOTTOM_HALF -> HudSize.TOP_HALF
                    HudSize.TOP_HALF -> HudSize.FULL
                }
            }
            3 -> {
                // Cycle font size: Compact(11) → Normal(13) → Comfortable(15) → Large(17)
                fontSize = when (fontSize) {
                    11 -> 13; 13 -> 15; 15 -> 17; else -> 11
                }
            }
        }
        renderHud()
    }

    // ── Render ───────────────────────────────────────────────────────────────

    private fun renderHud() {
        setContent {
            TarsGlassesTheme {
                HudScreen(
                    messages = messages.toList(),
                    streamingContent = streamingContent,
                    isThinking = isThinking,
                    connectionStatus = connectionStatus,
                    hudSize = hudSize,
                    selectedMenuIndex = selectedMenuIndex,
                    fontSize = fontSize,
                )
            }
        }
    }
}
