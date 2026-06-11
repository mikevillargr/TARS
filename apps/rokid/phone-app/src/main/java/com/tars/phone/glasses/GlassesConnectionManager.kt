package com.tars.phone.glasses

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.ParcelUuid
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

class GlassesConnectionManager(private val context: Context) {

    companion object {
        private const val TAG = "GlassesConnection"
        val ROKID_SERVICE_UUID: UUID = UUID.fromString("00009100-0000-1000-8000-00805f9b34fb")
        private const val RECONNECT_BASE_DELAY_MS = 1000L
        private const val RECONNECT_MAX_DELAY_MS = 60000L
        private const val RECONNECT_TIMEOUT_MS = 10000L
    }

    data class DiscoveredDevice(
        val name: String,
        val address: String,
        val rssi: Int,
        val device: BluetoothDevice,
    )

    sealed class ConnectionState {
        object Disconnected : ConnectionState()
        object Scanning : ConnectionState()
        object Connecting : ConnectionState()
        data class Connected(val deviceName: String) : ConnectionState()
        data class Reconnecting(val attempt: Int, val nextRetryMs: Long) : ConnectionState()
        data class Error(val message: String) : ConnectionState()
    }

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _discoveredDevices = MutableStateFlow<List<DiscoveredDevice>>(emptyList())
    val discoveredDevices: StateFlow<List<DiscoveredDevice>> = _discoveredDevices.asStateFlow()

    private val _wifiP2PConnected = MutableStateFlow(false)
    val wifiP2PConnected: StateFlow<Boolean> = _wifiP2PConnected.asStateFlow()

    private val _incomingMessages = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val incomingMessages: SharedFlow<String> = _incomingMessages.asSharedFlow()

    private val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private var bleScanner: BluetoothLeScanner? = null

    private val reconnectScope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var reconnectJob: Job? = null
    private var userInitiatedDisconnect = false
    private var reconnectAttempts = 0
    private var currentReconnectDelayMs = RECONNECT_BASE_DELAY_MS

    val isConnected: Boolean get() = RokidSdkManager.isConnected

    var onMessageFromGlasses: ((String) -> Unit)? = null

    init {
        setupSdkCallbacks()
        if (RokidSdkManager.isReady && RokidSdkManager.isConnected) {
            _connectionState.value = ConnectionState.Connected("Rokid Glasses")
        }
    }

    private fun setupSdkCallbacks() {
        RokidSdkManager.onGlassesConnected = {
            _connectionState.value = ConnectionState.Connected("Rokid Glasses")
            reconnectAttempts = 0
            currentReconnectDelayMs = RECONNECT_BASE_DELAY_MS
            reconnectJob?.cancel()
            Log.i(TAG, "Glasses connected")
        }
        RokidSdkManager.onGlassesDisconnected = {
            _connectionState.value = ConnectionState.Disconnected
            _wifiP2PConnected.value = false
            Log.i(TAG, "Glasses disconnected")
            if (!userInitiatedDisconnect) scheduleReconnect()
        }
        RokidSdkManager.onBluetoothFailed = { error ->
            Log.e(TAG, "Bluetooth failed: $error")
            if (!userInitiatedDisconnect && RokidSdkManager.hasSavedConnectionInfo()) {
                scheduleReconnect()
            } else {
                _connectionState.value = ConnectionState.Error("Bluetooth failed: $error")
            }
        }
        RokidSdkManager.onMessageFromGlasses = { json ->
            onMessageFromGlasses?.invoke(json)
            reconnectScope.launch { _incomingMessages.emit(json) }
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val name = try { device.name ?: "Rokid Device" } catch (_: SecurityException) { "Rokid Device" }
            val discovered = DiscoveredDevice(name, device.address, result.rssi, device)
            val current = _discoveredDevices.value.toMutableList()
            val idx = current.indexOfFirst { it.address == device.address }
            if (idx >= 0) current[idx] = discovered else current.add(discovered)
            _discoveredDevices.value = current
            Log.d(TAG, "Discovered: $name (${device.address}) RSSI=${result.rssi}")
        }
        override fun onScanFailed(errorCode: Int) {
            Log.e(TAG, "BLE scan failed: $errorCode")
            _connectionState.value = ConnectionState.Error("Scan failed (code $errorCode). Check Bluetooth permissions.")
        }
    }

    fun startScanning() {
        if (bluetoothAdapter?.isEnabled != true) {
            _connectionState.value = ConnectionState.Error("Bluetooth is not enabled")
            return
        }
        if (!RokidSdkManager.isReady) {
            if (!RokidSdkManager.initialize(context)) {
                _connectionState.value = ConnectionState.Error("Failed to initialize Rokid SDK")
                return
            }
        }
        _discoveredDevices.value = emptyList()
        _connectionState.value = ConnectionState.Scanning
        bleScanner = bluetoothAdapter.bluetoothLeScanner
        val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(ROKID_SERVICE_UUID)).build()
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try {
            bleScanner?.startScan(listOf(filter), settings, scanCallback)
            Log.i(TAG, "BLE scan started for Rokid UUID")
        } catch (e: SecurityException) {
            _connectionState.value = ConnectionState.Error("Missing Bluetooth permissions")
        }
    }

    fun stopScanning() {
        try {
            bleScanner?.stopScan(scanCallback)
            if (_connectionState.value is ConnectionState.Scanning) {
                _connectionState.value = ConnectionState.Disconnected
            }
        } catch (_: SecurityException) {}
    }

    fun connectToDevice(device: DiscoveredDevice) {
        stopScanning()
        userInitiatedDisconnect = false
        _connectionState.value = ConnectionState.Connecting
        Log.i(TAG, "Connecting to ${device.name} (${device.address})")
        RokidSdkManager.initBluetooth(device.device)
    }

    fun disconnect() {
        userInitiatedDisconnect = true
        resetReconnect()
        RokidSdkManager.release()
        _connectionState.value = ConnectionState.Disconnected
        _wifiP2PConnected.value = false
    }

    fun retryReconnectNow() {
        reconnectJob?.cancel()
        reconnectAttempts = 0
        currentReconnectDelayMs = RECONNECT_BASE_DELAY_MS
        _connectionState.value = ConnectionState.Connecting
        reconnectScope.launch {
            if (RokidSdkManager.reconnectSaved()) {
                delay(RECONNECT_TIMEOUT_MS)
                val s = _connectionState.value
                if (s is ConnectionState.Connecting || s is ConnectionState.Reconnecting) scheduleReconnect()
            } else {
                _connectionState.value = ConnectionState.Disconnected
            }
        }
    }

    fun cancelReconnect() {
        resetReconnect()
        userInitiatedDisconnect = true
        _connectionState.value = ConnectionState.Disconnected
    }

    private fun scheduleReconnect() {
        reconnectJob?.cancel()
        if (!RokidSdkManager.hasSavedConnectionInfo()) {
            _connectionState.value = ConnectionState.Disconnected
            return
        }
        val attempt = reconnectAttempts + 1
        val delay = currentReconnectDelayMs
        _connectionState.value = ConnectionState.Reconnecting(attempt, delay)
        reconnectJob = reconnectScope.launch {
            delay(delay)
            reconnectAttempts = attempt
            currentReconnectDelayMs = (currentReconnectDelayMs * 1.5).toLong().coerceAtMost(RECONNECT_MAX_DELAY_MS)
            if (RokidSdkManager.reconnectSaved()) {
                delay(RECONNECT_TIMEOUT_MS)
                val s = _connectionState.value
                if (s is ConnectionState.Reconnecting || s is ConnectionState.Connecting) scheduleReconnect()
            } else {
                _connectionState.value = ConnectionState.Disconnected
            }
        }
    }

    private fun resetReconnect() {
        reconnectJob?.cancel()
        reconnectJob = null
        reconnectAttempts = 0
        currentReconnectDelayMs = RECONNECT_BASE_DELAY_MS
    }

    fun send(json: String) = RokidSdkManager.send(json)
    fun wakeDisplay() = RokidSdkManager.wakeDisplay()
    fun stop() { stopScanning(); reconnectScope.cancel() }
}
