package com.tars.glasses.input

/**
 * Translates Rokid touchpad gestures to semantic actions.
 *
 * Gesture model (temple touchpad):
 *   Swipe forward (→ eyes):   onSwipeForward
 *   Swipe backward (→ ear):   onSwipeBackward
 *   Tap:                       onTap
 *   Double-tap:                onDoubleTap
 *   Long-press:                onLongPress (voice input)
 *
 * Wire this into the Rokid AR Lite touchpad event API:
 *   https://developer.rokid.com (CXR SDK touch event callbacks)
 */
class GestureHandler(
    private val onSwipeForward: () -> Unit,
    private val onSwipeBackward: () -> Unit,
    private val onTap: () -> Unit,
    private val onDoubleTap: () -> Unit,
    private val onLongPress: () -> Unit,
) {
    // TODO: Register with Rokid SDK touchpad event callbacks
    // Example pseudocode:
    //   RokidTouchpad.setListener { event ->
    //       when (event.type) {
    //           SWIPE_FORWARD  -> onSwipeForward()
    //           SWIPE_BACKWARD -> onSwipeBackward()
    //           TAP            -> onTap()
    //           DOUBLE_TAP     -> onDoubleTap()
    //           LONG_PRESS     -> onLongPress()
    //       }
    //   }
}
