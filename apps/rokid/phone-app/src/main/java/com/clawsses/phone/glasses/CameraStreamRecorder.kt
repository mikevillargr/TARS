package com.clawsses.phone.glasses

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.provider.MediaStore
import android.util.Log
import com.rokid.cxr.client.extend.listeners.MediaStreamListener
import java.nio.ByteBuffer

/**
 * Receives the live H.264 camera stream from the glasses (openCameraVideo) and muxes it
 * straight into an MP4 saved to the phone's Movies/Clawsses collection (visible in the
 * gallery). No overlay yet — the HUD-overlay compositor (decode → GL composite →
 * re-encode) is the next step and will sit in front of this same stream.
 *
 * The stream is H.264 Annex-B (start-code delimited); the first keyframe carries
 * SPS (NAL type 7) + PPS (type 8) which we lift into the MP4 track format.
 */
class CameraStreamRecorder(
    private val context: Context,
    private val width: Int = 1280,
    private val height: Int = 720,
) : MediaStreamListener {

    companion object { private const val TAG = "CameraStreamRecorder" }

    private var muxer: MediaMuxer? = null
    private var pfd: ParcelFileDescriptor? = null
    private var uri: Uri? = null
    private var trackIndex = -1
    private var started = false
    private var firstTsMs = -1L
    private var frameCount = 0

    override fun onCameraOpened() {
        Log.i(TAG, ">>> onCameraOpened — stream is live")
        frameCount = 0; firstTsMs = -1L; started = false
    }

    override fun onCameraClosed() {
        Log.i(TAG, "<<< onCameraClosed")
        stop()
    }

    override fun onCameraError() {
        Log.e(TAG, "!!! onCameraError")
        stop()
    }

    @Synchronized
    override fun onCameraFrame(data: ByteArray?, timestamp: Long) {
        if (data == null || data.isEmpty()) return
        try {
            if (!started) {
                val spsPps = extractSpsPps(data)
                if (spsPps == null) {
                    Log.w(TAG, "frame $frameCount: waiting for SPS/PPS keyframe")
                    return
                }
                startMuxer(spsPps.first, spsPps.second)
            }
            if (firstTsMs < 0) firstTsMs = timestamp
            val ptsUs = (timestamp - firstTsMs).coerceAtLeast(0) * 1000L
            val isKey = isKeyFrame(data)
            val info = MediaCodec.BufferInfo().apply {
                set(0, data.size, ptsUs, if (isKey) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            }
            muxer?.writeSampleData(trackIndex, ByteBuffer.wrap(data), info)
            frameCount++
            if (frameCount == 1 || frameCount % 10 == 0) {
                Log.i(TAG, "wrote frame #$frameCount pts=${ptsUs}us key=$isKey size=${data.size}")
            }
        } catch (e: Exception) {
            Log.e(TAG, "onCameraFrame failed", e)
        }
    }

    private fun startMuxer(sps: ByteArray, pps: ByteArray) {
        val name = "clawsses_${System.currentTimeMillis()}.mp4"
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, "video/mp4")
            if (Build.VERSION.SDK_INT >= 29) {
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/Clawsses")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }
        val resolver = context.contentResolver
        val u = resolver.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
            ?: throw IllegalStateException("MediaStore insert failed")
        uri = u
        val p = resolver.openFileDescriptor(u, "rw")
            ?: throw IllegalStateException("openFileDescriptor failed")
        pfd = p
        val mx = MediaMuxer(p.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val fmt = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setByteBuffer("csd-0", ByteBuffer.wrap(sps))
            setByteBuffer("csd-1", ByteBuffer.wrap(pps))
        }
        trackIndex = mx.addTrack(fmt)
        mx.start()
        muxer = mx
        started = true
        Log.i(TAG, "muxer started → $name ($u)")
    }

    /** Finalize the MP4. Safe to call repeatedly. */
    @Synchronized
    fun stop() {
        if (muxer != null) Log.i(TAG, "finalizing MP4 — $frameCount frames")
        try { muxer?.stop() } catch (e: Exception) { Log.w(TAG, "muxer.stop: $e") }
        try { muxer?.release() } catch (_: Exception) {}
        muxer = null
        try { pfd?.close() } catch (_: Exception) {}
        pfd = null
        uri?.let { u ->
            if (Build.VERSION.SDK_INT >= 29) {
                val v = ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }
                try { context.contentResolver.update(u, v, null, null) } catch (_: Exception) {}
            }
            Log.i(TAG, "saved video → Movies/Clawsses ($u)")
        }
        uri = null
        started = false
        trackIndex = -1
    }

    // --- H.264 Annex-B NAL helpers ---

    private fun extractSpsPps(data: ByteArray): Pair<ByteArray, ByteArray>? {
        var sps: ByteArray? = null; var pps: ByteArray? = null
        for ((s, e) in splitNals(data)) {
            when (nalType(data, s)) {
                7 -> sps = data.copyOfRange(s, e)
                8 -> pps = data.copyOfRange(s, e)
            }
        }
        return if (sps != null && pps != null) sps!! to pps!! else null
    }

    private fun isKeyFrame(data: ByteArray): Boolean =
        splitNals(data).any { nalType(data, it.first).let { t -> t == 5 || t == 7 } }

    /** Ranges [start,end) of each NAL unit, including its start code. */
    private fun splitNals(data: ByteArray): List<Pair<Int, Int>> {
        val starts = ArrayList<Int>()
        var i = 0
        while (i + 2 < data.size) {
            if (data[i].toInt() == 0 && data[i + 1].toInt() == 0 && data[i + 2].toInt() == 1) {
                starts.add(if (i > 0 && data[i - 1].toInt() == 0) i - 1 else i)
                i += 3
            } else i++
        }
        val ranges = ArrayList<Pair<Int, Int>>()
        for (j in starts.indices) {
            val s = starts[j]
            val e = if (j + 1 < starts.size) starts[j + 1] else data.size
            ranges.add(s to e)
        }
        return ranges
    }

    /** NAL type (low 5 bits) of the byte following the start code at [start]. */
    private fun nalType(data: ByteArray, start: Int): Int {
        var p = start
        while (p + 2 < data.size && !(data[p].toInt() == 0 && data[p + 1].toInt() == 0 && data[p + 2].toInt() == 1)) p++
        p += 3
        if (p >= data.size) return -1
        return data[p].toInt() and 0x1F
    }
}
