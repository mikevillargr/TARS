pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

// Load local.properties for Rokid Maven credentials
val localProps = java.util.Properties().apply {
    val f = File(rootDir, "local.properties")
    if (f.exists()) load(f.inputStream())
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        maven {
            url = uri("https://maven.rokid.com/repository/maven-public/")
            credentials {
                username = localProps["rokid.maven.username"] as String? ?: ""
                password = localProps["rokid.maven.password"] as String? ?: ""
            }
        }
        google()
        mavenCentral()
    }
}

rootProject.name = "tars-rokid"

include(":shared")
include(":phone-app")
include(":glasses-app")
