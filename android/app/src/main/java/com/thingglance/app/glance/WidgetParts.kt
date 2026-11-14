package com.thingglance.app.glance

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider as UnitColorProvider

// The app's own tones (src/index.css), light and dark, for the countdown
// badge. Everything else takes the system's widget colours.
private fun tone(day: Long, night: Long) = ColorProvider(day = Color(day), night = Color(night))

private val ACCENT = tone(0xFF0284C7, 0xFF38BDF8)
private val WARN = tone(0xFFB45309, 0xFFFBBF24)
private val BAD = tone(0xFFB91C1C, 0xFFF87171)
private val ACCENT_SOFT = tone(0x1F0284C7, 0x2638BDF8)
private val WARN_SOFT = tone(0x1FB45309, 0x26FBBF24)
private val BAD_SOFT = tone(0x1FB91C1C, 0x26F87171)

internal fun urgencyColor(u: Urgency): UnitColorProvider = when (u) {
    Urgency.PAST -> BAD
    Urgency.URGENT -> WARN
    else -> ACCENT
}

private fun urgencySoft(u: Urgency): UnitColorProvider = when (u) {
    Urgency.PAST -> BAD_SOFT
    Urgency.URGENT -> WARN_SOFT
    else -> ACCENT_SOFT
}

// "T-12d": the app's countdown, in its monospace, tinted by how close it is.
@Composable
internal fun CountdownBadge(days: Int, labels: WidgetLabels, wide: Boolean = false) {
    val u = urgency(days)
    Box(
        modifier = GlanceModifier
            .width(if (wide) 64.dp else 56.dp)
            .background(urgencySoft(u))
            .cornerRadius(8.dp)
            .padding(vertical = 4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            tMinus(days, labels),
            maxLines = 1,
            style = TextStyle(
                color = urgencyColor(u),
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Bold,
                fontSize = if (wide) 14.sp else 12.sp,
                textAlign = TextAlign.Center,
            ),
        )
    }
}

@Composable
internal fun WidgetTitle(text: String, modifier: GlanceModifier = GlanceModifier) {
    Text(
        text,
        maxLines = 1,
        style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontWeight = FontWeight.Bold, fontSize = 12.sp),
        modifier = modifier,
    )
}
