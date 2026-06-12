package com.clawsses.phone.openclaw

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Executes confirmations for TARS interactive cards surfaced on the glasses HUD.
 *
 * The harness streams cards (email_draft, calendar_suggest, task_suggest) to the
 * HUD; on Confirm the glasses send card_action back and this maps the card to
 * the same REST endpoints the TARS web app uses:
 *   email_draft      -> POST /api/email/confirm-send
 *   calendar_suggest -> POST /api/calendar/events
 *   task_suggest     -> POST /api/tasks
 */
object CardActions {

    private const val TAG = "CardActions"
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /** Confirm [card]; callback(success, humanSummary) on completion. */
    fun confirm(card: JSONObject, callback: (Boolean, String) -> Unit) {
        if (!TarsServerConfig.isReady) {
            callback(false, "Not connected to TARS")
            return
        }
        val type = card.optString("type")
        val (path, payload, summary) = when (type) {
            "email_draft" -> Triple(
                "/api/email/confirm-send",
                JSONObject().apply {
                    put("to", card.optString("to"))
                    put("subject", card.optString("subject"))
                    put("body", card.optString("body"))
                    card.optString("cc").takeIf { it.isNotEmpty() }?.let { put("cc", it) }
                    card.optString("thread_id").takeIf { it.isNotEmpty() }?.let { put("thread_id", it) }
                },
                "Email sent to ${card.optString("to")}"
            )
            "calendar_suggest" -> Triple(
                "/api/calendar/events",
                JSONObject().apply {
                    put("title", card.optString("title"))
                    // Harness card uses datetime_iso; endpoint expects start
                    put("start", card.optString("datetime_iso").ifEmpty { card.optString("start") })
                    put("duration_min", card.optInt("duration_min", 60))
                    card.optString("description").takeIf { it.isNotEmpty() }?.let { put("description", it) }
                    card.optString("location").takeIf { it.isNotEmpty() }?.let { put("location", it) }
                },
                "Event added: ${card.optString("title")}"
            )
            "task_suggest" -> Triple(
                "/api/tasks",
                JSONObject().apply {
                    put("title", card.optString("title"))
                    card.optString("description").takeIf { it.isNotEmpty() }?.let { put("description", it) }
                    put("priority", card.optString("priority").ifEmpty { "normal" })
                    card.optString("due_at").takeIf { it.isNotEmpty() }?.let { put("due_at", it) }
                },
                "Task created: ${card.optString("title")}"
            )
            else -> {
                callback(false, "Unsupported card: $type")
                return
            }
        }

        scope.launch {
            try {
                val request = Request.Builder()
                    .url("${TarsServerConfig.baseUrl()}$path")
                    .header("Authorization", "Bearer ${TarsServerConfig.token}")
                    .post(payload.toString().toRequestBody("application/json".toMediaType()))
                    .build()
                http.newCall(request).execute().use { resp ->
                    if (resp.isSuccessful) {
                        Log.i(TAG, "confirm $type ok (${resp.code})")
                        callback(true, summary)
                    } else {
                        val body = resp.body?.string()?.take(120)
                        Log.w(TAG, "confirm $type failed: ${resp.code} $body")
                        callback(false, "Failed (${resp.code}): ${card.optString("type")}")
                    }
                }
            } catch (e: Exception) {
                Log.e(TAG, "confirm $type error", e)
                callback(false, "Error: ${e.message}")
            }
        }
    }
}
