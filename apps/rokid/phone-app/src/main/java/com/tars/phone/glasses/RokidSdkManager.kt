package com.tars.phone.glasses

import android.content.Context
import android.util.Log

/**
 * Thin wrapper around the Rokid CXR-M SDK.
 *
 * SDK credentials are injected at compile time from local.properties:
 *   rokid.clientSecret=...
 *   rokid.accessKey=...
 *
 * In DEBUG builds (emulator), replace this with DebugGlassesServer which
 * listens on a local WebSocket — see DebugGlassesServer.kt.
 *
 * Substitute real CXR SDK calls where marked TODO below.
 * Full SDK docs: apps/rokid/docs/rokid-sdk-glasses/
 */
class RokidSdkManager(
    private val context: Context,
    private val onMessage: (String) -> Unit,
) {

    companion object {
        private const val TAG = "RokidSdkManager"
        // Injected from local.properties at build time
        // private val CLIENT_SECRET = BuildConfig.ROKID_CLIENT_SECRET
        // private val ACCESS_KEY = BuildConfig.ROKID_ACCESS_KEY
    }

    var isConnected: Boolean = false
        private set

    fun init() {
        // TODO: Initialize Rokid CXR SDK
        // Example (from SDK docs):
        //   CXRManager.getInstance().init(context, CLIENT_SECRET, ACCESS_KEY)
        //   CXRManager.getInstance().setConnectionListener { connected ->
        //       isConnected = connected
        //   }
        //   CXRManager.getInstance().setMessageListener { json ->
        //       onMessage(json)
        //   }
        Log.i(TAG, "RokidSdkManager init (stub — wire in CXR SDK here)")
    }

    fun send(json: String) {
        // TODO: CXRManager.getInstance().sendMessage(json)
        Log.d(TAG, "→ glasses: ${json.take(100)}")
    }

    fun wakeDisplay() {
        // TODO: CXRManager.getInstance().wakeDevice()
        Log.d(TAG, "wake display")
    }

    fun release() {
        // TODO: CXRManager.getInstance().release()
        isConnected = false
    }
}
