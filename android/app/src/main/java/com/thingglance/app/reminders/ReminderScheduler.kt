package com.thingglance.app.reminders

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject

// Keeps Android's alarms equal to the reminder plan.
//
// The web app decides which dates notify, when and on whose device
// (src/core/reminders.ts) and hands the plan over inside the snapshot. This
// makes Android match it: schedule what is new or changed, cancel what is
// gone. It works on a Context alone, so the same code runs whoever brings the
// plan: the app on screen, a background refresh with no screen, or a tick on
// a widget that only needs one date's reminders gone.
//
// Alarms are inexact on purpose. "Your warranty ends in a week" does not need
// to arrive to the second, and exact alarms are a permission Play restricts
// to alarm clocks and calendars.
object ReminderScheduler {
    const val CHANNEL = "dates"
    private const val PREFS = "thingglance_reminders"
    private const val KEY_HELD = "held"
    private const val KEY_LABELS = "labels"

    const val ACTION_FIRE = "com.thingglance.app.reminders.FIRE"
    const val EXTRA_ID = "reminder_id"

    // What Android shows that is not the reminder's own text. From the app's
    // catalog, so in the app's language; kept so a reminder fired while the app
    // is closed still has them.
    data class Labels(val channel: String, val channelDescription: String, val done: String) {
        fun toJson(): JSONObject = JSONObject().put("channel", channel).put("channelDescription", channelDescription).put("done", done)
    }

    private val FALLBACK = Labels("Dates", "Warranties ending, plans renewing, support running out.", "Done with this")

    // Makes Android match `wanted`. Safe to call as often as the snapshot is
    // rebuilt: an unchanged plan touches nothing.
    @Synchronized
    fun apply(context: Context, wanted: List<PlannedReminder>, labels: Labels?) {
        if (labels != null) saveLabels(context, labels)
        ensureChannel(context)
        val now = System.currentTimeMillis()
        val diff = ReminderPlan.diff(wanted, held(context), now)
        for (r in diff.cancel) cancelAlarm(context, r)
        for (r in diff.schedule) setAlarm(context, r)
        save(context, diff.keep + diff.schedule)
    }

    // Everything for one date, now: its pending alarms and any notification
    // already showing. A date cleared from the home screen or from a
    // notification should not remind again while the app catches up.
    @Synchronized
    fun cancelForEvent(context: Context, eventKey: String) {
        val all = held(context)
        val gone = all.filter { it.eventKey == eventKey }
        if (gone.isEmpty()) return
        for (r in gone) {
            cancelAlarm(context, r)
            NotificationManagerCompat.from(context).cancel(r.numericId)
        }
        save(context, all - gone.toSet())
    }

    // After a restart of the phone, or an update of the app, Android has
    // forgotten every alarm. What was held is set again; what came due in the
    // meantime is dropped, not sent late.
    @Synchronized
    fun rearm(context: Context) {
        ensureChannel(context)
        val now = System.currentTimeMillis()
        val still = held(context).filter { it.at > now }
        for (r in still) setAlarm(context, r)
        save(context, still)
    }

    @Synchronized
    fun held(context: Context): List<PlannedReminder> = try {
        ReminderPlan.parse(JSONArray(prefs(context).getString(KEY_HELD, "[]")))
    } catch (e: Exception) {
        emptyList()
    }

    // The reminder an alarm is for, taken off the list as it fires.
    @Synchronized
    fun take(context: Context, id: String): PlannedReminder? {
        val all = held(context)
        val found = all.firstOrNull { it.id == id } ?: return null
        save(context, all - found)
        return found
    }

    fun labels(context: Context): Labels = try {
        val l = JSONObject(prefs(context).getString(KEY_LABELS, "{}") ?: "{}")
        Labels(
            l.optString("channel", "").ifBlank { FALLBACK.channel },
            l.optString("channelDescription", "").ifBlank { FALLBACK.channelDescription },
            l.optString("done", "").ifBlank { FALLBACK.done },
        )
    } catch (e: Exception) {
        FALLBACK
    }

    // Android shows the channel's name in its own settings, so it is given
    // again whenever the labels change (creating one that exists only renames).
    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val l = labels(context)
        val channel = NotificationChannel(CHANNEL, l.channel, NotificationManager.IMPORTANCE_DEFAULT).apply { description = l.channelDescription }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    private fun saveLabels(context: Context, labels: Labels) {
        prefs(context).edit().putString(KEY_LABELS, labels.toJson().toString()).apply()
    }

    private fun save(context: Context, list: List<PlannedReminder>) {
        prefs(context).edit().putString(KEY_HELD, ReminderPlan.toJson(list).toString()).apply()
    }

    private fun fireIntent(context: Context, r: PlannedReminder): PendingIntent =
        PendingIntent.getBroadcast(
            context, r.numericId,
            Intent(context, ReminderReceiver::class.java).setAction(ACTION_FIRE).putExtra(EXTRA_ID, r.id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    private fun setAlarm(context: Context, r: PlannedReminder) {
        val alarms = context.getSystemService(AlarmManager::class.java) ?: return
        // Inexact, and allowed while the phone dozes: it may arrive a minute or
        // two after its time, never hours.
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, fireIntent(context, r))
    }

    private fun cancelAlarm(context: Context, r: PlannedReminder) {
        context.getSystemService(AlarmManager::class.java)?.cancel(fireIntent(context, r))
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
