package com.thingglance.app

import android.app.ActivityOptions
import android.app.PendingIntent
import android.app.StatusBarManager
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.thingglance.app.automation.Automation
import com.thingglance.app.glance.DecideWidgetReceiver
import com.thingglance.app.glance.NextUpWidgetReceiver
import com.thingglance.app.glance.ThingConfigActivity
import com.thingglance.app.glance.WidgetSnapshot
import com.thingglance.app.launcher.LauncherProvider
import com.thingglance.app.tiles.TILES
import com.thingglance.app.tiles.tileLabel
import com.thingglance.app.reminders.ReminderPlan
import com.thingglance.app.reminders.ReminderScheduler

// Takes the widget payload from the web app, keeps it, and redraws the
// widgets. Registered in MainActivity; the web side is
// src/native/widgetBridge.ts.
@CapacitorPlugin(name = "WidgetBridge")
class WidgetBridgePlugin : Plugin() {

    @PluginMethod
    fun updateSnapshot(call: PluginCall) {
        val json = call.getString("json")
        if (json == null) {
            call.reject("missing json")
            return
        }
        SharedDataStore.writeWidgetPayload(context, json)
        refreshAll(context)
        applyReminders(context, json)
        call.resolve()
    }

    // Writes made on the home screen that the app has not applied yet, as a
    // JSON array of { action, payload, clientId }. They stay queued until
    // acknowledged.
    @PluginMethod
    fun pendingWrites(call: PluginCall) {
        call.resolve(JSObject().put("writes", SharedDataStore.readPendingWrites(context)))
    }

    // The app has applied these (or been told they cannot be): drop them.
    @PluginMethod
    fun acknowledgeWrites(call: PluginCall) {
        val ids = HashSet<String>()
        val given = call.getArray("clientIds")
        if (given != null) for (i in 0 until given.length()) ids.add(given.optString(i))
        // `results` says how each went, as JSON by id: whoever asked for a
        // write from outside is told (automation/).
        Automation.acknowledged(context, SharedDataStore.acknowledge(context, ids), call.getString("results"))
        refreshAll(context)
        call.resolve()
    }

    override fun load() {
        live = java.lang.ref.WeakReference(this)
    }

    // The app looked and nothing had changed. GLANCElauncher measures how
    // fresh its page is from this (docs/launcher.md).
    @PluginMethod
    fun heartbeat(call: PluginCall) {
        SharedDataStore.touchLauncherHeartbeat(context, call.getString("syncedAt"))
        LauncherProvider.changed(context)
        call.resolve()
    }

    // How a refresh GLANCElauncher asked this page for went:
    // { clientId, outcome, reason?, durationMs }.
    @PluginMethod
    fun recordLauncherRefresh(call: PluginCall) {
        val clientId = call.getString("clientId")
        if (!clientId.isNullOrEmpty()) {
            val patch = org.json.JSONObject().put("outcome", call.getString("outcome") ?: "ran").put("finishedAt", System.currentTimeMillis())
                .put("reason", call.getString("reason") ?: org.json.JSONObject.NULL)
            call.getInt("durationMs")?.let { patch.put("durationMs", it) }
            if (SharedDataStore.patchLauncherRefresh(context, clientId, patch)) LauncherProvider.changed(context)
        }
        call.resolve()
    }

    // The last few background refreshes, newest last, as JSON.
    @PluginMethod
    fun refreshLog(call: PluginCall) {
        call.resolve(JSObject().put("log", SharedDataStore.refreshLog(context)))
    }

    // Asks the launcher to offer a widget for the home screen (Android 8+; a
    // launcher may not support it). The user still confirms in the launcher.
    @PluginMethod
    fun pinWidget(call: PluginCall) {
        val receiver = RECEIVERS[call.getString("kind")]
        val manager = AppWidgetManager.getInstance(context)
        val supported = receiver != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.isRequestPinAppWidgetSupported
        // A launcher asks which thing only for a widget dragged from its own
        // list, not for one placed from here. So for that widget the picker is
        // opened once it is on the home screen.
        val then = if (call.getString("kind") == "thing") thingPicker() else null
        if (supported) manager.requestPinAppWidget(ComponentName(context, receiver!!), null, then)
        call.resolve(JSObject().put("supported", supported))
    }

    // Asks Android to offer one of the Quick Settings tiles (Android 13+).
    // Android shows its own dialog; the answer is what the user chose, or
    // that the tile was there already. Before 13 there is no asking: a tile
    // is dragged in by hand from the panel's editor.
    @PluginMethod
    fun addTile(call: PluginCall) {
        val kind = call.getString("kind") ?: ""
        val spec = TILES[kind]
        if (spec == null || Build.VERSION.SDK_INT < 33) {
            call.resolve(JSObject().put("supported", false))
            return
        }
        val manager = context.getSystemService(StatusBarManager::class.java)
        if (manager == null) {
            call.resolve(JSObject().put("supported", false))
            return
        }
        val label = tileLabel(kind, WidgetSnapshot.read(context).labels)
        manager.requestAddTileService(ComponentName(context, spec.service), label, Icon.createWithResource(context, spec.icon), context.mainExecutor) { result ->
            val outcome = when (result) {
                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED -> "added"
                StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED -> "already"
                else -> "dismissed"
            }
            call.resolve(JSObject().put("supported", true).put("result", outcome))
        }
    }

    // Sent by Android when the widget has been placed, with the new widget's
    // id filled in (hence mutable). The app is not on screen by then, so the
    // intent says it may open an activity all the same.
    private fun thingPicker(): PendingIntent {
        val intent = Intent(context, ThingConfigActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val options = if (Build.VERSION.SDK_INT >= 35) {
            @Suppress("DEPRECATION")
            val mode = if (Build.VERSION.SDK_INT >= 36) ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOW_ALWAYS else ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED
            ActivityOptions.makeBasic().setPendingIntentCreatorBackgroundActivityStartMode(mode).toBundle()
        } else null
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        return PendingIntent.getActivity(context, 0, intent, flags, options)
    }

    companion object {
        private var live: java.lang.ref.WeakReference<WidgetBridgePlugin>? = null

        // The routine refresh came due while the app is alive but not on
        // screen: the app does the work itself, in its own page. Answers false
        // when there is no page to ask.
        fun askLiveAppToRefresh(): Boolean {
            val plugin = live?.get() ?: return false
            plugin.notifyListeners("refreshRequested", JSObject())
            return true
        }

        // GLANCElauncher asked for a refresh and the app's page exists: the
        // page does it, and reports through recordLauncherRefresh. Answers
        // false when there is no page to ask.
        fun askLiveAppForLauncherRefresh(clientId: String): Boolean {
            val plugin = live?.get() ?: return false
            plugin.notifyListeners("launcherRefresh", JSObject().put("clientId", clientId))
            return true
        }

        // Tells a running app there is something to collect. With no app
        // running there is nobody to tell; it collects on its next start.
        fun announcePendingWrites() {
            live?.get()?.notifyListeners("pendingWrites", JSObject())
        }

        private val RECEIVERS: Map<String, Class<*>> = mapOf(
            "decide" to DecideWidgetReceiver::class.java,
            "next" to NextUpWidgetReceiver::class.java,
            "thing" to com.thingglance.app.glance.ThingWidgetReceiver::class.java,
            "charges" to com.thingglance.app.glance.ChargesWidgetReceiver::class.java,
            "add" to com.thingglance.app.glance.AddThingWidgetReceiver::class.java,
        )

        // The snapshot carries the reminder plan as well as what widgets
        // show: Android's alarms are made to match it (ReminderScheduler).
        // The same call serves the app on screen and a background refresh.
        fun applyReminders(context: Context, payloadJson: String) {
            try {
                val root = org.json.JSONObject(payloadJson)
                val labels = root.optJSONObject("labels")
                ReminderScheduler.apply(
                    context,
                    ReminderPlan.parse(root.getJSONObject("snapshot").optJSONArray("reminders")),
                    labels?.let {
                        ReminderScheduler.Labels(
                            it.optString("channel", ""), it.optString("channelDescription", ""), it.optString("done", ""),
                            // Only when the app says it can send.
                            if (root.optBoolean("canSend", false)) it.optString("send", "") else "",
                        )
                            .takeIf { l -> l.channel.isNotBlank() && l.done.isNotBlank() }
                    },
                )
            } catch (e: Exception) {
                // An unreadable payload leaves what is scheduled as it was.
            }
        }

        // Redraws every placed widget from what is stored.
        fun refreshAll(context: Context) {
            for (receiver in RECEIVERS.values) {
                val ids = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, receiver))
                if (ids == null || ids.isEmpty()) continue
                context.sendBroadcast(
                    Intent(context, receiver)
                        .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids),
                )
            }
        }
    }
}
