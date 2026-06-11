package com.tars.phone.tars

import android.util.Log
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.tars.shared.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import okhttp3.*
import okio.ByteString
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * WebSocket client for connecting to TARS harness at /api/rokid/ws?token=<jwt>.
 *
 * Differences from clawsses' OpenClawClient:
 *   - JWT auth via query param (no Ed25519 device identity, no pairing flow)
 *   - Single active conversation instead of multi-session (sessions still supported via switch_session)
 *   - Protocol is TARS-native JSON (same phone↔glasses wire format as clawsses)
 */
class TarsClient {

    companion object {
        private const val TAG = "TarsClient"
        private const val RECONNECT_DELAY_MS = 3000L
    }

    sealed class ConnectionState {
        object Disconnected : ConnectionState()
        object Connecting : ConnectionState()
        object Connected : ConnectionState()
        data class Error(val message: String) : ConnectionState()
    }

    private val gson = Gson()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    // Messages that phone should relay to glasses
    private val _incomingMessages = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val incomingMessages: SharedFlow<String> = _incomingMessages.asSharedFlow()

    private var ws: WebSocket? = null
    private var config: TarsConfig? = null
    private var shouldReconnect = false

    data class TarsConfig(
        val host: String,
        val port: Int,
        val token: String,
        val useTls: Boolean = false,
    ) {
        val wsUrl: String get() {
            val scheme = if (useTls) "wss" else "ws"
            return "$scheme://$host:$port/api/rokid/ws?token=$token"
        }
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    fun connect(config: TarsConfig) {
        this.config = config
        shouldReconnect = true
        _connectionState.value = ConnectionState.Connecting
        openWebSocket(config)
    }

    fun disconnect() {
        shouldReconnect = false
        ws?.close(1000, "User disconnected")
        ws = null
        _connectionState.value = ConnectionState.Disconnected
    }

    /** Send a user message (text + optional base64 image) to TARS. */
    fun sendUserInput(text: String, imageBase64: String? = null) {
        val payload = JsonObject().apply {
            addProperty("type", "user_input")
            addProperty("text", text)
            imageBase64?.let { addProperty("imageBase64", it) }
        }
        sendRaw(gson.toJson(payload))
    }

    /** Request the session/conversation list. */
    fun listSessions() {
        sendRaw("""{"type":"list_sessions"}""")
    }

    /** Switch to a specific TARS conversation. */
    fun switchSession(sessionKey: String) {
        val payload = JsonObject().apply {
            addProperty("type", "switch_session")
            addProperty("sessionKey", sessionKey)
        }
        sendRaw(gson.toJson(payload))
    }

    /** Create a new TARS conversation. */
    fun createSession() {
        sendRaw("""{"type":"create_session"}""")
    }

    /** Acknowledge a wake signal from the harness. */
    fun sendWakeAck() {
        sendRaw(WakeAck().toJson())
    }

    private fun sendRaw(json: String) {
        val socket = ws
        if (socket == null) {
            Log.w(TAG, "sendRaw: not connected, dropping: ${json.take(80)}")
            return
        }
        socket.send(json)
    }

    private fun openWebSocket(config: TarsConfig) {
        val request = Request.Builder()
            .url(config.wsUrl)
            .build()

        ws = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Connected to TARS at ${config.host}:${config.port}")
                _connectionState.value = ConnectionState.Connected
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                scope.launch {
                    // Emit to glasses bridge — GlassesConnectionManager subscribes here
                    _incomingMessages.emit(text)

                    // Also update local connection state if this is a connection_update
                    try {
                        val obj = JsonParser.parseString(text).asJsonObject
                        if (obj.get("type")?.asString == "connection_update") {
                            val connected = obj.get("connected")?.asBoolean ?: false
                            if (connected) {
                                _connectionState.value = ConnectionState.Connected
                            } else {
                                _connectionState.value = ConnectionState.Disconnected
                            }
                        }
                    } catch (_: Exception) {}
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                onMessage(webSocket, bytes.utf8())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure: ${t.message}")
                _connectionState.value = ConnectionState.Error(t.message ?: "Connection failed")
                scheduleReconnect()
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "WebSocket closed: $code $reason")
                _connectionState.value = ConnectionState.Disconnected
                if (code != 1000) {
                    scheduleReconnect()
                }
            }
        })
    }

    private fun scheduleReconnect() {
        if (!shouldReconnect) return
        val cfg = config ?: return
        scope.launch {
            delay(RECONNECT_DELAY_MS)
            if (shouldReconnect) {
                Log.i(TAG, "Reconnecting to TARS…")
                _connectionState.value = ConnectionState.Connecting
                openWebSocket(cfg)
            }
        }
    }

    fun destroy() {
        shouldReconnect = false
        ws?.close(1000, "Destroying client")
        ws = null
        scope.cancel()
    }
}
