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
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.itemsIndexed
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
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle

// "Plans, next 30 days": what is about to be charged, and what it adds up to.
// Each row is one charge (a weekly plan appears once per week); a tap opens
// the plan, the title opens Plans. Amounts are written natively, in the
// snapshot's currency and language, by the same rule the app uses.
class ChargesWidget : GlanceAppWidget() {
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
        val openPlans = actionStartActivity(openLinkIntent(context, PLANS_LINK))
        Column(
            modifier = GlanceModifier
                .fillMaxSize()
                .background(GlanceTheme.colors.surface)
                .cornerRadius(16.dp)
                .padding(12.dp),
        ) {
            Row(modifier = GlanceModifier.fillMaxWidth().padding(bottom = 6.dp).clickable(openPlans), verticalAlignment = Alignment.CenterVertically) {
                WidgetTitle(data.labels.chargesTitle, GlanceModifier.defaultWeight())
                if (data.chargesCount > 0) {
                    Text(
                        formatMoney(data.chargesTotal, data.currency, data.locale),
                        maxLines = 1,
                        style = TextStyle(color = GlanceTheme.colors.onSurface, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 13.sp),
                    )
                }
            }
            if (data.charges.isEmpty()) {
                Text(
                    if (data.loaded) data.labels.chargesEmpty else data.labels.nextEmpty,
                    style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 14.sp),
                    modifier = GlanceModifier.clickable(openPlans),
                )
            } else {
                LazyColumn(modifier = GlanceModifier.fillMaxWidth()) {
                    // One plan can charge more than once in the window, so a row
                    // is known by its place, not by its plan.
                    itemsIndexed(data.charges, itemId = { index, _ -> index.toLong() }) { _, charge -> ChargeRow(context, charge, data) }
                }
            }
        }
    }

    @Composable
    private fun ChargeRow(context: Context, charge: WidgetCharge, data: WidgetData) {
        Row(
            modifier = GlanceModifier.fillMaxWidth().padding(vertical = 4.dp).clickable(actionStartActivity(openLinkIntent(context, charge.link))),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                shortDate(charge.date, data.locale),
                maxLines = 1,
                style = TextStyle(color = GlanceTheme.colors.onSurfaceVariant, fontSize = 12.sp),
                modifier = GlanceModifier.width(52.dp),
            )
            Text(
                charge.name,
                maxLines = 1,
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontWeight = FontWeight.Medium, fontSize = 14.sp),
                modifier = GlanceModifier.defaultWeight(),
            )
            Spacer(modifier = GlanceModifier.width(8.dp))
            Text(
                formatMoney(charge.amount, data.currency, data.locale),
                maxLines = 1,
                style = TextStyle(color = GlanceTheme.colors.onSurface, fontFamily = FontFamily.Monospace, fontSize = 13.sp, textAlign = TextAlign.End),
            )
        }
    }
}

class ChargesWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ChargesWidget()
}

internal const val PLANS_LINK = "thingglance://view/plans"
