plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Rokid CXR-S SDK (glasses side) — download from developer.rokid.com
// Place the AAR at glasses-app/libs/rokid-cxr-s-sdk.aar
repositories {
    flatDir { dirs("libs") }
}

android {
    namespace = "com.tars.glasses"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tars.glasses"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildFeatures {
        compose = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = libs.versions.composeCompiler.get()
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation(project(":shared"))

    // Compose — target the 480x640 monochrome micro-LED HUD
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.okhttp)          // debug WebSocket server
    implementation(libs.gson)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.lifecycle.runtime.ktx)

    // Rokid CXR-S SDK (glasses side)
    // Download from developer.rokid.com → place at glasses-app/libs/rokid-cxr-s-sdk.aar
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar", "*.jar"))))
}
