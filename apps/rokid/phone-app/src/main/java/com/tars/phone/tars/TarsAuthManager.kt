package com.tars.phone.tars

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Handles JWT token acquisition and persistence for TARS.
 *
 * POST /api/auth/login  {"username": "...", "password": "..."}
 * → {"access_token": "...", "token_type": "bearer"}
 */
class TarsAuthManager(context: Context) {

    companion object {
        private const val TAG = "TarsAuthManager"
        private const val PREFS_NAME = "tars_auth"
        private const val KEY_HOST = "host"
        private const val KEY_PORT = "port"
        private const val KEY_TOKEN = "token"
        private const val KEY_USERNAME = "username"
        private const val KEY_USE_TLS = "use_tls"
    }

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    data class TarsCredentials(
        val host: String,
        val port: Int,
        val token: String,
        val username: String,
        val useTls: Boolean,
    )

    fun getSavedCredentials(): TarsCredentials? {
        val host = prefs.getString(KEY_HOST, null) ?: return null
        val port = prefs.getInt(KEY_PORT, 8000)
        val token = prefs.getString(KEY_TOKEN, null) ?: return null
        val username = prefs.getString(KEY_USERNAME, "") ?: ""
        val useTls = prefs.getBoolean(KEY_USE_TLS, false)
        return TarsCredentials(host, port, token, username, useTls)
    }

    fun saveCredentials(host: String, port: Int, token: String, username: String, useTls: Boolean) {
        prefs.edit()
            .putString(KEY_HOST, host)
            .putInt(KEY_PORT, port)
            .putString(KEY_TOKEN, token)
            .putString(KEY_USERNAME, username)
            .putBoolean(KEY_USE_TLS, useTls)
            .apply()
    }

    fun clearCredentials() {
        prefs.edit().clear().apply()
    }

    /** Login to TARS and return a JWT token. Throws on failure. */
    suspend fun login(host: String, port: Int, username: String, password: String, useTls: Boolean): String {
        return withContext(Dispatchers.IO) {
            val scheme = if (useTls) "https" else "http"
            val url = "$scheme://$host:$port/api/auth/login"
            val body = JSONObject().apply {
                put("username", username)
                put("password", password)
            }.toString().toRequestBody("application/json".toMediaType())

            val request = Request.Builder()
                .url(url)
                .post(body)
                .build()

            val response = httpClient.newCall(request).execute()
            if (!response.isSuccessful) {
                throw Exception("Login failed: ${response.code} ${response.message}")
            }

            val responseBody = response.body?.string()
                ?: throw Exception("Empty response from TARS")

            val json = JSONObject(responseBody)
            json.getString("access_token").also {
                Log.i(TAG, "Logged in to TARS at $host:$port as $username")
            }
        }
    }

    fun getTarsClientConfig(credentials: TarsCredentials): TarsClient.TarsConfig {
        return TarsClient.TarsConfig(
            host = credentials.host,
            port = credentials.port,
            token = credentials.token,
            useTls = credentials.useTls,
        )
    }
}
