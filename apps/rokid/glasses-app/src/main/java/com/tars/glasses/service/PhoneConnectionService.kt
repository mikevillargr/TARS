package com.tars.glasses.service

import android.content.Context
import android.util.Log

/**
 * Manages the CXR-M SDK connection from glasses back to the phone app.
 *
 * In debug builds the glasses emulator connects via local WebSocket
 * (see DebugPhoneClient.kt). In release, wire in the actual CXR SDK calls.
 *
 * onMessage: called on the main thread with each JSON message from phone.
 */
class PhoneConnectionService(
    private val context: Context,
    private val onMessage: (String) -> Unit,
) {
    companion object {
        private const val TAG = "PhoneConnectionService"
    }

    fun start() {
        // TODO: Initialize CXR-M glasses-side SDK and register listener
        // CXRGlassesSDK.init(context)
        // CXRGlassesSDK.setMessageListener { json -> onMessage(json) }
        Log.i(TAG, "PhoneConnectionService started (stub)")
    }

    fun send(json: String) {
        // TODO: CXRGlassesSDK.sendMessage(json)
        Log.d(TAG, "→ phone: ${json.take(100)}")
    }

    fun stop() {
        // TODO: CXRGlassesSDK.release()
    }
}
