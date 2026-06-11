package com.tars.phone

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.tars.phone.tars.TarsAuthManager
import com.tars.phone.tars.TarsBridgeService
import com.tars.phone.tars.TarsClient
import com.tars.phone.ui.settings.SettingsScreen
import com.tars.phone.ui.theme.TarsTheme

class MainActivity : ComponentActivity() {

    private lateinit var authManager: TarsAuthManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        authManager = TarsAuthManager(this)

        // Mic permission for glasses long-press → voice input (SpeechRecognizer on the phone).
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            != PackageManager.PERMISSION_GRANTED
        ) {
            registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* best effort */ }
                .launch(Manifest.permission.RECORD_AUDIO)
        }

        // Start bridge service on launch if credentials exist
        if (authManager.getSavedCredentials() != null) {
            startBridgeService()
        }

        @OptIn(ExperimentalMaterial3Api::class)
        setContent {
            TarsTheme {
                var showSettings by remember {
                    mutableStateOf(authManager.getSavedCredentials() == null)
                }

                if (showSettings) {
                    Scaffold(
                        topBar = {
                            TopAppBar(title = { Text("TARS Setup") })
                        }
                    ) { padding ->
                        Box(Modifier.padding(padding)) {
                            SettingsScreen(
                                authManager = authManager,
                                onConnected = { _ ->
                                    startBridgeService()
                                    showSettings = false
                                }
                            )
                        }
                    }
                } else {
                    MainScreen(
                        authManager = authManager,
                        onOpenSettings = { showSettings = true },
                    )
                }
            }
        }
    }

    private fun startBridgeService() {
        startForegroundService(Intent(this, TarsBridgeService::class.java))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    authManager: TarsAuthManager,
    onOpenSettings: () -> Unit,
) {
    val creds = remember { authManager.getSavedCredentials() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("TARS") },
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("TARS Bridge", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(16.dp))
            if (creds != null) {
                Text(
                    "Connected to ${creds.host}:${creds.port}",
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "Running in background — put on your Rokid glasses.",
                    style = MaterialTheme.typography.bodySmall,
                )
            } else {
                Text("Not configured — open Settings to connect.", style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}
