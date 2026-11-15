package com.thingglance.app.reminders

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.thingglance.app.R
import com.thingglance.app.SharedDataStore
import com.thingglance.app.WidgetBridgePlugin
import com.thingglance.app.glance.openLinkIntent
import com.thingglance.app.refresh.RefreshWorker

// The three things that happen around a reminder without the app being open:
// an alarm fires and it is shown; "Done with this" is tapped on it; the phone
// restarts and the alarms have to be set again.
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ReminderScheduler.ACTION_FIRE -> show(context, intent.getStringExtra(ReminderScheduler.EXTRA_ID) ?: return)
            ACTION_DONE -> done(context, intent)
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> ReminderScheduler.rearm(context)
        }
    }

    private fun show(context: Context, id: String) {
        val r = ReminderScheduler.take(context, id) ?: return
        val labels = ReminderScheduler.labels(context)
        ReminderScheduler.ensureChannel(context)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        // A tap opens the date: a thingglance:// link, like every other way in.
        val open = PendingIntent.getActivity(context, r.numericId, openLinkIntent(context, r.link), flags)
        val done = PendingIntent.getBroadcast(
            context, r.numericId,
            Intent(context, ReminderReceiver::class.java).setAction(ACTION_DONE)
                .putExtra(EXTRA_EVENT_KEY, r.eventKey).putExtra(ReminderScheduler.EXTRA_ID, r.id).putExtra(EXTRA_NOTIFICATION, r.numericId),
            flags,
        )
        val notification = NotificationCompat.Builder(context, ReminderScheduler.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xFF0284C7.toInt())
            .setContentTitle(r.title)
            .setContentText(r.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(r.body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setWhen(r.at)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .addAction(0, labels.done, done)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(r.numericId, notification)
        } catch (e: SecurityException) {
            // Notifications are not allowed for the app. Nothing to show.
        }
    }

    // "Done with this" on the notification. It does not open the app: the
    // write is queued for it (as a widget tick is), with the reminder's own id
    // so that it is applied once, and everything else for the date is taken
    // down straight away.
    private fun done(context: Context, intent: Intent) {
        val key = intent.getStringExtra(EXTRA_EVENT_KEY).orEmpty()
        val id = intent.getStringExtra(ReminderScheduler.EXTRA_ID).orEmpty()
        NotificationManagerCompat.from(context).cancel(intent.getIntExtra(EXTRA_NOTIFICATION, 0))
        if (key.isEmpty()) return
        SharedDataStore.queueDecide(context, key, "notification:$id:done")
        ReminderScheduler.cancelForEvent(context, key)
        WidgetBridgePlugin.refreshAll(context)
        WidgetBridgePlugin.announcePendingWrites()
        RefreshWorker.requestSoon(context)
    }

    companion object {
        const val ACTION_DONE = "com.thingglance.app.reminders.DONE"
        const val EXTRA_EVENT_KEY = "event_key"
        const val EXTRA_NOTIFICATION = "notification_id"
    }
}
