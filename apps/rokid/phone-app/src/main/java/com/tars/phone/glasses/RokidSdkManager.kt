package com.tars.phone.glasses

import android.bluetooth.BluetoothDevice
import android.content.Context
import android.util.Base64
import android.util.Log
import com.rokid.cxr.Caps
import com.rokid.cxr.client.extend.CxrApi
import com.rokid.cxr.client.extend.callbacks.ApkStatusCallback
import com.rokid.cxr.client.extend.callbacks.BluetoothStatusCallback
import com.rokid.cxr.client.extend.callbacks.WifiP2PStatusCallback
import com.rokid.cxr.client.extend.listeners.AiEventListener
import com.rokid.cxr.client.extend.listeners.BrightnessUpdateListener
import com.rokid.cxr.client.extend.listeners.CustomCmdListener
import com.rokid.cxr.client.utils.ValueUtil
import com.tars.phone.BuildConfig
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Manages the Rokid CXR-M SDK (phone side).
 *
 * Connection flow:
 * 1. initialize(context)
 * 2. Scan for Bluetooth device → initBluetooth(device)
 *    → onConnectionInfo callback fires with socketUuid + macAddress
 * 3. connectBluetooth(socketUuid, macAddress) is called automatically
 *    → onConnected fires — glasses are live
 *
 * SN quirk: The first connection always gets SN_CHECK_FAILED. The SDK reads the
 * glasses serial number, we AES-encrypt it with the clientSecret, then reconnect.
 * Subsequent connections use the cached encrypted value and connect first time.
 */
object RokidSdkManager {

    private const val TAG = "RokidSdkManager"
    private const val SN_PREFS = "tars_glasses_sn"
    private const val SN_KEY = "sn_encrypt_content"
    private const val SN_PLAIN_KEY = "sn_plain"
    private const val DEVICE_NAME_KEY = "device_name"
    private const val SOCKET_UUID_KEY = "socket_uuid"
    private const val MAC_ADDRESS_KEY = "mac_address"

    private var isInitialized = false
    private var cxrApi: CxrApi? = null
    private var appContext: Context? = null

    private var isBluetoothConnectedState = false
    private var pendingConnect = false
    private var snAutoRetryInProgress = false
    private var generatedSnEncryptContent: ByteArray? = null
    private var lastKnownBrightness: Int = 15

    private var savedSocketUuid: String? = null
    private var savedMacAddress: String? = null
    private var savedRokidAccount: String? = null
    private var savedDeviceName: String? = null
    private var cachedSnPlain: String? = null
    private var cachedDeviceName: String? = null

    // Callbacks wired in by GlassesConnectionManager
    var onGlassesConnected: (() -> Unit)? = null
    var onGlassesDisconnected: (() -> Unit)? = null
    var onMessageFromGlasses: ((String) -> Unit)? = null
    var onBluetoothFailed: ((String) -> Unit)? = null
    var onAiKeyDown: (() -> Unit)? = null   // glasses long-press → voice input
    var onAiKeyUp: (() -> Unit)? = null
    var onPhotoResult: ((ByteArray?) -> Unit)? = null

    val isConnected: Boolean get() = isBluetoothConnectedState
    val isReady: Boolean get() = isInitialized
    fun hasSavedConnectionInfo(): Boolean = !savedSocketUuid.isNullOrEmpty() && !savedMacAddress.isNullOrEmpty()

    private var isWifiP2PConnectedState = false
    val isWifiP2PConnected: Boolean get() = isWifiP2PConnectedState

    // APK install callbacks (set by ApkInstaller)
    var onApkUploadSucceed: (() -> Unit)? = null
    var onApkUploadFailed: (() -> Unit)? = null
    var onApkInstallSucceed: (() -> Unit)? = null
    var onApkInstallFailed: (() -> Unit)? = null

    private val wifiP2PCallback = object : WifiP2PStatusCallback {
        override fun onConnected() {
            Log.i(TAG, "WiFi P2P connected")
            isWifiP2PConnectedState = true
        }
        override fun onDisconnected() {
            Log.i(TAG, "WiFi P2P disconnected")
            isWifiP2PConnectedState = false
        }
        override fun onFailed(code: ValueUtil.CxrWifiErrorCode?) {
            Log.e(TAG, "WiFi P2P failed: $code")
            isWifiP2PConnectedState = false
        }
        override fun onP2pDeviceAvailable(p0: String?, p1: String?, p2: String?) {
            Log.d(TAG, "WiFi P2P device available: $p0")
        }
    }

    private val apkStatusCallback = object : ApkStatusCallback {
        override fun onUploadApkSucceed() {
            Log.i(TAG, "APK upload succeeded")
            onApkUploadSucceed?.invoke()
        }
        override fun onUploadApkFailed() {
            Log.e(TAG, "APK upload failed")
            onApkUploadFailed?.invoke()
        }
        override fun onInstallApkSucceed() {
            Log.i(TAG, "APK install succeeded")
            onApkInstallSucceed?.invoke()
        }
        override fun onInstallApkFailed() {
            Log.e(TAG, "APK install failed")
            onApkInstallFailed?.invoke()
        }
        override fun onUninstallApkSucceed() {
            Log.d(TAG, "APK uninstall succeeded")
        }
        override fun onUninstallApkFailed() {
            Log.d(TAG, "APK uninstall failed")
        }
        override fun onOpenAppSucceed() {
            Log.d(TAG, "APK open app succeeded")
        }
        override fun onOpenAppFailed() {
            Log.d(TAG, "APK open app failed")
        }
    }

    // ── Bluetooth lifecycle callback ──────────────────────────────────────────

    private val bluetoothCallback = object : BluetoothStatusCallback {
        override fun onConnectionInfo(
            socketUuid: String?, macAddress: String?, rokidAccount: String?, deviceType: Int
        ) {
            Log.i(TAG, "onConnectionInfo: uuid=$socketUuid mac=$macAddress account=$rokidAccount type=$deviceType")
            savedSocketUuid = socketUuid
            savedMacAddress = macAddress
            savedRokidAccount = rokidAccount

            if (!socketUuid.isNullOrEmpty() && !macAddress.isNullOrEmpty()) {
                saveConnectionInfo(socketUuid, macAddress)
                // Try to read device name from SDK via reflection
                try {
                    val api = cxrApi ?: return
                    val f = api.javaClass.getDeclaredField("I")
                    f.isAccessible = true
                    val glassInfo = f.get(api)
                    val name = glassInfo?.javaClass?.getMethod("getDeviceName")?.invoke(glassInfo) as? String
                    if (!name.isNullOrEmpty()) {
                        savedDeviceName = name
                        cachedDeviceName = name
                    }
                } catch (_: Exception) {}
            }

            if (pendingConnect && !socketUuid.isNullOrEmpty() && !macAddress.isNullOrEmpty()) {
                pendingConnect = false
                connectBluetoothInternal(socketUuid, macAddress, rokidAccount ?: "")
            }
        }

        override fun onConnected() {
            Log.i(TAG, "Bluetooth connected to glasses")
            isBluetoothConnectedState = true
            pendingConnect = false
            snAutoRetryInProgress = false
            onGlassesConnected?.invoke()
        }

        override fun onDisconnected() {
            Log.i(TAG, "Bluetooth disconnected from glasses")
            isBluetoothConnectedState = false
            onGlassesDisconnected?.invoke()
        }

        override fun onFailed(errorCode: ValueUtil.CxrBluetoothErrorCode?) {
            Log.e(TAG, "Bluetooth connection failed: $errorCode")
            isBluetoothConnectedState = false
            pendingConnect = false

            // SN_CHECK_FAILED is expected on first ever connection.
            // Read the SN, encrypt it, retry once.
            if (errorCode == ValueUtil.CxrBluetoothErrorCode.SN_CHECK_FAILED && !snAutoRetryInProgress) {
                val sn = readGlassesSnFromSdk()
                if (sn != null) {
                    val secret = BuildConfig.ROKID_CLIENT_SECRET.replace("-", "")
                    val encrypted = encryptSn(sn, secret)
                    if (encrypted != null) {
                        generatedSnEncryptContent = encrypted
                        saveCachedSnEncryptContent(encrypted, sn)
                        snAutoRetryInProgress = true
                        val uuid = savedSocketUuid ?: return
                        val mac = savedMacAddress ?: return
                        Log.i(TAG, "SN_CHECK_FAILED: retrying with generated snEncryptContent")
                        connectBluetoothInternal(uuid, mac, savedRokidAccount ?: "")
                        return
                    }
                }
                Log.e(TAG, "SN auto-recovery failed")
            }

            snAutoRetryInProgress = false
            onBluetoothFailed?.invoke(errorCode?.name ?: "Unknown")
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    fun initialize(context: Context): Boolean {
        if (isInitialized) return true
        appContext = context.applicationContext
        loadCachedSnEncryptContent()
        loadSavedConnectionInfo()

        return try {
            cxrApi = CxrApi.getInstance()

            val accessKey = BuildConfig.ROKID_ACCESS_KEY
            if (accessKey.isNotEmpty()) cxrApi?.updateRokidAccount(accessKey)

            // Receive JSON messages sent from the glasses app
            cxrApi?.setCustomCmdListener(object : CustomCmdListener {
                override fun onCustomCmd(cmd: String?, caps: Caps?) {
                    val message = if (caps != null && caps.size() > 0) {
                        try { caps.at(0).getString() } catch (_: Exception) { cmd ?: return }
                    } else cmd ?: return
                    if (message.isNotEmpty()) onMessageFromGlasses?.invoke(message)
                }
            })

            // Glasses long-press → phone triggers voice recognition
            cxrApi?.setAiEventListener(object : AiEventListener {
                override fun onAiKeyDown() { onAiKeyDown?.invoke() }
                override fun onAiKeyUp() { onAiKeyUp?.invoke() }
                override fun onAiExit() {}
            })

            cxrApi?.setBrightnessUpdateListener(object : BrightnessUpdateListener {
                override fun onBrightnessUpdated(brightness: Int) {
                    lastKnownBrightness = brightness
                }
            })

            isInitialized = true
            Log.i(TAG, "Rokid SDK initialized")
            true
        } catch (e: Exception) {
            Log.e(TAG, "SDK init failed", e)
            false
        }
    }

    /** Start Bluetooth init with a scanned device. onConnected fires when done. */
    fun initBluetooth(device: BluetoothDevice) {
        val ctx = appContext ?: return
        pendingConnect = true
        cxrApi?.initBluetooth(ctx, device, bluetoothCallback)
    }

    fun connectBluetooth(socketUuid: String, macAddress: String) {
        connectBluetoothInternal(socketUuid, macAddress)
    }

    /** Send a JSON message to the glasses. */
    fun send(json: String) {
        try {
            val caps = Caps()
            caps.write(json)
            cxrApi?.sendCustomCmd("command", caps)
        } catch (e: Exception) {
            Log.e(TAG, "send failed: ${e.message}")
        }
    }

    fun initWifiP2P(): Boolean = try {
        cxrApi?.initWifiP2P2(true, wifiP2PCallback)
        true
    } catch (e: Exception) {
        Log.e(TAG, "initWifiP2P failed: ${e.message}")
        false
    }

    fun deinitWifiP2P() {
        try {
            cxrApi?.deinitWifiP2P()
            isWifiP2PConnectedState = false
        } catch (e: Exception) {
            Log.e(TAG, "deinitWifiP2P failed: ${e.message}")
        }
    }

    fun startUploadApk(apkPath: String): Boolean = try {
        cxrApi?.startUploadApk(apkPath, apkStatusCallback)
        true
    } catch (e: Exception) {
        Log.e(TAG, "startUploadApk failed: ${e.message}")
        false
    }

    /** Wake glasses display from standby.
     *  The glasses app handles waking its own screen on receiving a wake_signal JSON message.
     *  No CXR-M SDK call is needed from the phone side. */
    fun wakeDisplay() {
        Log.d(TAG, "wakeDisplay: wake handled by glasses-side wake_signal handler")
    }

    /** Restore previous connection from saved socketUuid + macAddress. */
    fun reconnectSaved(): Boolean {
        val uuid = savedSocketUuid ?: return false
        val mac = savedMacAddress ?: return false
        Log.i(TAG, "Reconnecting to saved glasses: $mac")
        connectBluetoothInternal(uuid, mac, savedRokidAccount ?: "")
        return true
    }

    fun release() {
        isInitialized = false
        isBluetoothConnectedState = false
        cxrApi = null
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun connectBluetoothInternal(socketUuid: String, macAddress: String, account: String = "") {
        val ctx = appContext ?: return
        val secret = BuildConfig.ROKID_CLIENT_SECRET
        val encryptContent = generatedSnEncryptContent ?: ByteArray(16)
        Log.i(TAG, "connectBluetooth: uuid=$socketUuid mac=$macAddress cached=${generatedSnEncryptContent != null}")
        cxrApi?.connectBluetooth(ctx, socketUuid, macAddress, bluetoothCallback, encryptContent, secret)
    }

    private fun readGlassesSnFromSdk(): String? = try {
        val api = cxrApi ?: return null
        val f = api.javaClass.getDeclaredField("I")
        f.isAccessible = true
        val glassInfo = f.get(api)
        glassInfo?.javaClass?.getMethod("getDeviceId")?.invoke(glassInfo) as? String
    } catch (e: Exception) {
        Log.e(TAG, "readGlassesSn failed: ${e.message}")
        null
    }

    private fun encryptSn(sn: String, secret: String): ByteArray? = try {
        val keyBytes = secret.toByteArray(Charsets.UTF_8)
        val key = SecretKeySpec(keyBytes, "AES")
        val iv = IvParameterSpec(keyBytes, 0, 16)
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        cipher.init(Cipher.ENCRYPT_MODE, key, iv)
        cipher.doFinal(sn.toByteArray(Charsets.UTF_8))
    } catch (e: Exception) {
        Log.e(TAG, "encryptSn failed: ${e.message}")
        null
    }

    private fun saveCachedSnEncryptContent(encrypted: ByteArray, plainSn: String?) {
        val ctx = appContext ?: return
        ctx.getSharedPreferences(SN_PREFS, Context.MODE_PRIVATE).edit()
            .putString(SN_KEY, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .apply { if (plainSn != null) putString(SN_PLAIN_KEY, plainSn) }
            .apply()
    }

    private fun loadCachedSnEncryptContent() {
        val ctx = appContext ?: return
        val prefs = ctx.getSharedPreferences(SN_PREFS, Context.MODE_PRIVATE)
        val b64 = prefs.getString(SN_KEY, null) ?: return
        generatedSnEncryptContent = Base64.decode(b64, Base64.NO_WRAP)
        cachedSnPlain = prefs.getString(SN_PLAIN_KEY, null)
        cachedDeviceName = prefs.getString(DEVICE_NAME_KEY, null)
    }

    private fun saveConnectionInfo(socketUuid: String, macAddress: String) {
        val ctx = appContext ?: return
        ctx.getSharedPreferences(SN_PREFS, Context.MODE_PRIVATE).edit()
            .putString(SOCKET_UUID_KEY, socketUuid)
            .putString(MAC_ADDRESS_KEY, macAddress)
            .apply()
    }

    private fun loadSavedConnectionInfo() {
        val ctx = appContext ?: return
        val prefs = ctx.getSharedPreferences(SN_PREFS, Context.MODE_PRIVATE)
        savedSocketUuid = prefs.getString(SOCKET_UUID_KEY, null)
        savedMacAddress = prefs.getString(MAC_ADDRESS_KEY, null)
    }
}
