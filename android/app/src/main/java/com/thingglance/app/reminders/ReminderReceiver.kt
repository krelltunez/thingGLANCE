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
            ACTION_DONE -> act(context, intent, send = false)
            ACTION_SEND -> act(context, intent, send = true)
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
        val button = { action: String ->
            PendingIntent.getBroadcast(
                context, r.numericId,
                Intent(context, ReminderReceiver::class.java).setAction(action)
                    .putExtra(EXTRA_EVENT_KEY, r.eventKey).putExtra(ReminderScheduler.EXTRA_ID, r.id).putExtra(EXTRA_NOTIFICATION, r.numericId),
                flags,
            )
        }
        val builder = NotificationCompat.Builder(context, ReminderScheduler.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setColor(0xFF0284C7.toInt())
            .setContentTitle(r.title)
            .setContentText(r.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(r.body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .setWhen(r.at)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .addAction(0, labels.done, button(ACTION_DONE))
        // Offered only when the app is connected to dayGLANCE.
        if (labels.send.isNotBlank()) builder.addAction(0, labels.send, button(ACTION_SEND))
        try {
            NotificationManagerCompat.from(context).notify(r.numericId, builder.build())
        } catch (e: SecurityException) {
            // Notifications are not allowed for the app. Nothing to show.
        }
    }

    // A button on the notification: "Done with this", or "Send to dayGLANCE".
    // Neither opens the app. The write is queued for it (as a widget's is),
    // with the reminder's own id so that it is applied once, and everything
    // else for the date is taken down straight away: it is dealt with, or it
    // is dayGLANCE's to remind about now.
    private fun act(context: Context, intent: Intent, send: Boolean) {
        val key = intent.getStringExtra(EXTRA_EVENT_KEY).orEmpty()
        val id = intent.getStringExtra(ReminderScheduler.EXTRA_ID).orEmpty()
        NotificationManagerCompat.from(context).cancel(intent.getIntExtra(EXTRA_NOTIFICATION, 0))
        if (key.isEmpty()) return
        if (send) SharedDataStore.queueSend(context, key, "notification:$id:send")
        else SharedDataStore.queueDecide(context, key, "notification:$id:done")
        ReminderScheduler.cancelForEvent(context, key)
        WidgetBridgePlugin.refreshAll(context)
        WidgetBridgePlugin.announcePendingWrites()
        RefreshWorker.requestSoon(context)
    }

    companion object {
        const val ACTION_DONE = "com.thingglance.app.reminders.DONE"
        const val ACTION_SEND = "com.thingglance.app.reminders.SEND"
        const val EXTRA_EVENT_KEY = "event_key"
        const val EXTRA_NOTIFICATION = "notification_id"
    }
}
