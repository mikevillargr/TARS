package com.tars.phone.ui.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.tars.phone.glasses.GlassesConnectionManager
import kotlinx.coroutines.delay

@Composable
fun GlassesSection(
    state: GlassesConnectionManager.ConnectionState,
    discoveredDevices: List<GlassesConnectionManager.DiscoveredDevice>,
    wifiP2PConnected: Boolean,
    onStartScanning: () -> Unit,
    onStopScanning: () -> Unit,
    onConnectDevice: (GlassesConnectionManager.DiscoveredDevice) -> Unit,
    onDisconnect: () -> Unit,
    onCancelReconnect: () -> Unit,
    onRetryReconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.fillMaxWidth()) {
        when (state) {
            is GlassesConnectionManager.ConnectionState.Disconnected ->
                DisconnectedContent(onStartScanning)
            is GlassesConnectionManager.ConnectionState.Scanning ->
                ScanningContent(discoveredDevices, onStopScanning, onConnectDevice)
            is GlassesConnectionManager.ConnectionState.Connecting ->
                StatusRow(Color(0xFFFFC107), "Connecting…", "Please wait", showProgress = true)
            is GlassesConnectionManager.ConnectionState.Reconnecting ->
                ReconnectingContent(state.attempt, state.nextRetryMs, onCancelReconnect, onRetryReconnect)
            is GlassesConnectionManager.ConnectionState.Connected ->
                ConnectedContent(state.deviceName, wifiP2PConnected, onDisconnect)
            is GlassesConnectionManager.ConnectionState.Error ->
                ErrorContent(state.message, onStartScanning)
        }
    }
}

@Composable
private fun DisconnectedContent(onScan: () -> Unit) {
    StatusRow(Color.Gray, "Not connected", "Fold right leg, triple-click camera to start pairing mode on glasses")
    Spacer(Modifier.height(12.dp))
    Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.Search, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Scan for Glasses")
    }
}

@Composable
private fun ScanningContent(
    devices: List<GlassesConnectionManager.DiscoveredDevice>,
    onStop: () -> Unit,
    onConnect: (GlassesConnectionManager.DiscoveredDevice) -> Unit,
) {
    StatusRow(Color(0xFFFFC107), "Scanning…", "Looking for Rokid glasses nearby", showProgress = true)
    Spacer(Modifier.height(12.dp))
    OutlinedButton(onClick = onStop, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.Stop, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Stop Scanning")
    }
    if (devices.isNotEmpty()) {
        Spacer(Modifier.height(12.dp))
        Surface(shape = RoundedCornerShape(12.dp), tonalElevation = 1.dp, modifier = Modifier.fillMaxWidth()) {
            Column {
                devices.forEachIndexed { i, device ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(device.name, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                "${signalLabel(device.rssi)} (${device.rssi} dBm)",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        TextButton(onClick = { onConnect(device) }) { Text("Connect") }
                    }
                    if (i < devices.lastIndex) HorizontalDivider(modifier = Modifier.padding(start = 16.dp), thickness = 0.5.dp)
                }
            }
        }
        Spacer(Modifier.height(4.dp))
        Text("${devices.size} device${if (devices.size != 1) "s" else ""} found",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ConnectedContent(deviceName: String, wifiP2PConnected: Boolean, onDisconnect: () -> Unit) {
    StatusRow(Color(0xFF4CAF50), "Connected", deviceName)
    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Default.Bluetooth, contentDescription = null, modifier = Modifier.size(16.dp), tint = Color(0xFF4CAF50))
        Text("Bluetooth", style = MaterialTheme.typography.bodySmall)
        Icon(
            if (wifiP2PConnected) Icons.Default.Wifi else Icons.Default.WifiOff,
            contentDescription = null, modifier = Modifier.size(16.dp),
            tint = if (wifiP2PConnected) Color(0xFF4CAF50) else Color.Gray,
        )
        Text("WiFi P2P${if (!wifiP2PConnected) " (needed for install)" else ""}",
            style = MaterialTheme.typography.bodySmall)
    }
    Spacer(Modifier.height(12.dp))
    OutlinedButton(onClick = onDisconnect, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.LinkOff, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Disconnect")
    }
}

@Composable
private fun ReconnectingContent(attempt: Int, nextRetryMs: Long, onCancel: () -> Unit, onRetry: () -> Unit) {
    var secondsLeft by remember(nextRetryMs) { mutableIntStateOf((nextRetryMs / 1000).toInt().coerceAtLeast(0)) }
    LaunchedEffect(nextRetryMs) { while (secondsLeft > 0) { delay(1000); secondsLeft = (secondsLeft - 1).coerceAtLeast(0) } }
    StatusRow(Color(0xFFFFA500), "Reconnecting…", "Attempt #$attempt (retry in ${secondsLeft}s)", showProgress = true)
    Spacer(Modifier.height(12.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onCancel, modifier = Modifier.weight(1f)) { Text("Cancel") }
        Button(onClick = onRetry, modifier = Modifier.weight(1f)) { Text("Retry Now") }
    }
}

@Composable
private fun ErrorContent(message: String, onRetry: () -> Unit) {
    StatusRow(Color(0xFFF44336), "Error", message)
    Spacer(Modifier.height(12.dp))
    Button(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
        Icon(Icons.Default.BluetoothSearching, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text("Scan for Glasses")
    }
}

@Composable
private fun StatusRow(color: Color, title: String, subtitle: String, showProgress: Boolean = false) {
    Row(verticalAlignment = Alignment.Top, modifier = Modifier.fillMaxWidth()) {
        if (showProgress) {
            CircularProgressIndicator(modifier = Modifier.size(12.dp).padding(top = 2.dp), strokeWidth = 2.dp, color = color)
        } else {
            Icon(Icons.Default.Circle, contentDescription = null, tint = color, modifier = Modifier.size(12.dp).padding(top = 2.dp))
        }
        Spacer(Modifier.width(10.dp))
        Column {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

private fun signalLabel(rssi: Int) = when { rssi >= -50 -> "Strong"; rssi >= -70 -> "Medium"; else -> "Weak" }
