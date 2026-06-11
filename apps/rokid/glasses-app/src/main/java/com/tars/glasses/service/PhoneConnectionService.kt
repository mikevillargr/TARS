package com.tars.glasses.service

import android.content.Context
import android.util.Log
import com.rokid.cxr.Caps
import com.rokid.cxr.CXRServiceBridge
import com.tars.glasses.debug.DebugPhoneClient
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Glasses-side connection to the phone app via Rokid CXR-S SDK.
 *
 * The CXR-S SDK runs a system service on the glasses that maintains the
 * Bluetooth connection to the phone. We bind to it via CXRServiceBridge.
 *
 * Debug mode: connects via WebSocket to the phone emulator (port 8081)
 * instead of Bluetooth — no hardware required.
 */
class PhoneConnectionService(
    private val context: Context,
    private val onMessage: (String) -> Unit,
    private val debugMode: Boolean = false,
    private val debugHost: String = DebugPhoneClient.DEFAULT_HOST,
    private val debugPort: Int = DebugPhoneClient.DEFAULT_PORT,
) {
    companion object {
        private const val TAG = "PhoneConnection"
        private const val MSG_TYPE_TERMINAL = "terminal"
        private const val MSG_TYPE_COMMAND = "command"
    }

    private var cxrBridge: CXRServiceBridge? = null
    private var debugClient: DebugPhoneClient? = null
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private var isConnected = false
    private var probeJob: Job? = null

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState

    sealed class ConnectionState {
        object Disconnected : ConnectionState()
        object Connecting : ConnectionState()
        data class Connected(val info: String) : ConnectionState()
        data class Error(val message: String) : ConnectionState()
    }

    fun start() {
        if (debugMode) {
            Log.d(TAG, "Debug mode — connecting WebSocket to $debugHost:$debugPort")
            startDebugConnection()
        } else {
            Log.d(TAG, "Starting CXR Service Bridge")
            try { initializeBridge() } catch (e: Exception) {
                Log.e(TAG, "CXR bridge init failed", e)
                _connectionState.value = ConnectionState.Error(e.message ?: "Unknown")
            }
        }
    }

    private fun startDebugConnection() {
        _connectionState.value = ConnectionState.Connecting
        debugClient = DebugPhoneClient().apply {
            onMessageFromPhone = { message ->
                markConnected("Debug")
                onMessage(message)
            }
            onConnected = {
                isConnected = true
                _connectionState.value = ConnectionState.Connected("Debug ($debugHost:$debugPort)")
            }
            onDisconnected = {
                isConnected = false
                _connectionState.value = ConnectionState.Disconnected
            }
            connect(debugHost, debugPort)
        }
    }

    private fun initializeBridge() {
        cxrBridge = CXRServiceBridge()
        _connectionState.value = ConnectionState.Connecting

        cxrBridge?.setStatusListener(object : CXRServiceBridge.StatusListener {
            override fun onConnected(name: String?, mac: String?, deviceType: Int) {
                Log.i(TAG, "Phone connected: $name ($mac)")
                markConnected("$name ($mac)")
            }
            override fun onDisconnected() {
                Log.i(TAG, "Phone disconnected")
                isConnected = false
                _connectionState.value = ConnectionState.Disconnected
            }
            override fun onConnecting(name: String?, mac: String?, deviceType: Int) {
                _connectionState.value = ConnectionState.Connecting
            }
            override fun onARTCStatus(latency: Float, connected: Boolean) {
                if (connected) markConnected("Phone (ARTC)")
            }
            override fun onRokidAccountChanged(account: String?) {}
        })

        // Subscribe to messages from the phone app.
        // The phone sends via RokidSdkManager.send() → CxrApi.sendCustomCmd("command", caps),
        // which routes through CxrController.request(..., "command", ...) — so the wire topic
        // is "command". We subscribe to "command" (the real channel) AND "terminal" (clawsses
        // legacy) so we catch the phone's messages regardless of which path the SDK uses.
        val msgCallback = object : CXRServiceBridge.MsgCallback {
            override fun onReceive(msgType: String?, caps: Caps?, data: ByteArray?) {
                val message = when {
                    data != null && data.isNotEmpty() -> String(data, Charsets.UTF_8)
                    caps != null && caps.size() > 0 -> try {
                        caps.at(0).getString()
                    } catch (e: Exception) { "" }
                    else -> ""
                }
                if (message.isNotEmpty()) {
                    Log.d(TAG, "from phone [$msgType]: ${message.take(120)}")
                    markConnected("Phone (message)")
                    onMessage(message)
                }
            }
        }
        cxrBridge?.subscribe(MSG_TYPE_COMMAND, msgCallback)
        cxrBridge?.subscribe(MSG_TYPE_TERMINAL, msgCallback)

        startConnectionProbe()
    }

    /** Send a JSON message from glasses to phone. */
    fun send(json: String) {
        if (!isConnected) {
            Log.w(TAG, "send: not connected to phone")
            return
        }
        if (debugMode) {
            debugClient?.sendToPhone(json)
        } else {
            try {
                val caps = Caps()
                caps.write(json)
                cxrBridge?.sendMessage(MSG_TYPE_COMMAND, caps)
            } catch (e: Exception) {
                Log.e(TAG, "send failed: ${e.message}")
            }
        }
    }

    fun stop() {
        probeJob?.cancel()
        scope.cancel()
        if (debugMode) {
            debugClient?.disconnect()
            debugClient = null
        } else {
            // Don't call disconnectCXRDevice() — that tears down the system BT connection.
            // Just drop our reference; the system service keeps the BT link alive.
            cxrBridge = null
        }
        isConnected = false
        _connectionState.value = ConnectionState.Disconnected
    }

    private fun markConnected(info: String) {
        if (!isConnected) {
            isConnected = true
            _connectionState.value = ConnectionState.Connected(info)
        }
        probeJob?.cancel()
    }

    // Send request_state probes to detect a pre-existing BT connection.
    // The CXRServiceBridge doesn't replay onConnected for connections established
    // before this instance was created, so we probe actively.
    private fun startConnectionProbe() {
        probeJob = scope.launch {
            delay(2000)
            repeat(10) { i ->
                if (isConnected) return@launch
                try {
                    val caps = Caps()
                    caps.write("""{"type":"request_state"}""")
                    withContext(Dispatchers.Main) {
                        cxrBridge?.sendMessage(MSG_TYPE_COMMAND, caps)
                    }
                } catch (_: Exception) {}
                delay(3000)
            }
        }
    }
}
