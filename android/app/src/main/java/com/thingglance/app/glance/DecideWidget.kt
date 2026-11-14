package com.thingglance.app.glance

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.layout.size
import com.thingglance.app.R
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle

// "Needs a decision": the app's queue on the home screen. Each row is a date
// inside its lead window, with its countdown; a tap opens that date in the
// app, the title opens the queue. It scrolls when there are more than fit.
class DecideWidget : GlanceAppWidget() {
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
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(GlanceTheme.colors.surface)
                .cornerRadius(16.dp)
                .padding(12.dp),
        ) {
            Row(
                modifier = GlanceModifier.fillMaxWidth().padding(bottom = 6.dp).clickable(actionStartActivity(openLinkIntent(context, QUEUE_LINK))),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                WidgetTitle(data.labels.decideTitle, GlanceModifier.defaultWeight())
                if (data.attention.isNotEmpty()) {
                    Text(
                        data.attention.size.toString(),
                        style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp),
                    )
                }
            }
            if (data.attention.isEmpty()) {
                Text(
                    data.labels.decideEmpty,
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp),
                    modifier = GlanceModifier.clickable(actionStartActivity(openLinkIntent(context, QUEUE_LINK))),
                )
            } else {
                LazyColumn(modifier = GlanceModifier.fillMaxWidth()) {
                    items(data.attention, itemId = { it.key.hashCode().toLong() }) { event -> EventRow(context, event, data) }
                }
            }
        }
    }

    @Composable
    private fun EventRow(context: Context, event: WidgetEvent, data: WidgetData) {
        Row(
            modifier = GlanceModifier
                .fillMaxWidth()
                .padding(vertical = 5.dp)
                .clickable(actionStartActivity(openLinkIntent(context, event.link))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CountdownBadge(daysUntil(event.date), data.labels)
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
            // Clears the date without opening the app (ClearDateAction).
            Image(
                provider = ImageProvider(R.drawable.ic_widget_check),
                contentDescription = data.labels.done,
                colorFilter = ColorFilter.tint(GlanceTheme.colors.onSurfaceVariant),
                modifier = GlanceModifier
                    .size(36.dp)
                    .padding(8.dp)
                    .clickable(actionRunCallback<ClearDateAction>(actionParametersOf(ClearDateAction.EVENT_KEY to event.key))),
            )
        }
    }
}

class DecideWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DecideWidget()
}
