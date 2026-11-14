package com.thingglance.app.glance

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle

// "Next up": one line. The date that matters most right now (what needs a
// decision first, else the nearest one ahead) with its countdown. A tap opens
// it in the app.
class NextUpWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val data = rememberWidgetData(context)
            GlanceTheme {
                Content(context, data)
            }
        }
    }

    @Composable
    private fun Content(context: Context, data: WidgetData) {
        val event = data.next
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(GlanceTheme.colors.surface)
                .cornerRadius(16.dp)
                .padding(12.dp)
                .clickable(actionStartActivity(openLinkIntent(context, event?.link ?: QUEUE_LINK))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            WidgetTitle(data.labels.nextTitle)
            Spacer(modifier = GlanceModifier.height(6.dp))
            if (event == null) {
                Text(data.labels.nextEmpty, style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp))
            } else {
                Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    CountdownBadge(daysUntil(event.date), data.labels, wide = true)
                    Spacer(modifier = GlanceModifier.width(10.dp))
                    Column(modifier = GlanceModifier.defaultWeight()) {
                        Text(
                            event.title,
                            maxLines = 1,
                            style = TextStyle(color = GlanceTheme.colors.onSurface, fontWeight = FontWeight.Medium, fontSize = 14.sp),
                        )
                        Text(
                            "${event.detail} · ${shortDate(event.date, data.locale)}",
                            maxLines = 1,
                            style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 11.sp),
                        )
                    }
                }
            }
        }
    }
}

class NextUpWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = NextUpWidget()
}
