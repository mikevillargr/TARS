package com.tars.phone.glasses

import android.util.Log
import com.tars.shared.WakeAck
import com.tars.shared.WakeSignal
import kotlinx.coroutines.*

/**
 * Manages the wake-signal protocol between phone and glasses.
 *
 * When TARS starts streaming, the glasses display may be in standby.
 * We send a wake_signal first, buffer messages, then flush after wake_ack.
 */
class WakeSignalManager(private val glassesManager: GlassesConnectionManager) {

    companion object {
        private const val TAG = "WakeSignalManager"
        private const val WAKE_TIMEOUT_MS = 3000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val buffer = mutableListOf<String>()
    private var wakeAckDeferred: CompletableDeferred<Boolean>? = null
    private var lastWakeSentAt = 0L

    /** Called when a new streaming event arrives. Wakes glasses if needed, buffers message. */
    fun wakeForContent(reason: String, messageId: String? = null) {
        val now = System.currentTimeMillis()
        // Debounce: don't send wake signal more than once per 2s during a stream
        if (now - lastWakeSentAt < 2000) return

        lastWakeSentAt = now
        val signal = WakeSignal(reason = reason, bufferedCount = buffer.size, messageId = messageId)
        glassesManager.send(signal.toJson())
        glassesManager.wakeDisplay()
        Log.d(TAG, "Sent wake signal: $reason")
    }

    /** Called when glasses acknowledge the wake signal. Flushes buffered messages. */
    fun onWakeAck(ack: WakeAck) {
        Log.d(TAG, "Wake ack received: ready=${ack.ready}")
        scope.launch {
            // Flush any buffered messages
            val pending = synchronized(buffer) {
                val copy = buffer.toList()
                buffer.clear()
                copy
            }
            pending.forEach { glassesManager.send(it) }
            wakeAckDeferred?.complete(ack.ready)
        }
    }
}
