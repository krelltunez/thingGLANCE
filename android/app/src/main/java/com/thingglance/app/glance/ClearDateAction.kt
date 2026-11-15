package com.thingglance.app.glance

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.thingglance.app.SharedDataStore
import com.thingglance.app.WidgetBridgePlugin
import com.thingglance.app.refresh.RefreshWorker
import com.thingglance.app.reminders.ReminderScheduler

// The buttons on a widget row, which act without opening the app.
//
// A widget cannot run the app, so it changes nothing itself: it queues the
// write (SharedDataStore) with an id of its own, and the app applies it
// through its one door for writes from outside, when it next runs or in a
// background refresh (src/native/widgetBridge.ts: collectWidgetWrites).
//
// The widget shows the result at once all the same: a date with a "done"
// waiting is left out, and one with a "send" waiting reads as sent. Either
// way the date's reminders on this phone are cancelled: it has been dealt
// with, or handed to dayGLANCE, which reminds in its own way.
private fun act(context: Context, queue: () -> Unit, eventKey: String) {
    queue()
    ReminderScheduler.cancelForEvent(context, eventKey)
    WidgetBridgePlugin.refreshAll(context)
    WidgetBridgePlugin.announcePendingWrites()
    // With the app closed there is nobody to announce it to: a background
    // refresh carries it to the vault.
    RefreshWorker.requestSoon(context)
}

internal val EVENT_KEY = ActionParameters.Key<String>("event_key")

// "Done with this".
class ClearDateAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val key = parameters[EVENT_KEY] ?: return
        act(context, { SharedDataStore.queueDecide(context, key) }, key)
    }
}

// "Send to dayGLANCE".
class SendDateAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val key = parameters[EVENT_KEY] ?: return
        act(context, { SharedDataStore.queueSend(context, key) }, key)
    }
}
