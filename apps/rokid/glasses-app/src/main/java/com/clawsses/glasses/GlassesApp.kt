package com.clawsses.glasses

import android.app.Application
import android.util.Log

class GlassesApp : Application() {

    companion object {
        const val TAG = "GlassesHUD"
        // Bump on every glasses build so the HUD top bar confirms what's running.
        const val BUILD_TAG = "b15"
        lateinit var instance: GlassesApp
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.d(TAG, "Clawsses HUD initialized")
    }
}
