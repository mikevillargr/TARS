package com.tars.phone.glasses

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import dadb.Dadb
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.io.FileOutputStream

class ApkInstaller(private val context: Context) {

    companion object {
        private const val TAG = "ApkInstaller"
        private const val GLASSES_APP_ASSET = "glasses-app-release.apk"
        private const val DEFAULT_ADB_PORT = 5555
        private const val OPERATION_TIMEOUT_MS = 60_000L
        private const val GLASSES_PACKAGE = "com.tars.glasses"
        private const val GLASSES_ACTIVITY = "com.tars.glasses.HudActivity"
    }

    sealed class InstallState {
        object Idle : InstallState()
        object CheckingConnection : InstallState()
        data class InitializingWifiP2P(val message: String = "Connecting WiFi P2P…") : InstallState()
        object PreparingApk : InstallState()
        data class Uploading(val message: String = "Uploading APK...") : InstallState()
        data class Installing(val message: String = "Installing...") : InstallState()
        data class Launching(val message: String = "Launching HUD on glasses…") : InstallState()
        data class Success(val message: String = "Installation complete!") : InstallState()
        data class Error(val message: String, val canRetry: Boolean = true) : InstallState()
    }

    private val _installState = MutableStateFlow<InstallState>(InstallState.Idle)
    val installState: StateFlow<InstallState> = _installState.asStateFlow()

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var installJob: Job? = null

    fun installGlassesApp(adbHost: String = "") {
        if (!canStartInstall()) return
        if (adbHost.isNotEmpty()) {
            installViaAdb(adbHost)
        } else if (RokidSdkManager.isReady && RokidSdkManager.isConnected) {
            installViaSdk()
        } else {
            _installState.value = InstallState.Error(
                "Not connected to glasses via Bluetooth.\nConnect first, then tap Install again.",
                canRetry = true
            )
        }
    }

    /**
     * Launch the HUD on the glasses over Bluetooth (no WiFi P2P).
     * Returns true if the glasses confirmed the app opened.
     * Used both as a standalone "Launch" action and as a fast-path:
     * if the app is already installed, we skip the flaky P2P upload entirely.
     */
    private suspend fun tryLaunchOverBluetooth(timeoutMs: Long = 8000L): Boolean {
        var opened = false
        var failed = false
        RokidSdkManager.onApkOpenSucceed = { opened = true }
        RokidSdkManager.onApkOpenFailed = { failed = true }
        if (!RokidSdkManager.openApp(GLASSES_PACKAGE, GLASSES_ACTIVITY)) return false
        var waited = 0
        while (!opened && !failed && waited < timeoutMs) { delay(250); waited += 250 }
        return opened
    }

    /** Standalone: just launch the already-installed HUD over Bluetooth. */
    fun launchGlassesApp() {
        if (!canStartInstall()) return
        if (!RokidSdkManager.isReady || !RokidSdkManager.isConnected) {
            _installState.value = InstallState.Error("Connect to glasses via Bluetooth first.")
            return
        }
        installJob = scope.launch {
            _installState.value = InstallState.Launching("Launching HUD on glasses…")
            val ok = tryLaunchOverBluetooth()
            _installState.value = if (ok) {
                InstallState.Success("HUD launched on glasses!")
            } else {
                InstallState.Error(
                    "Couldn't launch the HUD. It may not be installed yet — tap Install to Glasses.",
                    canRetry = true
                )
            }
        }
    }

    fun installViaAdb(host: String, port: Int = DEFAULT_ADB_PORT) {
        if (!canStartInstall()) return
        _installState.value = InstallState.CheckingConnection
        installJob = scope.launch {
            try {
                withTimeout(OPERATION_TIMEOUT_MS) { doAdbInstall(host, port) }
            } catch (e: TimeoutCancellationException) {
                _installState.value = InstallState.Error("Timed out. Check glasses connection.")
            } catch (e: CancellationException) {
                _installState.value = InstallState.Idle
            } catch (e: Exception) {
                _installState.value = InstallState.Error(formatError(e))
            }
        }
    }

    private suspend fun doAdbInstall(host: String, port: Int) = withContext(Dispatchers.IO) {
        val dadb = try {
            Dadb.create(host, port)
        } catch (e: Exception) {
            throw Exception("Cannot connect to glasses at $host:$port. Ensure ADB debugging is enabled.")
        }
        dadb.use { adb ->
            val test = adb.shell("echo ok")
            if (test.exitCode != 0) throw Exception("ADB connection test failed.")
            _installState.value = InstallState.PreparingApk
            val apkFile = extractApkFromAssets() ?: throw Exception("APK not bundled in app assets.")
            _installState.value = InstallState.Uploading("Uploading ${apkFile.length() / 1024} KB...")
            _installState.value = InstallState.Installing("Installing on glasses...")
            try {
                adb.install(apkFile, "-r")
                _installState.value = InstallState.Success("Glasses app installed via ADB!")
            } catch (e: Exception) {
                throw Exception("Install failed: ${e.message}")
            } finally {
                cleanupTempApk()
            }
        }
    }

    fun installViaSdk() {
        if (!canStartInstall()) return
        if (!RokidSdkManager.isReady) {
            _installState.value = InstallState.Error("Rokid SDK not initialized.", canRetry = false)
            return
        }
        if (!RokidSdkManager.isConnected) {
            _installState.value = InstallState.Error("Not connected to glasses. Connect via Bluetooth first.")
            return
        }
        _installState.value = InstallState.PreparingApk
        installJob = scope.launch {
            try {
                // "Install" always transfers the bundled APK via P2P so code changes actually
                // reach the glasses. (Use the separate "Launch" button for the BT-only fast path.)
                withTimeout(OPERATION_TIMEOUT_MS * 3) { doSdkInstall() }
            } catch (e: TimeoutCancellationException) {
                _installState.value = InstallState.Error("Installation timed out.")
            } catch (e: CancellationException) {
                _installState.value = InstallState.Idle
            } catch (e: Exception) {
                _installState.value = InstallState.Error(formatError(e))
            }
        }
    }

    private suspend fun doSdkInstall() = withContext(Dispatchers.IO) {
        val apkFile = extractApkFromAssets() ?: throw Exception("APK not bundled in app assets.")

        var installComplete = false
        var installError: String? = null

        RokidSdkManager.onApkUploadSucceed = {
            _installState.value = InstallState.Installing("Installing on glasses...")
        }
        RokidSdkManager.onApkUploadFailed = { installError = "APK upload failed." }
        RokidSdkManager.onApkInstallSucceed = { installComplete = true }
        RokidSdkManager.onApkInstallFailed = { installError = "APK installation failed on glasses." }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val ok = ContextCompat.checkSelfPermission(
                context, Manifest.permission.NEARBY_WIFI_DEVICES
            ) == PackageManager.PERMISSION_GRANTED
            if (!ok) throw Exception("Missing 'Nearby devices' permission. Enable it in Android Settings > Apps > TARS > Permissions.")
        }

        if (!RokidSdkManager.isWifiP2PConnected) {
            // The SDK internally retries the P2P connect up to 10× over ~30s (WIFI_MAX_RETRY_COUNT).
            // We init ONCE and let that internal retry run — calling deinit/reinit ourselves only
            // resets the SDK's retry counter and tears down its in-progress negotiation.
            // Samsung LTE/2.4GHz coexistence can still block it; the shifting AVOID-FREQ window
            // means a later retry often succeeds, so we wait out the full internal cycle (~45s).
            _installState.value = InstallState.InitializingWifiP2P("Connecting WiFi link to glasses…")
            if (!RokidSdkManager.initWifiP2P()) throw Exception("Failed to start WiFi P2P.")
            var waited = 0
            while (!RokidSdkManager.isWifiP2PConnected && waited < 50_000) {
                delay(500); waited += 500
            }
            if (!RokidSdkManager.isWifiP2PConnected) throw Exception(
                "The glasses' WiFi Direct link didn't come up (phone radio was busy on those channels).\n" +
                "Tap Install to Glasses to try again — it usually connects within a couple of tries."
            )
        }

        _installState.value = InstallState.Uploading("Uploading ${apkFile.length() / 1024} KB via WiFi P2P...")
        if (!RokidSdkManager.startUploadApk(apkFile.absolutePath)) throw Exception("Failed to start APK upload.")

        var waited = 0
        while (!installComplete && installError == null && waited < 120000) {
            delay(500); waited += 500
        }
        cleanupTempApk()

        if (installError != null) throw Exception(installError)
        if (!installComplete) throw Exception("Installation did not complete.")

        // Tear down WiFi P2P now that transfer is done — keeps Bluetooth control channel clean.
        withContext(Dispatchers.Main) {
            if (RokidSdkManager.isConnected) RokidSdkManager.deinitWifiP2P()
        }

        // Installed APKs don't auto-start. Launch the HUD over Bluetooth.
        _installState.value = InstallState.Launching()
        delay(1500) // let the package manager on glasses settle after install
        val launched = tryLaunchOverBluetooth(timeoutMs = 15000L)

        _installState.value = if (launched) {
            InstallState.Success("Installed and launched on glasses!")
        } else {
            // Install definitely worked; launch is best-effort.
            InstallState.Success("Installed! If the HUD didn't open, restart the glasses.")
        }
    }

    fun cancelInstallation() {
        installJob?.cancel()
        installJob = null
        cleanupTempApk()
        _installState.value = InstallState.Idle
    }

    fun resetState() { _installState.value = InstallState.Idle }

    private fun canStartInstall(): Boolean {
        val s = _installState.value
        return s is InstallState.Idle || s is InstallState.Error || s is InstallState.Success
    }

    private fun extractApkFromAssets(): File? = try {
        val apkFile = File(context.cacheDir, "glasses-app.apk")
        val assets = context.assets.list("") ?: emptyArray()
        if (GLASSES_APP_ASSET in assets) {
            context.assets.open(GLASSES_APP_ASSET).use { input ->
                FileOutputStream(apkFile).use { input.copyTo(it) }
            }
            apkFile
        } else null
    } catch (e: Exception) {
        Log.e(TAG, "extractApkFromAssets failed", e); null
    }

    private fun cleanupTempApk() {
        try { File(context.cacheDir, "glasses-app.apk").delete() } catch (_: Exception) {}
    }

    private fun formatError(e: Exception): String {
        val msg = e.message ?: "Unknown error"
        return when {
            msg.contains("Connection refused") -> "Connection refused. Check ADB debugging is enabled and IP is correct."
            msg.contains("timeout", ignoreCase = true) -> "Connection timed out. Check glasses WiFi."
            msg.contains("INSTALL_FAILED") -> "Install failed: $msg"
            else -> msg
        }
    }

    fun cleanup() { installJob?.cancel(); scope.cancel(); cleanupTempApk() }
}
