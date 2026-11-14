package com.thingglance.app

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.thingglance.app.glance.DecideWidgetReceiver
import com.thingglance.app.glance.NextUpWidgetReceiver

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
        SharedDataStore.acknowledge(context, ids)
        refreshAll(context)
        call.resolve()
    }

    override fun load() {
        live = java.lang.ref.WeakReference(this)
    }

    // Asks the launcher to offer a widget for the home screen (Android 8+; a
    // launcher may not support it). The user still confirms in the launcher.
    @PluginMethod
    fun pinWidget(call: PluginCall) {
        val receiver = RECEIVERS[call.getString("kind")]
        val manager = AppWidgetManager.getInstance(context)
        val supported = receiver != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.isRequestPinAppWidgetSupported
        if (supported) manager.requestPinAppWidget(ComponentName(context, receiver!!), null, null)
        call.resolve(JSObject().put("supported", supported))
    }

    companion object {
        private var live: java.lang.ref.WeakReference<WidgetBridgePlugin>? = null

        // Tells a running app there is something to collect. With no app
        // running there is nobody to tell; it collects on its next start.
        fun announcePendingWrites() {
            live?.get()?.notifyListeners("pendingWrites", JSObject())
        }

        private val RECEIVERS: Map<String, Class<*>> = mapOf(
            "decide" to DecideWidgetReceiver::class.java,
            "next" to NextUpWidgetReceiver::class.java,
        )

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
