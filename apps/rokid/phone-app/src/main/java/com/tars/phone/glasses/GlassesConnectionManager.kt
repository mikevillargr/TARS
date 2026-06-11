package com.tars.phone.glasses

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.Context
import android.util.Log
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Manages the full Bluetooth lifecycle with Rokid glasses via RokidSdkManager.
 *
 * Usage:
 *   1. start() — initializes SDK and tries to reconnect to saved glasses
 *   2. scan() → returns BluetoothDevice list from paired devices
 *   3. connect(device) — initiates Bluetooth init with a scanned device
 *   4. After onConnected, send() works
 */
class GlassesConnectionManager(private val context: Context) {

    companion object {
        private const val TAG = "GlassesConnectionManager"
    }

    sealed class GlassesState {
        object Disconnected : GlassesState()
        object Connecting : GlassesState()
        data class Connected(val deviceName: String?) : GlassesState()
        data class Error(val message: String) : GlassesState()
    }

    private val _state = MutableStateFlow<GlassesState>(GlassesState.Disconnected)
    val state: StateFlow<GlassesState> = _state.asStateFlow()

    private val _incomingMessages = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val incomingMessages: SharedFlow<String> = _incomingMessages.asSharedFlow()

    val isConnected: Boolean get() = RokidSdkManager.isConnected

    fun start() {
        if (!RokidSdkManager.initialize(context)) {
            _state.value = GlassesState.Error("Rokid SDK init failed — check local.properties credentials")
            return
        }

        RokidSdkManager.onGlassesConnected = {
            Log.i(TAG, "Glasses connected")
            _state.value = GlassesState.Connected(null)
        }
        RokidSdkManager.onGlassesDisconnected = {
            Log.i(TAG, "Glasses disconnected")
            _state.value = GlassesState.Disconnected
            // Auto-reconnect to saved device
            RokidSdkManager.reconnectSaved()
        }
        RokidSdkManager.onMessageFromGlasses = { json ->
            _incomingMessages.tryEmit(json)
        }
        RokidSdkManager.onBluetoothFailed = { error ->
            Log.e(TAG, "Bluetooth failed: $error")
            _state.value = GlassesState.Error(error)
        }

        // Try reconnecting to a previously paired device immediately
        if (RokidSdkManager.reconnectSaved()) {
            _state.value = GlassesState.Connecting
        }
    }

    /** Connect to a specific Bluetooth device (from the scan results in Settings). */
    fun connect(device: BluetoothDevice) {
        _state.value = GlassesState.Connecting
        RokidSdkManager.initBluetooth(device)
    }

    /** Returns paired Bluetooth devices for display in the Settings UI. */
    fun getPairedDevices(): List<BluetoothDevice> {
        return try {
            BluetoothAdapter.getDefaultAdapter()?.bondedDevices?.toList() ?: emptyList()
        } catch (e: SecurityException) {
            Log.w(TAG, "Bluetooth permission not granted")
            emptyList()
        }
    }

    /** Send a JSON message from phone to glasses. */
    fun send(json: String) {
        if (!isConnected) {
            Log.w(TAG, "send: glasses not connected")
            return
        }
        RokidSdkManager.send(json)
    }

    /** Wake glasses display from standby before delivering content. */
    fun wakeDisplay() {
        RokidSdkManager.wakeDisplay()
    }

    fun stop() {
        RokidSdkManager.release()
        _state.value = GlassesState.Disconnected
    }
}
