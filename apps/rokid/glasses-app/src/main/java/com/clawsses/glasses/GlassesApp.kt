package com.clawsses.glasses

import android.app.Application
import android.util.Log

class GlassesApp : Application() {

    companion object {
        const val TAG = "GlassesHUD"
        // BUILD_TAG is generated at compile time from git commit count (build.gradle.kts).
        // It increments automatically with every commit — never edit it manually.
        val BUILD_TAG: String get() = BuildConfig.BUILD_TAG
        lateinit var instance: GlassesApp
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        Log.d(TAG, "Clawsses HUD initialized — $BUILD_TAG")
    }
}
