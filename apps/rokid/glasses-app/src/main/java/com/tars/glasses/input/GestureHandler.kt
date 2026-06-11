package com.tars.glasses.input

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.MotionEvent
import kotlin.math.abs

/**
 * Recognizes gestures on the Rokid temple touchpad.
 *
 * The touchpad sends standard Android MotionEvents — wire it in by overriding
 * dispatchTouchEvent in HudActivity:
 *
 *   override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
 *       if (gestureHandler.onTouchEvent(ev)) return true
 *       return super.dispatchTouchEvent(ev)
 *   }
 *
 * The touchpad also sends hover events (ACTION_HOVER_*) from the external
 * touchpad — these are normalized to DOWN/MOVE/UP internally.
 *
 * Gesture map:
 *   Swipe forward (→ eyes):  SWIPE_FORWARD  — scroll up / prev menu item
 *   Swipe backward (→ ear):  SWIPE_BACKWARD — scroll down / next menu item
 *   Tap:                     TAP            — scroll to bottom / execute menu item
 *   Double-tap:              DOUBLE_TAP     — toggle menu focus
 *   Long-press:              LONG_PRESS     — voice input
 */
class GestureHandler(
    private val onSwipeForward: () -> Unit,
    private val onSwipeBackward: () -> Unit,
    private val onTap: () -> Unit,
    private val onDoubleTap: () -> Unit,
    private val onLongPress: () -> Unit,
) {
    companion object {
        private const val TAG = "GestureHandler"
        private const val SWIPE_THRESHOLD = 100
        private const val TAP_MOVE_THRESHOLD = 50
        private const val DOUBLE_TAP_TIMEOUT = 400L
        private const val LONG_PRESS_TIMEOUT = 500L
    }

    private var startX = 0f
    private var startY = 0f
    private var startTime = 0L
    private var tracking = false
    private var lastTapTime = 0L
    private val handler = Handler(Looper.getMainLooper())

    fun onTouchEvent(event: MotionEvent): Boolean {
        // Normalize hover events (external touchpad emits ACTION_HOVER_*)
        val action = when (event.action) {
            MotionEvent.ACTION_HOVER_ENTER -> MotionEvent.ACTION_DOWN
            MotionEvent.ACTION_HOVER_MOVE -> MotionEvent.ACTION_MOVE
            MotionEvent.ACTION_HOVER_EXIT -> MotionEvent.ACTION_UP
            else -> event.action
        }

        when (action) {
            MotionEvent.ACTION_DOWN -> {
                startX = event.x
                startY = event.y
                startTime = System.currentTimeMillis()
                tracking = true
                return true
            }

            MotionEvent.ACTION_MOVE -> return tracking

            MotionEvent.ACTION_UP -> {
                if (!tracking) return false
                tracking = false

                val dx = event.x - startX
                val dy = event.y - startY
                val dt = System.currentTimeMillis() - startTime

                // Long press
                if (dt > LONG_PRESS_TIMEOUT && abs(dx) < TAP_MOVE_THRESHOLD && abs(dy) < TAP_MOVE_THRESHOLD) {
                    Log.d(TAG, "LONG_PRESS (${dt}ms)")
                    onLongPress()
                    return true
                }

                // Swipe — prefer the larger axis, then map direction
                // Forward = towards eyes = negative Y (up) or negative X (left)
                if (abs(dx) > SWIPE_THRESHOLD || abs(dy) > SWIPE_THRESHOLD) {
                    val primary = if (abs(dy) > abs(dx)) dy else -dx
                    if (primary < 0) {
                        Log.d(TAG, "SWIPE_FORWARD (dx=$dx dy=$dy)")
                        onSwipeForward()
                    } else {
                        Log.d(TAG, "SWIPE_BACKWARD (dx=$dx dy=$dy)")
                        onSwipeBackward()
                    }
                    return true
                }

                // Tap / double-tap
                if (abs(dx) < TAP_MOVE_THRESHOLD && abs(dy) < TAP_MOVE_THRESHOLD) {
                    val now = System.currentTimeMillis()
                    if (now - lastTapTime < DOUBLE_TAP_TIMEOUT) {
                        Log.d(TAG, "DOUBLE_TAP")
                        lastTapTime = 0
                        onDoubleTap()
                    } else {
                        lastTapTime = now
                        // Delay single tap to let a second tap arrive first
                        handler.postDelayed({
                            if (lastTapTime == now) {
                                Log.d(TAG, "TAP")
                                onTap()
                            }
                        }, DOUBLE_TAP_TIMEOUT)
                    }
                    return true
                }
            }
        }
        return false
    }
}
