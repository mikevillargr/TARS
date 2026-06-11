package com.tars.glasses.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tars.glasses.R
import com.tars.shared.ChatMessage

/**
 * TARS HUD — renders on the Rokid AR Lite's 480x640 monochrome green micro-LED.
 *
 * Display specs:
 *   Resolution: 480x640 (portrait)
 *   Color:      Monochrome green on transparent AR waveguide
 *   Brightness: 1500 nits
 *   Font:       JetBrains Mono
 *
 * Gesture model (same as clawsses):
 *   Swipe →      Scroll down (message history focus) / Prev item (menu focus)
 *   Swipe ←      Scroll up / Next item
 *   Tap          Scroll to bottom / Execute menu action
 *   Double-tap   Jump to menu / Exit app
 *   Long-press   Voice input
 */

// Rokid green monochrome palette
val HudGreen = Color(0xFF00FF41)          // primary text
val HudGreenDim = Color(0xFF007A1F)       // secondary / dimmed
val HudBackground = Color(0x00000000)    // transparent (AR waveguide)
val HudUserColor = Color(0xFF88FF99)      // user bubbles, slightly lighter
val HudMenuBg = Color(0xCC001100)        // menu bar background

private val JetBrainsMono = FontFamily(
    Font(R.font.jetbrains_mono, FontWeight.Normal)
)

data class HudChatEntry(
    val id: String,
    val role: String,        // "user" | "assistant"
    val content: String,
    val isStreaming: Boolean = false,
)

enum class HudSize { FULL, BOTTOM_HALF, TOP_HALF }

@Composable
fun HudScreen(
    messages: List<HudChatEntry>,
    streamingContent: String,           // current in-progress stream text
    isThinking: Boolean,
    connectionStatus: String,           // "TARS" or conversation title
    hudSize: HudSize = HudSize.FULL,
    menuItems: List<String> = listOf("📷 Photo", "◎ Session", "█ Size", "… More"),
    selectedMenuIndex: Int = -1,         // -1 = message history focus
    fontSize: Int = 13,                  // sp — Compact=11, Normal=13, Comfortable=15, Large=17
) {
    val listState = rememberLazyListState()
    val allEntries = remember(messages, streamingContent, isThinking) {
        val base = messages.toMutableList()
        when {
            streamingContent.isNotEmpty() ->
                base.add(HudChatEntry("streaming", "assistant", streamingContent, isStreaming = true))
            isThinking ->
                base.add(HudChatEntry("thinking", "assistant", "…", isStreaming = true))
        }
        base
    }

    // Auto-scroll to bottom when new content arrives
    LaunchedEffect(allEntries.size, streamingContent.length) {
        if (allEntries.isNotEmpty()) {
            listState.animateScrollToItem(allEntries.size - 1)
        }
    }

    val verticalFraction = when (hudSize) {
        HudSize.FULL -> Pair(0f, 1f)
        HudSize.BOTTOM_HALF -> Pair(0.5f, 1f)
        HudSize.TOP_HALF -> Pair(0f, 0.5f)
    }

    Box(modifier = Modifier.fillMaxSize().background(HudBackground)) {
        // ── Chat area ─────────────────────────────────────────────────────────
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .fillMaxHeight(verticalFraction.second)
                .padding(top = 28.dp, start = 6.dp, end = 6.dp, bottom = 28.dp)
                .align(
                    if (hudSize == HudSize.BOTTOM_HALF) Alignment.BottomCenter
                    else Alignment.TopCenter
                )
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                items(allEntries) { entry ->
                    ChatEntryView(entry, fontSize)
                }
            }
        }

        // ── Status bar (top) ──────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .align(Alignment.TopCenter)
                .background(HudMenuBg)
                .padding(horizontal = 8.dp, vertical = 3.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(
                text = "TARS",
                style = hudTextStyle(10, FontWeight.Bold),
                color = HudGreen,
            )
            Text(
                text = connectionStatus,
                style = hudTextStyle(10),
                color = HudGreenDim,
            )
        }

        // ── Menu bar (bottom) ─────────────────────────────────────────────────
        if (selectedMenuIndex >= 0) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .align(Alignment.BottomCenter)
                    .background(HudMenuBg)
                    .padding(horizontal = 4.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
            ) {
                menuItems.forEachIndexed { i, item ->
                    Text(
                        text = item,
                        style = hudTextStyle(10),
                        color = if (i == selectedMenuIndex) HudGreen else HudGreenDim,
                        modifier = Modifier.padding(horizontal = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatEntryView(entry: HudChatEntry, fontSize: Int) {
    val color = when {
        entry.role == "user" -> HudUserColor
        entry.isStreaming -> HudGreen
        else -> HudGreen
    }
    val prefix = when (entry.role) {
        "user" -> "> "
        else -> ""
    }
    val cursor = if (entry.isStreaming) "█" else ""

    Text(
        text = "$prefix${entry.content}$cursor",
        style = hudTextStyle(fontSize),
        color = color,
        modifier = Modifier.padding(vertical = 1.dp),
    )
}

private fun hudTextStyle(size: Int, weight: FontWeight = FontWeight.Normal) = TextStyle(
    fontFamily = JetBrainsMono,
    fontSize = size.sp,
    fontWeight = weight,
    lineHeight = (size * 1.4).sp,
)
