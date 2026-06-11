package com.tars.phone.glasses

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.util.Log
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

class GlassesConnectionManager private constructor(context: Context) {

    companion object {
        private const val TAG = "GlassesConnection"
        val ROKID_SERVICE_UUID: UUID = UUID.fromString("00009100-0000-1000-8000-00805f9b34fb")
        private const val RECONNECT_BASE_DELAY_MS = 1000L
        private const val RECONNECT_MAX_DELAY_MS = 60000L
        private const val RECONNECT_TIMEOUT_MS = 10000L
        private const val CONNECT_TIMEOUT_MS = 20000L

        @Volatile private var instance: GlassesConnectionManager? = null

        fun getInstance(context: Context): GlassesConnectionManager =
            instance ?: synchronized(this) {
                instance ?: GlassesConnectionManager(context.applicationContext).also { instance = it }
            }
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

    private val appContext = context.applicationContext

    private val _connectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val connectionState: StateFlow<ConnectionState> = _connectionState.asStateFlow()

    private val _discoveredDevices = MutableStateFlow<List<DiscoveredDevice>>(emptyList())
    val discoveredDevices: StateFlow<List<DiscoveredDevice>> = _discoveredDevices.asStateFlow()

    private val _wifiP2PConnected = MutableStateFlow(false)
    val wifiP2PConnected: StateFlow<Boolean> = _wifiP2PConnected.asStateFlow()

    private val _incomingMessages = MutableSharedFlow<String>(extraBufferCapacity = 64)
    val incomingMessages: SharedFlow<String> = _incomingMessages.asSharedFlow()

    private val bluetoothManager = appContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    private val bluetoothAdapter: BluetoothAdapter? = bluetoothManager?.adapter
    private var bleScanner: BluetoothLeScanner? = null

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var reconnectJob: Job? = null
    private var connectTimeoutJob: Job? = null
    private var userInitiatedDisconnect = false
    private var isActivelyConnecting = false   // true only during user-initiated connect
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
            connectTimeoutJob?.cancel()
            isActivelyConnecting = false
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
            connectTimeoutJob?.cancel()
            if (isActivelyConnecting) {
                // User-initiated connect failed — show error, don't auto-reconnect
                isActivelyConnecting = false
                _connectionState.value = ConnectionState.Error("Connection failed: $error\nMake sure glasses are in pairing mode.")
            } else if (!userInitiatedDisconnect && RokidSdkManager.hasSavedConnectionInfo()) {
                scheduleReconnect()
            } else {
                _connectionState.value = ConnectionState.Error("Bluetooth failed: $error")
            }
        }
        RokidSdkManager.onMessageFromGlasses = { json ->
            onMessageFromGlasses?.invoke(json)
            scope.launch { _incomingMessages.emit(json) }
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.device
            val name = try { device.name } catch (_: SecurityException) { null } ?: return
            if (!name.contains("Rokid", ignoreCase = true) &&
                !name.contains("AR", ignoreCase = true) &&
                !name.startsWith("G")
            ) return
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
            if (!RokidSdkManager.initialize(appContext)) {
                _connectionState.value = ConnectionState.Error("Failed to initialize Rokid SDK")
                return
            }
        }
        _discoveredDevices.value = emptyList()
        _connectionState.value = ConnectionState.Scanning
        bleScanner = bluetoothAdapter.bluetoothLeScanner
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try {
            bleScanner?.startScan(null, settings, scanCallback)
            Log.i(TAG, "BLE scan started")
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
        isActivelyConnecting = true
        _connectionState.value = ConnectionState.Connecting
        Log.i(TAG, "Connecting to ${device.name} (${device.address})")
        RokidSdkManager.initBluetooth(device.device)

        // Safety timeout — if SDK never calls back, unblock the UI
        connectTimeoutJob?.cancel()
        connectTimeoutJob = scope.launch {
            delay(CONNECT_TIMEOUT_MS)
            if (_connectionState.value is ConnectionState.Connecting) {
                Log.e(TAG, "Connection timed out")
                isActivelyConnecting = false
                _connectionState.value = ConnectionState.Error(
                    "Connection timed out.\nFold right leg and triple-click camera to enter pairing mode, then try again."
                )
            }
        }
    }

    /**
     * Re-establish the glasses link from saved connection info if we're not already
     * connected. Used by TarsBridgeService on startup — after an app reinstall the
     * in-process SDK state is fresh (disconnected) even though the glasses are paired.
     */
    fun tryAutoReconnect() {
        if (RokidSdkManager.isConnected) {
            _connectionState.value = ConnectionState.Connected("Rokid Glasses")
            return
        }
        if (!RokidSdkManager.isReady && !RokidSdkManager.initialize(appContext)) {
            Log.w(TAG, "tryAutoReconnect: SDK init failed")
            return
        }
        if (!RokidSdkManager.hasSavedConnectionInfo()) {
            Log.i(TAG, "tryAutoReconnect: no saved glasses — connect once via Settings")
            return
        }
        userInitiatedDisconnect = false
        _connectionState.value = ConnectionState.Connecting
        Log.i(TAG, "tryAutoReconnect: reconnecting to saved glasses")
        RokidSdkManager.reconnectSaved()
    }

    fun disconnect() {
        userInitiatedDisconnect = true
        connectTimeoutJob?.cancel()
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
        scope.launch {
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
        reconnectJob = scope.launch {
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
    fun stop() { stopScanning() }   // singleton — don't cancel scope
}
