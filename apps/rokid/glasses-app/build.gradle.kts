plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Build number = total git commit count. Automatically increments with
// every commit — no manual bumping required. Shown in the HUD top bar as
// BuildConfig.BUILD_TAG ("b<N>") and used as Android versionCode.
val buildNumber: Int = try {
    val proc = ProcessBuilder("git", "rev-list", "--count", "HEAD")
        .redirectErrorStream(true)
        .start()
    proc.inputStream.bufferedReader().readLine()?.trim()?.toIntOrNull() ?: 0
} catch (_: Exception) { 0 }

android {
    namespace = "com.clawsses.glasses"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.clawsses.glasses"
        minSdk = 28  // Required for CXR-S SDK
        targetSdk = 34
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
        buildConfigField("String", "BUILD_TAG", "\"b$buildNumber\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    lint {
        // PhoneConnectionService is not a traditional Android Service,
        // it's a helper class. Disable this specific lint check.
        disable += "Instantiatable"
    }
}

dependencies {
    implementation(project(":shared"))

    // Rokid CXR-S SDK (Glasses side)
    implementation("com.rokid.cxr:cxr-service-bridge:1.0")

    // Android Core (minimal for glasses)
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.2")
    implementation("androidx.activity:activity-compose:1.8.2")

    // Jetpack Compose (lightweight)
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // JSON parsing
    implementation("com.google.code.gson:gson:2.10.1")
}
