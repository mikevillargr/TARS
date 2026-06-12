package com.clawsses.phone.ui.settings

import android.media.MediaPlayer
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.clawsses.phone.tts.ElevenLabsClient
import com.clawsses.phone.tts.TtsSettingsManager
import com.clawsses.phone.tts.Voice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream

/**
 * Voice settings for Kokoro TTS running on the TARS server — mirrors the
 * TARS web app's Voice section: voice picker, speed (0.5×–2.0×), preview.
 * No API key — auth rides the TARS login.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TtsSection(
    ttsSettingsManager: TtsSettingsManager,
    elevenLabsClient: ElevenLabsClient,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val selectedVoiceId by ttsSettingsManager.selectedVoiceId.collectAsState()
    val selectedVoiceName by ttsSettingsManager.selectedVoiceName.collectAsState()
    val isEnabled by ttsSettingsManager.isEnabled.collectAsState()
    val speed by ttsSettingsManager.speed.collectAsState()

    var showVoiceSheet by remember { mutableStateOf(false) }
    var voices by remember { mutableStateOf<List<Voice>>(emptyList()) }
    var isLoadingVoices by remember { mutableStateOf(false) }
    var voicesError by remember { mutableStateOf<String?>(null) }
    var fetchTrigger by remember { mutableIntStateOf(0) }
    var isPreviewing by remember { mutableStateOf(false) }

    val scope = rememberCoroutineScope()

    // Fetch Kokoro voices from the TARS server (retry via fetchTrigger)
    LaunchedEffect(fetchTrigger) {
        isLoadingVoices = true
        voicesError = null
        elevenLabsClient.getVoices("")
            .onSuccess { fetched ->
                voices = fetched
                isLoadingVoices = false
            }
            .onFailure { error ->
                voicesError = error.message
                isLoadingVoices = false
            }
    }

    fun playPreview() {
        if (isPreviewing) return
        isPreviewing = true
        scope.launch(Dispatchers.IO) {
            try {
                val result = elevenLabsClient.synthesize(
                    "", selectedVoiceId,
                    "Hello Mike, TARS here. This is how I sound.",
                    speed.toDouble()
                )
                result.onSuccess { input ->
                    val f = File.createTempFile("tts_preview_", ".wav", context.cacheDir)
                    FileOutputStream(f).use { out -> input.use { it.copyTo(out) } }
                    withContext(Dispatchers.Main) {
                        MediaPlayer().apply {
                            setDataSource(f.absolutePath)
                            setOnCompletionListener { release(); f.delete(); isPreviewing = false }
                            setOnErrorListener { _, _, _ -> release(); f.delete(); isPreviewing = false; true }
                            prepare()
                            start()
                        }
                    }
                }.onFailure {
                    isPreviewing = false
                }
            } catch (e: Exception) {
                isPreviewing = false
            }
        }
    }

    Column(modifier = modifier.padding(horizontal = 16.dp)) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            tonalElevation = 1.dp,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
            ) {
                // Header: icon, status, enable switch
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.RecordVoiceOver,
                        contentDescription = null,
                        tint = if (isEnabled) Color(0xFF4CAF50) else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(24.dp),
                    )
                    Spacer(Modifier.width(16.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Voice Responses", style = MaterialTheme.typography.bodyLarge)
                        Text(
                            if (isEnabled) "Kokoro · ${selectedVoiceName ?: "TARS default voice"}"
                            else "Disabled",
                            style = MaterialTheme.typography.bodySmall,
                            color = if (isEnabled) Color(0xFF4CAF50)
                                    else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = isEnabled,
                        onCheckedChange = { ttsSettingsManager.setEnabled(it) },
                    )
                }

                Spacer(Modifier.height(16.dp))

                // Voice picker row
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    tonalElevation = 2.dp,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(enabled = !isLoadingVoices) {
                            if (voices.isEmpty()) fetchTrigger++ else showVoiceSheet = true
                        },
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Default.GraphicEq,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            when {
                                isLoadingVoices -> "Loading voices…"
                                voicesError != null -> "Couldn't load voices — tap to retry"
                                selectedVoiceName != null -> selectedVoiceName!!
                                else -> "Voice: TARS default (tap to choose)"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.weight(1f),
                            color = if (voicesError != null) MaterialTheme.colorScheme.error
                                    else MaterialTheme.colorScheme.onSurface,
                        )
                        if (isLoadingVoices) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                        } else if (voicesError != null) {
                            Icon(Icons.Default.Refresh, contentDescription = "Retry", modifier = Modifier.size(18.dp))
                        }
                    }
                }

                Spacer(Modifier.height(16.dp))

                // Speed slider (0.5× – 2.0×, like the TARS web app)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Speed", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.weight(1f))
                    Text(
                        "%.2f×".format(speed),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Slider(
                    value = speed,
                    onValueChange = { ttsSettingsManager.setSpeed(it) },
                    valueRange = TtsSettingsManager.MIN_SPEED..TtsSettingsManager.MAX_SPEED,
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(8.dp))

                // Preview
                OutlinedButton(
                    onClick = { playPreview() },
                    enabled = !isPreviewing,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (isPreviewing) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                    } else {
                        Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(if (isPreviewing) "Playing…" else "Preview voice")
                }
            }
        }
    }

    // Voice selection bottom sheet — flat list of Kokoro voice names
    if (showVoiceSheet && voices.isNotEmpty()) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(
            onDismissRequest = { showVoiceSheet = false },
            sheetState = sheetState,
        ) {
            Column(modifier = Modifier.padding(horizontal = 16.dp)) {
                Text(
                    "Select Voice",
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                HorizontalDivider(thickness = 0.5.dp)
            }
            LazyColumn(modifier = Modifier.padding(horizontal = 16.dp)) {
                items(voices) { voice ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable {
                                ttsSettingsManager.setSelectedVoice(voice.voiceId, voice.name)
                                showVoiceSheet = false
                            }
                            .padding(vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            voice.name,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.weight(1f),
                        )
                        if (voice.voiceId == selectedVoiceId) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = "Selected",
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
                item { Spacer(Modifier.height(24.dp)) }
            }
        }
    }
}
