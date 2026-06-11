package com.tars.glasses.debug

import android.util.Log
import okhttp3.*
import okio.ByteString

/**
 * Debug replacement for PhoneConnectionService.
 *
 * In debug builds, the phone emulator starts a WebSocket server on port 8081.
 * The glasses emulator auto-connects here instead of using the CXR SDK.
 *
 * Usage:
 *   1. Run phone AVD (MainActivity will start debug WS server on :8081)
 *   2. Run glasses AVD — it connects to 10.0.2.2:8081 (Android emulator host)
 *   3. Messages flow exactly as they would on hardware
 *
 * To enable in debug builds, replace PhoneConnectionService with this class
 * in HudActivity:
 *   if (BuildConfig.DEBUG) DebugPhoneClient(onMessage).also { it.connect() }
 *   else PhoneConnectionService(context, onMessage)
 */
class DebugPhoneClient(
    private val onMessage: (String) -> Unit,
    private val serverUrl: String = "ws://10.0.2.2:8081",
) {
    companion object {
        private const val TAG = "DebugPhoneClient"
    }

    private val client = OkHttpClient()
    private var ws: WebSocket? = null

    fun connect() {
        Log.i(TAG, "Connecting to debug phone server at $serverUrl")
        val request = Request.Builder().url(serverUrl).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "Debug connection established")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                onMessage(text)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                onMessage(bytes.utf8())
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "Debug connection failed: ${t.message}")
            }
        })
    }

    fun send(json: String) {
        ws?.send(json)
    }

    fun disconnect() {
        ws?.close(1000, "Debug disconnect")
    }
}
