package com.clawsses.phone.openclaw

import android.util.Log
import com.clawsses.shared.AgentThinking
import com.clawsses.shared.ChatMessage
import com.clawsses.shared.ChatStream
import com.clawsses.shared.ChatStreamEnd
import com.clawsses.shared.ConnectionUpdate
import com.clawsses.shared.OpenClawEvent
import com.clawsses.shared.SessionInfo
import com.clawsses.shared.SessionListUpdate
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import java.util.concurrent.TimeUnit

/**
 * Backend client for the TARS harness.
 *
 * This is the clawsses `OpenClawClient` retrofitted to talk to TARS instead of an
 * OpenClaw Gateway. The public surface (state flows, callbacks, methods) is kept
 * identical so the rest of the phone app — a straight copy of clawsses — works
 * unchanged. Only the transport changed:
 *
 *   - Connects to  ws(s)://host:port/api/rokid/ws?token=<jwt>
 *   - JWT obtained via POST /api/auth/login {username,password} -> {token}
 *   - The harness already speaks the phone↔glasses wire format (chat_message,
 *     agent_thinking, chat_stream, chat_stream_end, connection_update, session_list),
 *     so incoming frames map directly onto the existing callbacks.
 *
 * No Ed25519 device identity, no pairing, no request/response correlation — the
 * `deviceIdentity` constructor arg is kept for source compatibility but unused.
 */
class OpenClawClient(
    @Suppress("UNUSED_PARAMETER") private val deviceIdentity: DeviceIdentity
) {
    companion object {
        private const val TAG = "TarsClient"
        private const val RECONNECT_DELAY_MS = 3000L
    }

    sealed class ConnectionState {
        object Disconnected : ConnectionState()
        object Connecting : ConnectionState()
        object Authenticating : ConnectionState()
        object Connected : ConnectionState()
        data class PairingRequired(val message: String) : ConnectionState()
        data class Error(val message: String) : ConnectionState()
    }

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _chatMessages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val chatMessages: StateFlow<List<ChatMessage>> = _chatMessages.asStateFlow()

    private val _events = MutableSharedFlow<OpenClawEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<OpenClawEvent> = _events.asSharedFlow()

    // Callbacks (set by MainScreen) — fired on the message-routing path.
    var onChatMessage: ((ChatMessage) -> Unit)? = null
    var onChatHistory: ((List<ChatMessage>) -> Unit)? = null
    var onAgentThinking: ((AgentThinking) -> Unit)? = null
    var onChatStream: ((ChatStream) -> Unit)? = null
    var onChatStreamEnd: ((ChatStreamEnd) -> Unit)? = null
    var onSessionList: ((SessionListUpdate) -> Unit)? = null
    var onConnectionUpdate: ((ConnectionUpdate) -> Unit)? = null
    var onMoreHistoryLoaded: ((Int, Boolean) -> Unit)? = null

    private val _currentSessionKey = MutableStateFlow<String?>(null)
    val currentSessionKey: StateFlow<String?> = _currentSessionKey.asStateFlow()

    private val _isLoadingMoreHistory = MutableStateFlow(false)
    val isLoadingMoreHistory: StateFlow<Boolean> = _isLoadingMoreHistory.asStateFlow()

    private val _unreadSessions = MutableStateFlow<Set<String>>(emptySet())
    val unreadSessions: StateFlow<Set<String>> = _unreadSessions.asStateFlow()

    private val _sessionList = MutableStateFlow<List<SessionInfo>>(emptyList())
    val sessionList: StateFlow<List<SessionInfo>> = _sessionList.asStateFlow()

    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS) // long-lived WS
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private var webSocket: WebSocket? = null
    private var host: String = ""
    private var port: Int = 8000
    private var token: String = ""
    private var useTls: Boolean = false
    private var shouldReconnect = false

    private fun schemeFor(secure: Boolean, ws: Boolean): String =
        if (ws) (if (secure) "wss" else "ws") else (if (secure) "https" else "http")

    private fun inferTls(port: Int): Boolean = port == 443 || port == 8443

    // ── Auth ────────────────────────────────────────────────────────────────

    /**
     * Log into the TARS harness and return a JWT, or null on failure.
     * Call before [connect]; pass the returned token in.
     */
    suspend fun login(host: String, port: Int, username: String, password: String): String? =
        withContext(Dispatchers.IO) {
            _connectionState.value = ConnectionState.Authenticating
            val secure = inferTls(port)
            val url = "${schemeFor(secure, ws = false)}://$host:$port/api/auth/login"
            val payload = JsonObject().apply {
                addProperty("username", username)
                addProperty("password", password)
            }.toString().toRequestBody("application/json".toMediaType())
            val req = Request.Builder().url(url).post(payload).build()
            try {
                httpClient.newCall(req).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    if (!resp.isSuccessful) {
                        Log.w(TAG, "login failed: ${resp.code} $text")
                        _connectionState.value = ConnectionState.Error("Login failed (${resp.code})")
                        return@withContext null
                    }
                    val jwt = JsonParser.parseString(text).asJsonObject.get("token")?.asString
                    if (jwt.isNullOrEmpty()) {
                        _connectionState.value = ConnectionState.Error("Login returned no token")
                        null
                    } else jwt
                }
            } catch (e: Exception) {
                Log.e(TAG, "login error: ${e.message}")
                _connectionState.value = ConnectionState.Error("Login error: ${e.message}")
                null
            }
        }

    // ── Connection ──────────────────────────────────────────────────────────

    fun connect(host: String, port: Int, token: String) {
        this.host = host
        this.port = port
        this.token = token
        this.useTls = inferTls(port)
        this.shouldReconnect = true
        openSocket()
    }

    private fun openSocket() {
        if (token.isEmpty()) {
            _connectionState.value = ConnectionState.Error("No token — log in first")
            return
        }
        _connectionState.value = ConnectionState.Connecting
        val url = "${schemeFor(useTls, ws = true)}://$host:$port/api/rokid/ws?token=$token"
        Log.i(TAG, "connecting: ${url.substringBefore("?token=")}")
        val request = Request.Builder().url(url).build()
        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "WS open")
                _connectionState.value = ConnectionState.Connected
            }

            override fun onMessage(ws: WebSocket, text: String) = route(text)
            override fun onMessage(ws: WebSocket, bytes: ByteString) = route(bytes.utf8())

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WS failure: ${t.message}")
                _connectionState.value = ConnectionState.Error(t.message ?: "Connection failed")
                scheduleReconnect()
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "WS closed: $code $reason")
                if (_connectionState.value !is ConnectionState.Error) {
                    _connectionState.value = ConnectionState.Disconnected
                }
                if (code != 1000) scheduleReconnect()
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        scope.launch {
            delay(RECONNECT_DELAY_MS)
            if (shouldReconnect) {
                Log.i(TAG, "reconnecting…")
                openSocket()
            }
        }
    }

    fun disconnect() {
        shouldReconnect = false
        webSocket?.close(1000, "User disconnected")
        webSocket = null
        _connectionState.value = ConnectionState.Disconnected
    }

    fun cleanup() {
        disconnect()
        scope.cancel()
    }

    // ── Incoming frames (TARS → app) ──────────────────────────────────────────

    @Suppress("USELESS_ELVIS") // Gson bypasses Kotlin null-safety: "non-null" fields CAN be null
    private fun route(json: String) {
        // Never let a malformed frame kill the WebSocket — log and move on.
        try {
            val type = JsonParser.parseString(json).asJsonObject.get("type")?.asString ?: return

            when (type) {
                "connection_update" -> {
                    val u = ConnectionUpdate.fromJson(json)
                    u.sessionId?.let { _currentSessionKey.value = it }
                    _connectionState.value = ConnectionState.Connected
                    onConnectionUpdate?.invoke(u)
                }
                "session_list" -> {
                    val s = SessionListUpdate.fromJson(json)
                    _sessionList.value = s.sessions ?: emptyList()
                    _unreadSessions.value = (s.unreadSessionKeys ?: emptyList()).toSet()
                    s.currentSessionKey?.let { _currentSessionKey.value = it }
                    onSessionList?.invoke(s)
                }
                "chat_message" -> {
                    val m = ChatMessage.fromJson(json)
                    _chatMessages.value = _chatMessages.value + m
                    onChatMessage?.invoke(m)
                }
                "agent_thinking" -> onAgentThinking?.invoke(AgentThinking.fromJson(json))
                "chat_stream" -> onChatStream?.invoke(ChatStream.fromJson(json))
                "chat_stream_end" -> onChatStreamEnd?.invoke(ChatStreamEnd.fromJson(json))
                "ping" -> { /* keepalive */ }
                else -> Log.d(TAG, "unhandled frame: $type")
            }
        } catch (e: Exception) {
            Log.e(TAG, "frame handling error (${json.take(80)}): ${e.message}")
        }
    }

    // ── Outgoing (app → TARS) ─────────────────────────────────────────────────

    private fun send(obj: JsonObject) {
        val ws = webSocket
        if (ws == null) {
            Log.w(TAG, "send dropped (not connected): $obj")
            return
        }
        ws.send(obj.toString())
    }

    fun sendMessage(text: String, images: List<String>? = null) {
        // The harness echoes the user turn back as a chat_message, so we don't add
        // it locally (avoids duplicates). Just send the input.
        val obj = JsonObject().apply {
            addProperty("type", "user_input")
            addProperty("text", text)
            images?.firstOrNull()?.let { addProperty("imageBase64", it) }
        }
        send(obj)
    }

    fun sendSlashCommand(command: String) {
        // TARS has no slash-command protocol; send as plain text.
        sendMessage(if (command.startsWith("/")) command else "/$command")
    }

    fun requestSessions() {
        send(JsonObject().apply { addProperty("type", "list_sessions") })
    }

    fun switchSession(sessionKey: String) {
        _currentSessionKey.value = sessionKey
        _chatMessages.value = emptyList()
        _unreadSessions.value = _unreadSessions.value - sessionKey
        send(JsonObject().apply {
            addProperty("type", "switch_session")
            addProperty("sessionKey", sessionKey)
        })
    }

    fun createSession() {
        _chatMessages.value = emptyList()
        send(JsonObject().apply { addProperty("type", "create_session") })
    }

    fun loadSessionHistory(sessionKey: String? = null) {
        // Harness has no history replay; switching reloads the session context.
        val key = sessionKey ?: _currentSessionKey.value ?: return
        switchSession(key)
        onChatHistory?.invoke(emptyList())
    }

    fun loadMoreHistory() {
        // No server-side pagination — report "nothing more" so the UI settles.
        _isLoadingMoreHistory.value = false
        onMoreHistoryLoaded?.invoke(0, false)
    }
}
