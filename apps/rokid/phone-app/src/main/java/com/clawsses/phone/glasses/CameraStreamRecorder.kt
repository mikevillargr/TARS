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
    private var actualW = width
    private var actualH = height

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
                // Real dimensions come from the SPS — hardcoding caused the stretch.
                val dims = parseSpsDimensions(spsPps.first)
                if (dims != null) { actualW = dims.first; actualH = dims.second }
                Log.i(TAG, "stream resolution from SPS: ${actualW}x$actualH (requested ${width}x$height)")
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
        val fmt = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, actualW, actualH).apply {
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

    /** Minimal MSB-first bit reader for Exp-Golomb SPS parsing. */
    private class BitReader(private val d: ByteArray) {
        private var bytePos = 0; private var bitPos = 0
        fun bit(): Int {
            if (bytePos >= d.size) return 0
            val b = (d[bytePos].toInt() ushr (7 - bitPos)) and 1
            if (++bitPos == 8) { bitPos = 0; bytePos++ }
            return b
        }
        fun bits(n: Int): Int { var v = 0; repeat(n) { v = (v shl 1) or bit() }; return v }
        fun ue(): Int {
            var z = 0; while (bit() == 0 && bytePos < d.size) z++
            if (z == 0) return 0
            var v = 1; repeat(z) { v = (v shl 1) or bit() }; return v - 1
        }
    }

    /** Decode width/height from an SPS NAL (Annex-B, with start code). Baseline-profile
     *  stream (no scaling-matrix branch). Returns null on failure. */
    private fun parseSpsDimensions(sps: ByteArray): Pair<Int, Int>? {
        return try {
            var off = 0
            off += when {
                sps.size > 4 && sps[0].toInt()==0 && sps[1].toInt()==0 && sps[2].toInt()==0 && sps[3].toInt()==1 -> 4
                sps.size > 3 && sps[0].toInt()==0 && sps[1].toInt()==0 && sps[2].toInt()==1 -> 3
                else -> 0
            }
            off += 1 // NAL header byte (0x67)
            // strip emulation-prevention bytes (00 00 03)
            val rbsp = ArrayList<Byte>(sps.size)
            var zeros = 0
            var i = off
            while (i < sps.size) {
                val b = sps[i]
                if (zeros >= 2 && b.toInt() == 3) { zeros = 0; i++; continue }
                zeros = if (b.toInt() == 0) zeros + 1 else 0
                rbsp.add(b); i++
            }
            val r = BitReader(rbsp.toByteArray())
            val profileIdc = r.bits(8)
            r.bits(8); r.bits(8) // constraint flags + level
            r.ue() // sps id
            if (profileIdc in intArrayOf(100,110,122,244,44,83,86,118,128,138,139,134,135)) {
                val chroma = r.ue()
                if (chroma == 3) r.bit()
                r.ue(); r.ue(); r.bit()
                if (r.bit() == 1) return null // scaling matrix present — bail (not baseline)
            }
            r.ue() // log2_max_frame_num_minus4
            val pocType = r.ue()
            when (pocType) {
                0 -> r.ue()
                1 -> { r.bit(); r.ue(); r.ue(); val n = r.ue(); repeat(n) { r.ue() } }
            }
            r.ue() // max_num_ref_frames
            r.bit() // gaps_in_frame_num_allowed
            val widthMbs = r.ue() + 1
            val heightMapUnits = r.ue() + 1
            val frameMbsOnly = r.bit()
            if (frameMbsOnly == 0) r.bit() // mb_adaptive_frame_field
            r.bit() // direct_8x8_inference
            var w = widthMbs * 16
            var h = (2 - frameMbsOnly) * heightMapUnits * 16
            if (r.bit() == 1) { // frame_cropping (assume 4:2:0)
                val l = r.ue(); val rt = r.ue(); val t = r.ue(); val b = r.ue()
                w -= (l + rt) * 2
                h -= (t + b) * 2 * (2 - frameMbsOnly)
            }
            if (w in 1..4096 && h in 1..4096) w to h else null
        } catch (e: Exception) { Log.w(TAG, "SPS parse failed: $e"); null }
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
