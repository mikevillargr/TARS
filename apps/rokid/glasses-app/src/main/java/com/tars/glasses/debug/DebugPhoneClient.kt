package com.tars.glasses.debug

import android.util.Log
import okhttp3.*
import okio.ByteString

/**
 * Debug replacement for the CXR-S Bluetooth bridge.
 *
 * When running on an emulator, the phone emulator starts a WebSocket server on
 * port 8081. The glasses emulator connects here instead of using Bluetooth.
 *
 * To enable: pass debugMode=true to PhoneConnectionService (auto-detected when
 * Build.FINGERPRINT contains "generic" — i.e. AVD).
 *
 * Setup:
 *   adb -s <glasses-emulator> reverse tcp:8081 tcp:8081
 *   (or the phone emulator exposes it at 10.0.2.2:8081)
 */
class DebugPhoneClient {

    companion object {
        private const val TAG = "DebugPhoneClient"
        const val DEFAULT_HOST = "10.0.2.2"
        const val DEFAULT_PORT = 8081
    }

    var onMessageFromPhone: ((String) -> Unit)? = null
    var onConnected: (() -> Unit)? = null
    var onDisconnected: (() -> Unit)? = null

    private val httpClient = OkHttpClient()
    private var ws: WebSocket? = null

    fun connect(host: String = DEFAULT_HOST, port: Int = DEFAULT_PORT) {
        val url = "ws://$host:$port"
        Log.i(TAG, "Connecting to debug phone server: $url")
        val request = Request.Builder().url(url).build()
        ws = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Debug connection open")
                onConnected?.invoke()
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                onMessageFromPhone?.invoke(text)
            }
            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                onMessageFromPhone?.invoke(bytes.utf8())
            }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.i(TAG, "Debug connection closed: $code $reason")
                onDisconnected?.invoke()
            }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Debug connection failed: ${t.message}")
                onDisconnected?.invoke()
            }
        })
    }

    fun sendToPhone(json: String) {
        ws?.send(json)
    }

    fun disconnect() {
        ws?.close(1000, "Debug disconnect")
        ws = null
    }
}
