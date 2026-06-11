package com.tars.shared

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.annotations.SerializedName

/**
 * Shared protocol definitions for TARS ↔ Rokid glasses.
 *
 * Phone ↔ TARS Harness: TarsClient (JWT WebSocket)
 * Phone ↔ Glasses:      Rokid CXR-M SDK (Bluetooth) — these types
 *
 * Wire format is kept compatible with clawsses so the glasses-app
 * (forked from clawsses) works without modification.
 */

private val gson = Gson()

// ============================================
// Phone -> Glasses Messages
// ============================================

data class ChatMessage(
    @SerializedName("type") val type: String = "chat_message",
    @SerializedName("id") val id: String,
    @SerializedName("role") val role: String,
    @SerializedName("content") val content: String,
    @SerializedName("timestamp") val timestamp: Long = System.currentTimeMillis()
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): ChatMessage = gson.fromJson(json, ChatMessage::class.java)
    }
}

/** Harness acknowledged the request but no content yet — show thinking indicator. */
data class AgentThinking(
    @SerializedName("type") val type: String = "agent_thinking",
    @SerializedName("id") val id: String
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): AgentThinking = gson.fromJson(json, AgentThinking::class.java)
    }
}

/** Streaming text chunk — glasses append to message with this id. */
data class ChatStream(
    @SerializedName("type") val type: String = "chat_stream",
    @SerializedName("id") val id: String,
    @SerializedName("role") val role: String = "assistant",
    @SerializedName("chunk") val chunk: String
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): ChatStream = gson.fromJson(json, ChatStream::class.java)
    }
}

/** Streaming complete — remove cursor, mark message final. */
data class ChatStreamEnd(
    @SerializedName("type") val type: String = "chat_stream_end",
    @SerializedName("id") val id: String
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): ChatStreamEnd = gson.fromJson(json, ChatStreamEnd::class.java)
    }
}

data class ConnectionUpdate(
    @SerializedName("type") val type: String = "connection_update",
    @SerializedName("connected") val connected: Boolean,
    @SerializedName("sessionId") val sessionId: String? = null,
    @SerializedName("sessionName") val sessionName: String? = null
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): ConnectionUpdate = gson.fromJson(json, ConnectionUpdate::class.java)
    }
}

data class SessionListUpdate(
    @SerializedName("type") val type: String = "session_list",
    @SerializedName("sessions") val sessions: List<SessionInfo>,
    @SerializedName("currentSessionKey") val currentSessionKey: String? = null,
    @SerializedName("unreadSessionKeys") val unreadSessionKeys: List<String> = emptyList()
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): SessionListUpdate = gson.fromJson(json, SessionListUpdate::class.java)
    }
}

data class SessionInfo(
    @SerializedName("key") val key: String,
    @SerializedName("label") val label: String? = null,
    @SerializedName("displayName") val displayName: String? = null,
    @SerializedName("derivedTitle") val derivedTitle: String? = null,
    @SerializedName("updatedAt") val updatedAt: Long? = null,
    @SerializedName("kind") val kind: String? = null
) {
    val name: String get() = label ?: displayName ?: derivedTitle ?: key
}

// ============================================
// Glasses -> Phone Messages
// ============================================

data class UserInput(
    @SerializedName("type") val type: String = "user_input",
    @SerializedName("text") val text: String,
    @SerializedName("imageBase64") val imageBase64: String? = null
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): UserInput = gson.fromJson(json, UserInput::class.java)
    }
}

data class SessionAction(
    @SerializedName("type") val type: String,
    @SerializedName("sessionKey") val sessionKey: String? = null
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): SessionAction = gson.fromJson(json, SessionAction::class.java)
    }
}

data class SlashCommand(
    @SerializedName("type") val type: String = "slash_command",
    @SerializedName("command") val command: String
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): SlashCommand = gson.fromJson(json, SlashCommand::class.java)
    }
}

data class RequestMoreHistory(
    @SerializedName("type") val type: String = "request_more_history",
    @SerializedName("beforeMessageId") val beforeMessageId: String? = null
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): RequestMoreHistory = gson.fromJson(json, RequestMoreHistory::class.java)
    }
}

// ============================================
// Wake Signal Protocol
// ============================================

data class WakeSignal(
    @SerializedName("type") val type: String = "wake_signal",
    @SerializedName("reason") val reason: String,
    @SerializedName("bufferedCount") val bufferedCount: Int = 0,
    @SerializedName("messageId") val messageId: String? = null,
    @SerializedName("timestamp") val timestamp: Long = System.currentTimeMillis()
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        const val REASON_STREAM_CONTENT = "stream_content"
        const val REASON_NEW_MESSAGE = "new_message"
        const val REASON_CRON_MESSAGE = "cron_message"
        fun fromJson(json: String): WakeSignal = gson.fromJson(json, WakeSignal::class.java)
    }
}

data class WakeAck(
    @SerializedName("type") val type: String = "wake_ack",
    @SerializedName("ready") val ready: Boolean = true,
    @SerializedName("timestamp") val timestamp: Long = System.currentTimeMillis()
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): WakeAck = gson.fromJson(json, WakeAck::class.java)
    }
}

// ============================================
// TTS State
// ============================================

data class TtsToggle(
    @SerializedName("type") val type: String = "tts_toggle",
    @SerializedName("enabled") val enabled: Boolean
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): TtsToggle = gson.fromJson(json, TtsToggle::class.java)
    }
}

data class TtsState(
    @SerializedName("type") val type: String = "tts_state",
    @SerializedName("enabled") val enabled: Boolean,
    @SerializedName("voiceName") val voiceName: String? = null
) {
    fun toJson(): String = gson.toJson(this)
    companion object {
        fun fromJson(json: String): TtsState = gson.fromJson(json, TtsState::class.java)
    }
}

// ============================================
// Utility
// ============================================

fun extractMessageType(json: String): String? {
    return try {
        JsonParser.parseString(json).asJsonObject.get("type")?.asString
    } catch (e: Exception) {
        null
    }
}
