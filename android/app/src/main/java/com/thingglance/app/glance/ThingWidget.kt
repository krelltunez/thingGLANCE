package com.thingglance.app.glance

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import kotlin.math.roundToInt

// Which thing a single-thing widget shows, kept in that widget's own state.
// Absent means "automatic": the thing closest to the end of its window.
internal val THING_PREF_KEY = stringPreferencesKey("thing")

// "A single thing": its life-left ring, its name, its verdict and how long
// until its window closes. Chosen when the widget is placed
// (ThingConfigActivity). A tap opens the thing.
class ThingWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val data = rememberWidgetData(context)
            val chosen = currentState<Preferences>()[THING_PREF_KEY]
            GlanceTheme {
                Content(context, data, chosen)
            }
        }
    }

    @Composable
    private fun Content(context: Context, data: WidgetData, chosen: String?) {
        val thing = data.thing(chosen)
        val link = if (thing != null) "thingglance://thing/${thing.id}" else THINGS_LINK
        Row(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(GlanceTheme.colors.surface)
                .cornerRadius(16.dp)
                .padding(12.dp)
                .clickable(actionStartActivity(openLinkIntent(context, link))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (thing == null) {
                // The chosen thing was retired or removed, or there are none yet.
                Text(
                    if (!data.loaded) data.labels.nextEmpty else if (chosen != null) data.labels.thingGone else data.labels.thingNone,
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp),
                )
                return@Row
            }
            Box(modifier = GlanceModifier.size(RING_DP.dp), contentAlignment = Alignment.Center) {
                Image(provider = ImageProvider(ring(context, thing)), contentDescription = null, modifier = GlanceModifier.size(RING_DP.dp))
                thing.remaining?.let {
                    Text(
                        (it * 100).roundToInt().toString(),
                        style = TextStyle(color = GlanceTheme.colors.onSurface, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 13.sp),
                    )
                }
            }
            Spacer(modifier = GlanceModifier.width(10.dp))
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(
                    thing.name,
                    maxLines = 1,
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontWeight = FontWeight.Medium, fontSize = 14.sp),
                )
                val verdict = data.labels.verdicts[thing.verdict] ?: thing.verdict
                val left = thing.lifeEnd?.let { tMinus(daysUntil(it), data.labels) }
                Text(
                    if (left != null) "$verdict · $left" else verdict,
                    maxLines = 1,
                    style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 11.sp),
                )
            }
        }
    }

    // The ring is drawn here, as a picture: a widget has no way to draw an arc.
    // The colour is the verdict's, as in the app.
    private fun ring(context: Context, thing: WidgetThing): Bitmap {
        val density = context.resources.displayMetrics.density
        val size = (RING_DP * density).roundToInt().coerceAtLeast(1)
        val stroke = 5f * density
        val night = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val box = RectF(stroke / 2, stroke / 2, size - stroke / 2, size - stroke / 2)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = stroke
            strokeCap = Paint.Cap.ROUND
        }
        paint.color = if (night) 0x33FFFFFF else 0x1F000000
        canvas.drawArc(box, 0f, 360f, false, paint)
        val share = thing.remaining ?: 0.0
        if (share > 0.0) {
            paint.color = verdictColor(thing.verdict, night)
            canvas.drawArc(box, -90f, (360.0 * share).toFloat().coerceAtLeast(4f), false, paint)
        }
        return bitmap
    }

    companion object {
        private const val RING_DP = 46
    }
}

// The app's own tones for a verdict (src/index.css), light and dark.
internal fun verdictColor(verdict: String, night: Boolean): Int = when (verdict) {
    "prime" -> if (night) 0xFF34D399.toInt() else 0xFF059669.toInt()
    "solid" -> if (night) 0xFF38BDF8.toInt() else 0xFF0284C7.toInt()
    "watch" -> if (night) 0xFFFBBF24.toInt() else 0xFFB45309.toInt()
    "replace", "overdue" -> if (night) 0xFFF87171.toInt() else 0xFFB91C1C.toInt()
    else -> if (night) 0xFF94A3B8.toInt() else 0xFF64748B.toInt()
}

class ThingWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ThingWidget()
}

internal const val THINGS_LINK = "thingglance://view/things"
