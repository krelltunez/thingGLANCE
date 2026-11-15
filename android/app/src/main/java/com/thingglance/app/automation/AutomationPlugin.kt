package com.thingglance.app.automation

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.thingglance.app.SharedDataStore
import com.thingglance.app.WidgetBridgePlugin

// The switch for automation apps, kept natively so the receiver can obey it
// with the app not running. Off until the user turns it on.
@CapacitorPlugin(name = "Automation")
class AutomationPlugin : Plugin() {
    @PluginMethod
    fun get(call: PluginCall) {
        call.resolve(JSObject().put("enabled", SharedDataStore.isAutomationEnabled(context)))
    }

    @PluginMethod
    fun set(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) == true
        // Turning it off also forgets anything it had queued.
        SharedDataStore.setAutomationEnabled(context, enabled)
        if (!enabled) WidgetBridgePlugin.refreshAll(context)
        call.resolve(JSObject().put("enabled", enabled))
    }
}
