plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

// Inject Rokid SDK credentials from local.properties
val localProperties = java.util.Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) load(f.inputStream())
}

// Rokid CXR-M SDK (phone side) — download from developer.rokid.com
// Place the AAR at phone-app/libs/rokid-cxr-m-sdk.aar
repositories {
    flatDir { dirs("libs") }
}

android {
    namespace = "com.tars.phone"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tars.phone"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        buildConfigField("String", "ROKID_CLIENT_SECRET", "\"${localProperties["rokid.clientSecret"] ?: ""}\"")
        buildConfigField("String", "ROKID_ACCESS_KEY", "\"${localProperties["rokid.accessKey"] ?: ""}\"")
    }

    buildFeatures {
        buildConfig = true
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

    // Compose
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    debugImplementation(libs.compose.ui.tooling)

    // Networking
    implementation(libs.okhttp)
    implementation(libs.gson)

    // Coroutines
    implementation(libs.kotlinx.coroutines.android)

    // Lifecycle
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.viewmodel.compose)

    // Rokid CXR-M SDK (phone side)
    // Download from developer.rokid.com → place at phone-app/libs/rokid-cxr-m-sdk.aar
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar", "*.jar"))))
}
