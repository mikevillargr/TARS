package com.tars.phone.ui.settings

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.tars.phone.glasses.ApkInstaller
import com.tars.phone.glasses.GlassesConnectionManager
import com.tars.phone.glasses.RokidSdkManager
import com.tars.phone.tars.TarsAuthManager
import com.tars.phone.tars.TarsClient
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    authManager: TarsAuthManager,
    onConnected: (TarsClient.TarsConfig) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val creds = remember { authManager.getSavedCredentials() }
    val apkInstaller = remember { ApkInstaller(context) }
    val installState by apkInstaller.installState.collectAsState()

    val glassesManager = remember { GlassesConnectionManager.getInstance(context) }
    val glassesState by glassesManager.connectionState.collectAsState()
    val discoveredDevices by glassesManager.discoveredDevices.collectAsState()
    val wifiP2PConnected by glassesManager.wifiP2PConnected.collectAsState()

    val installPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        if (results.values.all { it }) apkInstaller.installGlassesApp()
    }
    fun requestInstallPermissionsAndInstall() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            installPermissionLauncher.launch(arrayOf(Manifest.permission.NEARBY_WIFI_DEVICES))
        } else {
            apkInstaller.installGlassesApp()
        }
    }

    var host by remember { mutableStateOf(creds?.host ?: "") }
    var port by remember { mutableStateOf(creds?.port?.toString() ?: "8000") }
    var username by remember { mutableStateOf(creds?.username ?: "mike") }
    var password by remember { mutableStateOf("") }
    var useTls by remember { mutableStateOf(creds?.useTls ?: false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("TARS", style = MaterialTheme.typography.headlineMedium)
        Text("Connect to your TARS server", style = MaterialTheme.typography.bodyMedium)

        HorizontalDivider()

        Text("Server", style = MaterialTheme.typography.titleSmall)

        OutlinedTextField(
            value = host,
            onValueChange = { host = it },
            label = { Text("Host / IP") },
            placeholder = { Text("192.168.1.x or your-tailscale-host") },
            modifier = Modifier.fillMaxWidth(),
        )

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(
                value = port,
                onValueChange = { port = it },
                label = { Text("Port") },
                modifier = Modifier.width(100.dp),
            )
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Switch(checked = useTls, onCheckedChange = { useTls = it })
                Spacer(Modifier.width(8.dp))
                Text("TLS")
            }
        }

        HorizontalDivider()

        Text("Credentials", style = MaterialTheme.typography.titleSmall)

        OutlinedTextField(
            value = username,
            onValueChange = { username = it },
            label = { Text("Username") },
            modifier = Modifier.fillMaxWidth(),
        )

        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Password") },
            visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth(),
        )

        Button(
            onClick = {
                if (host.isBlank() || password.isBlank()) {
                    statusMessage = "Host and password are required"
                    return@Button
                }
                scope.launch {
                    isLoading = true
                    statusMessage = null
                    try {
                        val token = authManager.login(
                            host = host.trim(),
                            port = port.toIntOrNull() ?: 8000,
                            username = username.trim(),
                            password = password,
                            useTls = useTls,
                        )
                        authManager.saveCredentials(
                            host = host.trim(),
                            port = port.toIntOrNull() ?: 8000,
                            token = token,
                            username = username.trim(),
                            useTls = useTls,
                        )
                        statusMessage = "Connected!"
                        onConnected(
                            TarsClient.TarsConfig(
                                host = host.trim(),
                                port = port.toIntOrNull() ?: 8000,
                                token = token,
                                useTls = useTls,
                            )
                        )
                    } catch (e: Exception) {
                        statusMessage = "Error: ${e.message}"
                    } finally {
                        isLoading = false
                    }
                }
            },
            enabled = !isLoading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (isLoading) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            Text("Login & Connect")
        }

        statusMessage?.let {
            Text(
                text = it,
                color = if (it.startsWith("Error")) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodySmall,
            )
        }

        if (creds != null) {
            HorizontalDivider()
            Text(
                "Currently configured: ${creds.host}:${creds.port} (${creds.username})",
                style = MaterialTheme.typography.bodySmall,
            )
        }

        HorizontalDivider()
        Text("Glasses", style = MaterialTheme.typography.titleSmall)

        GlassesSection(
            state = glassesState,
            discoveredDevices = discoveredDevices,
            wifiP2PConnected = wifiP2PConnected,
            onStartScanning = { glassesManager.startScanning() },
            onStopScanning = { glassesManager.stopScanning() },
            onConnectDevice = { glassesManager.connectToDevice(it) },
            onDisconnect = { glassesManager.disconnect() },
            onCancelReconnect = { glassesManager.cancelReconnect() },
            onRetryReconnect = { glassesManager.retryReconnectNow() },
        )

        Text(
            "Install the TARS HUD app onto your Rokid AR Lite.\nConnect to glasses first, then tap Install.",
            style = MaterialTheme.typography.bodySmall,
        )

        val installing = installState is ApkInstaller.InstallState.Uploading ||
                         installState is ApkInstaller.InstallState.Installing ||
                         installState is ApkInstaller.InstallState.InitializingWifiP2P ||
                         installState is ApkInstaller.InstallState.PreparingApk ||
                         installState is ApkInstaller.InstallState.Launching
        val glassesConnected = glassesState is GlassesConnectionManager.ConnectionState.Connected

        Button(
            onClick = { requestInstallPermissionsAndInstall() },
            enabled = !installing && glassesConnected,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (installing) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(8.dp))
            }
            val label = when (val s = installState) {
                is ApkInstaller.InstallState.InitializingWifiP2P -> s.message
                is ApkInstaller.InstallState.PreparingApk -> "Preparing APK…"
                is ApkInstaller.InstallState.Uploading -> s.message
                is ApkInstaller.InstallState.Installing -> s.message
                is ApkInstaller.InstallState.Launching -> s.message
                is ApkInstaller.InstallState.Success -> "Installed ✓"
                is ApkInstaller.InstallState.Error -> "Retry Install"
                else -> "Install to Glasses"
            }
            Text(label)
        }

        when (val s = installState) {
            is ApkInstaller.InstallState.Success -> Text(
                s.message,
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.bodySmall,
            )
            is ApkInstaller.InstallState.Error -> Text(
                s.message,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
            else -> {}
        }
    }
}
