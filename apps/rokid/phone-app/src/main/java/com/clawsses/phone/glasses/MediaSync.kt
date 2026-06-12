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
                        val f = resolveSyncedFile(staging, name)
                        if (f != null && publishToGallery(appCtx, f)) {
                            count++
                            onStatus("Synced $count file${if (count == 1) "" else "s"}…")
                        } else {
                            Log.w(TAG, "onFile couldn't resolve '$name' yet (will sweep at end)")
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

                // Sweep: publish anything left in staging that per-file callbacks
                // missed (the SDK may save into subdirs or report odd names).
                delay(1000)
                staging.walkTopDown().filter { it.isFile }.forEach { f ->
                    Log.i(TAG, "Sweep found: ${f.relativeTo(staging)} (${f.length()} bytes)")
                    if (publishToGallery(appCtx, f)) {
                        count++
                        onStatus("Synced $count file${if (count == 1) "" else "s"}…")
                    }
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

    /**
     * The SDK reports synced files inconsistently — bare name, relative path,
     * or absolute path, sometimes under media-type subdirs. Resolve defensively.
     */
    private fun resolveSyncedFile(staging: File, name: String): File? {
        val direct = File(name)
        if (direct.isAbsolute && direct.exists()) return direct
        val inStaging = File(staging, name)
        if (inStaging.exists()) return inStaging
        val baseName = name.substringAfterLast('/')
        return staging.walkTopDown().firstOrNull { it.isFile && it.name == baseName }
    }

    /**
     * Copy a synced media file into the camera roll under DCIM/TARS.
     *
     * DCIM is the only tree Samsung Gallery (and most galleries) always scan into
     * the main timeline — Movies/Pictures subfolders often hide in a Files app.
     * Non-media sidecar files (e.g. .txt metadata the SDK ships alongside videos)
     * are skipped.
     */
    private fun publishToGallery(context: Context, file: File): Boolean {
        if (!file.exists() || file.length() == 0L) {
            Log.w(TAG, "publishToGallery: missing/empty ${file.name}")
            return false
        }
        val name = file.name.lowercase()
        val isVideo = name.endsWith(".mp4") || name.endsWith(".mov") || name.endsWith(".3gp")
        val isImage = name.endsWith(".jpg") || name.endsWith(".jpeg") ||
                      name.endsWith(".png") || name.endsWith(".webp")
        if (!isVideo && !isImage) {
            Log.d(TAG, "Skipping non-media ${file.name}")
            file.delete()
            return false
        }

        // Clean up the SDK's prefixed name (savePath is used as a filename prefix,
        // so files arrive like "glasses_mediavid-20260611-...mp4").
        val cleanName = file.name.removePrefix("glasses_media").ifEmpty { file.name }
            .let { if (it.startsWith("vid") || it.startsWith("pic")) "tars-$it" else it }

        val (collection, mime) = if (isVideo) {
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI to "video/mp4"
        } else {
            MediaStore.Images.Media.EXTERNAL_CONTENT_URI to
                if (name.endsWith(".webp")) "image/webp"
                else if (name.endsWith(".png")) "image/png" else "image/jpeg"
        }
        val dir = Environment.DIRECTORY_DCIM + "/TARS"
        return try {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, cleanName)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, dir)
            }
            val uri = context.contentResolver.insert(collection, values) ?: return false
            context.contentResolver.openOutputStream(uri)?.use { out ->
                file.inputStream().use { it.copyTo(out) }
            }
            file.delete() // staging copy no longer needed
            Log.i(TAG, "Published $cleanName → $dir")
            true
        } catch (e: Exception) {
            Log.e(TAG, "publishToGallery failed for ${file.name}", e)
            false
        }
    }
}
