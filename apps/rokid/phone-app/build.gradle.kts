import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val localProperties = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) load(f.inputStream())
}

android {
    namespace = "com.tars.phone"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tars.phone"
        minSdk = 28
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "ROKID_CLIENT_SECRET", "\"${localProperties.getProperty("rokid.clientSecret", "")}\"")
        buildConfigField("String", "ROKID_ACCESS_KEY", "\"${localProperties.getProperty("rokid.accessKey", "")}\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }

    packaging {
        resources {
            excludes += listOf("META-INF/LICENSE.md", "META-INF/LICENSE-notice.md", "META-INF/NOTICE.md")
        }
    }
}

// Bundle glasses APK into phone-app assets so the phone can push it to glasses over WiFi
val bundleGlassesApk by tasks.registering(Copy::class) {
    dependsOn(":glasses-app:assembleDebug")
    from("${project(":glasses-app").buildDir}/outputs/apk/debug/glasses-app-debug.apk")
    into("src/main/assets")
    rename { "glasses-app-release.apk" }
}
tasks.named("preBuild") { dependsOn(bundleGlassesApk) }

dependencies {
    implementation(project(":shared"))

    // Rokid CXR-M SDK — phone side
    implementation("com.rokid.cxr:client-m:1.0.8")

    // Compose
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Networking
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.code.gson:gson:2.10.1")

    // ADB-over-WiFi for glasses APK installation
    implementation("dev.mobile:dadb:1.2.10")

    // Coroutines + Lifecycle
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.6.2")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.6.2")
    implementation("androidx.core:core-ktx:1.12.0")
}
