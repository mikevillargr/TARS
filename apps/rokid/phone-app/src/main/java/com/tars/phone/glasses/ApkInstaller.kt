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
                withTimeout(OPERATION_TIMEOUT_MS * 2) { doSdkInstall() }
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
            // LTE/5G coexistence on Samsung phones can transiently block 2.4GHz P2P channels.
            // The SDK has its own ~30s connect timeout, so each attempt waits 35s to let that
            // process complete fully before we give up and retry once more.
            val maxAttempts = 2
            var p2pReady = false
            for (attempt in 1..maxAttempts) {
                _installState.value = InstallState.InitializingWifiP2P(
                    if (maxAttempts > 1 && attempt > 1) "Connecting WiFi P2P… (retry $attempt/$maxAttempts)"
                    else "Connecting WiFi P2P…"
                )
                if (attempt > 1) { RokidSdkManager.deinitWifiP2P(); delay(1000) }
                if (!RokidSdkManager.initWifiP2P()) {
                    Log.w(TAG, "initWifiP2P returned false on attempt $attempt")
                    continue
                }
                var waited = 0
                while (!RokidSdkManager.isWifiP2PConnected && waited < 35_000) {
                    delay(500); waited += 500
                }
                if (RokidSdkManager.isWifiP2PConnected) { p2pReady = true; break }
                Log.w(TAG, "WiFi P2P attempt $attempt/$maxAttempts timed out")
            }
            if (!p2pReady) throw Exception(
                "Couldn't establish the WiFi Direct link to the glasses.\n" +
                "Make sure WiFi is on, the glasses are awake, then tap Install again."
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

        // Installed APKs don't auto-start. Launch the HUD on the glasses.
        _installState.value = InstallState.Launching()
        var openComplete = false
        var openFailed = false
        RokidSdkManager.onApkOpenSucceed = { openComplete = true }
        RokidSdkManager.onApkOpenFailed = { openFailed = true }
        delay(1500) // let the package manager on glasses settle after install
        RokidSdkManager.openApp(GLASSES_PACKAGE, GLASSES_ACTIVITY)

        var openWaited = 0
        while (!openComplete && !openFailed && openWaited < 15000) {
            delay(500); openWaited += 500
        }

        _installState.value = if (openComplete) {
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
