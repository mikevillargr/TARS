package com.tars.phone.glasses

import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/**
 * Manages the Bluetooth CXR-M SDK connection to Rokid glasses.
 *
 * In DEBUG builds this is replaced by DebugGlassesServer (local WebSocket).
 *
 * Public interface mirrors clawsses' GlassesConnectionManager so the
 * bridge service works identically for both targets.
 */
class GlassesConnectionManager(private val context: Context) {

    companion object {
        private const val TAG = "GlassesConnectionManager"
    }

    private val _incomingMessages = MutableSharedFlow<String>(extraBufferCapacity = 64)

    /** Messages sent from glasses to phone (user_input, session actions, wake_ack, etc.) */
    val incomingMessages: SharedFlow<String> = _incomingMessages.asSharedFlow()

    private var rokidSdkManager: RokidSdkManager? = null

    fun start() {
        rokidSdkManager = RokidSdkManager(context) { json ->
            _incomingMessages.tryEmit(json)
        }
        rokidSdkManager?.init()
        Log.i(TAG, "Glasses connection manager started")
    }

    fun stop() {
        rokidSdkManager?.release()
        rokidSdkManager = null
    }

    /** Send a JSON message from phone to glasses. */
    fun send(json: String) {
        rokidSdkManager?.send(json) ?: Log.w(TAG, "send: no glasses connected")
    }

    /** Wake glasses display via CXR SDK. */
    fun wakeDisplay() {
        rokidSdkManager?.wakeDisplay()
    }

    val isConnected: Boolean get() = rokidSdkManager?.isConnected == true
}
