package com.clawsses.phone.glasses

import android.content.ContentValues
import android.content.Context
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Pulls photos/videos captured on the glasses into the phone's gallery.
 *
 * Flow: ensure WiFi P2P (the SDK's transfer transport, same as APK installs) →
 * SDK startSync pulls files into an app-private dir → each file is published to
 * MediaStore under Pictures/TARS or Movies/TARS → P2P torn down to save battery.
 */
object MediaSync {

    private const val TAG = "MediaSync"
    private const val P2P_WAIT_MS = 55_000
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    @Volatile var isSyncing = false
        private set

    /**
     * Start a sync. [onStatus] receives progress strings for the UI;
     * [onDone] receives (syncedCount, success).
     */
    fun sync(context: Context, onStatus: (String) -> Unit, onDone: (Int, Boolean) -> Unit) {
        if (isSyncing) return
        if (!RokidSdkManager.isConnected()) {
            onDone(0, false); onStatus("Glasses not connected"); return
        }
        isSyncing = true
        val appCtx = context.applicationContext

        scope.launch {
            try {
                // 1. WiFi P2P up (SDK retries internally ~10x over ~50s per cycle)
                if (!RokidSdkManager.isWifiP2PConnected()) {
                    onStatus("Connecting WiFi link…")
                    withContext(Dispatchers.Main) { RokidSdkManager.initWifiP2P() }
                    var waited = 0
                    while (!RokidSdkManager.isWifiP2PConnected() && waited < P2P_WAIT_MS) {
                        delay(500); waited += 500
                    }
                    if (!RokidSdkManager.isWifiP2PConnected()) {
                        onStatus("WiFi link failed — try again")
                        onDone(0, false); isSyncing = false; return@launch
                    }
                }

                // 2. Pull files into an app-private staging dir
                val staging = File(appCtx.getExternalFilesDir(null), "glasses_media").apply { mkdirs() }
                onStatus("Syncing media…")
                var count = 0
                var finished = false
                var failed = false

                val started = RokidSdkManager.startMediaSync(
                    savePath = staging.absolutePath,
                    onFile = { name ->
                        val f = File(staging, name)
                        if (publishToGallery(appCtx, f)) {
                            count++
                            onStatus("Synced $count file${if (count == 1) "" else "s"}…")
                        }
                    },
                    onFinished = { finished = true },
                    onFailed = { failed = true },
                )
                if (!started) {
                    onStatus("Sync didn't start")
                    onDone(0, false); isSyncing = false; return@launch
                }

                var waited = 0
                while (!finished && !failed && waited < 300_000) {
                    delay(500); waited += 500
                }

                // 3. Tear down P2P (Bluetooth control channel stays up)
                withContext(Dispatchers.Main) {
                    if (RokidSdkManager.isConnected()) RokidSdkManager.deinitWifiP2P()
                }

                onStatus(
                    when {
                        failed -> "Sync failed after $count file(s)"
                        count == 0 -> "Nothing new to sync"
                        else -> "Done — $count file(s) in your gallery"
                    }
                )
                onDone(count, !failed)
            } catch (e: Exception) {
                Log.e(TAG, "sync error", e)
                onStatus("Sync error: ${e.message}")
                onDone(0, false)
            } finally {
                isSyncing = false
            }
        }
    }

    /** Copy a synced file into MediaStore (Pictures/TARS or Movies/TARS). */
    private fun publishToGallery(context: Context, file: File): Boolean {
        if (!file.exists() || file.length() == 0L) {
            Log.w(TAG, "publishToGallery: missing/empty ${file.name}")
            return false
        }
        val name = file.name.lowercase()
        val isVideo = name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".3gp")
        val (collection, dir, mime) = if (isVideo) {
            Triple(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                Environment.DIRECTORY_MOVIES + "/TARS",
                "video/mp4",
            )
        } else {
            Triple(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                Environment.DIRECTORY_PICTURES + "/TARS",
                if (name.endsWith(".webp")) "image/webp" else "image/jpeg",
            )
        }
        return try {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, file.name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, dir)
            }
            val uri = context.contentResolver.insert(collection, values) ?: return false
            context.contentResolver.openOutputStream(uri)?.use { out ->
                file.inputStream().use { it.copyTo(out) }
            }
            file.delete() // staging copy no longer needed
            Log.i(TAG, "Published ${file.name} → $dir")
            true
        } catch (e: Exception) {
            Log.e(TAG, "publishToGallery failed for ${file.name}", e)
            false
        }
    }
}
