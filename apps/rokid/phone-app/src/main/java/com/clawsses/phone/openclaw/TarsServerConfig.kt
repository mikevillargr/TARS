package com.clawsses.phone.openclaw

/**
 * Connection details for the TARS harness, set by OpenClawClient on connect.
 * Shared with components that call TARS REST endpoints directly (e.g. Kokoro TTS).
 */
object TarsServerConfig {
    @Volatile var host: String = ""
    @Volatile var port: Int = 8000
    @Volatile var token: String = ""
    @Volatile var useTls: Boolean = false

    val isReady: Boolean get() = host.isNotEmpty() && token.isNotEmpty()

    fun baseUrl(): String {
        val scheme = if (useTls) "https" else "http"
        return "$scheme://$host:$port"
    }
}
