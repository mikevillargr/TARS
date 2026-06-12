package com.clawsses.phone.tts

import com.clawsses.phone.openclaw.TarsServerConfig
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.InputStream
import java.util.concurrent.TimeUnit

/**
 * TTS client for the TARS harness's Kokoro engine (clawsses' ElevenLabs client
 * retrofitted — class/method names kept so the rest of the app is unchanged).
 *
 *   POST {base}/api/tts          {"text","voice"?,"speed"?} -> audio/wav
 *   GET  {base}/api/tts/voices   -> {"voices": ["af_bella", ...]}
 *
 * Auth is the TARS JWT from [TarsServerConfig] (set on connect); the legacy
 * `apiKey` parameters are ignored. Voice may be null/blank — the harness then
 * uses the user's saved TARS voice preference.
 */
class ElevenLabsClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS) // Kokoro synthesis of long replies
        .build()

    private val gson = Gson()

    /** Wait briefly for the TARS connection to come up (e.g. settings opened early). */
    private suspend fun awaitConfig(): Boolean {
        var waited = 0
        while (!TarsServerConfig.isReady && waited < 5_000) {
            delay(250); waited += 250
        }
        return TarsServerConfig.isReady
    }

    /** Fetch available Kokoro voices from the TARS harness. */
    suspend fun getVoices(apiKey: String): Result<List<Voice>> = withContext(Dispatchers.IO) {
        try {
            if (!awaitConfig()) {
                return@withContext Result.failure(Exception("Not connected to TARS yet"))
            }
            val request = Request.Builder()
                .url("${TarsServerConfig.baseUrl()}/api/tts/voices")
                .header("Authorization", "Bearer ${TarsServerConfig.token}")
                .get()
                .build()

            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        Exception("Failed to fetch voices: ${response.code} ${response.message}")
                    )
                }
                val body = response.body?.string()
                    ?: return@withContext Result.failure(Exception("Empty response body"))
                val voicesResponse = gson.fromJson(body, KokoroVoicesResponse::class.java)
                val names = voicesResponse?.voices ?: emptyList()
                Result.success(names.map { Voice(voiceId = it, name = it) })
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Synthesize text via Kokoro on the TARS server.
     * Returns WAV audio data as InputStream.
     */
    suspend fun synthesize(
        apiKey: String,
        voiceId: String?,
        text: String,
        speed: Double = 1.0
    ): Result<InputStream> = withContext(Dispatchers.IO) {
        try {
            if (!awaitConfig()) {
                return@withContext Result.failure(Exception("Not connected to TARS yet"))
            }
            val payload = JsonObject().apply {
                addProperty("text", text)
                if (!voiceId.isNullOrBlank()) addProperty("voice", voiceId)
                addProperty("speed", speed)
            }
            val request = Request.Builder()
                .url("${TarsServerConfig.baseUrl()}/api/tts")
                .header("Authorization", "Bearer ${TarsServerConfig.token}")
                .post(gson.toJson(payload).toRequestBody("application/json".toMediaType()))
                .build()

            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                val errorBody = response.body?.string() ?: "Unknown error"
                response.close()
                return@withContext Result.failure(
                    Exception("TTS synthesis failed: ${response.code} - $errorBody")
                )
            }
            val inputStream = response.body?.byteStream()
                ?: run {
                    response.close()
                    return@withContext Result.failure(Exception("Empty response body"))
                }
            Result.success(inputStream)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }
}

// API response models

data class Voice(
    @SerializedName("voice_id") val voiceId: String,
    @SerializedName("name") val name: String,
    @SerializedName("preview_url") val previewUrl: String? = null,
    @SerializedName("category") val category: String? = null
)

data class KokoroVoicesResponse(
    @SerializedName("voices") val voices: List<String>? = null
)
