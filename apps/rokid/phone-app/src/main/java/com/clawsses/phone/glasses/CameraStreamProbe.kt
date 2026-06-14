package com.clawsses.phone.glasses

import android.util.Log
import com.rokid.cxr.client.extend.listeners.MediaStreamListener

/**
 * Verification probe for the CXR-M live camera stream (openCameraVideo).
 *
 * Step 1 of the "record with HUD overlay" feature: before building the full
 * decode → composite → encode → mux pipeline, this just confirms that encoded
 * camera frames actually arrive on the phone over Bluetooth, and logs enough to
 * identify the codec (H.264 frames start with the 00 00 00 01 NAL start code).
 *
 * Once frames are confirmed, this is replaced by the real OverlayVideoRecorder
 * that feeds onCameraFrame() bytes into a MediaCodec decoder.
 */
class CameraStreamProbe : MediaStreamListener {

    companion object { private const val TAG = "CameraStreamProbe" }

    @Volatile var frameCount: Int = 0
        private set
    @Volatile var totalBytes: Long = 0
        private set

    override fun onCameraOpened() {
        frameCount = 0
        totalBytes = 0
        Log.i(TAG, ">>> onCameraOpened — stream is live")
    }

    override fun onCameraClosed() {
        Log.i(TAG, "<<< onCameraClosed — $frameCount frames, $totalBytes bytes total")
    }

    override fun onCameraError() {
        Log.e(TAG, "!!! onCameraError")
    }

    override fun onCameraFrame(data: ByteArray?, timestamp: Long) {
        val size = data?.size ?: 0
        frameCount++
        totalBytes += size
        if (frameCount == 1 && data != null) {
            // Hex of first 16 bytes — 00 00 00 01 (or 00 00 01) = H.264/H.265 NAL.
            val head = data.take(16).joinToString(" ") { "%02X".format(it) }
            Log.i(TAG, "FIRST frame: $size bytes, ts=$timestamp, head=[$head]")
        }
        if (frameCount % 10 == 0) {
            Log.i(TAG, "frame #$frameCount: $size bytes, ts=$timestamp")
        }
    }
}
