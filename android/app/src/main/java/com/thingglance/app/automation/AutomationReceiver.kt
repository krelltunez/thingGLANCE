package com.thingglance.app.automation

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.thingglance.app.SharedDataStore
import com.thingglance.app.WidgetBridgePlugin
import com.thingglance.app.refresh.RefreshWorker
import java.util.UUID

// Where an automation app's broadcast lands. Declared in the manifest, so it
// is delivered whether the app is on screen, in the background or not running
// at all.
//
// With the switch off (the default) it does nothing and stores nothing.
class AutomationReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (!SharedDataStore.isAutomationEnabled(context)) return
        val raw = intent.getStringExtra("payload")

        if (action == Automation.ACTION_QUERY) {
            val to = Automation.replyTo(Automation.payload(raw))
            Automation.broadcast(context, Automation.Reply(action, to, Automation.queryResult(SharedDataStore.readWidgetPayload(context)).toString()))
            return
        }

        val entry = Automation.entry(action, raw) { UUID.randomUUID().toString() } ?: return
        // Already waiting under this id: the sender is retrying.
        if (!SharedDataStore.queueAutomation(context, entry)) return
        // A date cleared this way leaves the widgets at once, like a tick.
        WidgetBridgePlugin.refreshAll(context)
        // A running app applies it now. With none running, a background
        // refresh does, and carries it to the vault.
        WidgetBridgePlugin.announcePendingWrites()
        RefreshWorker.requestSoon(context)
    }
}
