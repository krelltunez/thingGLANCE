package com.thingglance.app.glance

import android.content.Context
import androidx.glance.GlanceId
import androidx.glance.action.ActionParameters
import androidx.glance.appwidget.action.ActionCallback
import com.thingglance.app.SharedDataStore
import com.thingglance.app.WidgetBridgePlugin

// "Done with this" on a widget row, without opening the app.
//
// A widget cannot run the app, so it does not clear anything itself: it
// queues the write (SharedDataStore) with an id of its own, and the app
// applies it through its one door for writes from outside the next time it
// runs (src/native/widgetBridge.ts: collectWidgetWrites). The row leaves the
// widget at once, because the widget hides dates with a write waiting.
//
// Until the app has run, the rest of the system does not know: the date's
// reminder is still scheduled, and other devices still show it.
class ClearDateAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val key = parameters[EVENT_KEY] ?: return
        SharedDataStore.queueDecide(context, key)
        WidgetBridgePlugin.refreshAll(context)
        WidgetBridgePlugin.announcePendingWrites()
    }

    companion object {
        val EVENT_KEY = ActionParameters.Key<String>("event_key")
    }
}
