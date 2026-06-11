package com.tars.glasses.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val TarsGlassesColorScheme = darkColorScheme(
    primary = Color(0xFF00FF41),
    background = Color(0xFF000000),
    surface = Color(0xFF001100),
    onPrimary = Color(0xFF000000),
    onBackground = Color(0xFF00FF41),
    onSurface = Color(0xFF00FF41),
)

@Composable
fun TarsGlassesTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = TarsGlassesColorScheme,
        content = content,
    )
}
