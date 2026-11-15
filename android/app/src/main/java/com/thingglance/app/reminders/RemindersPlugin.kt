package com.thingglance.app.reminders

import android.Manifest
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

// The two things about reminders that need the app on screen: Android's
// permission prompt, and (for checks and diagnostics) a look at what is
// scheduled. Scheduling itself needs neither and is not here: it happens
// wherever the plan arrives (ReminderScheduler).
@CapacitorPlugin(
    name = "Reminders",
    permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")],
)
class RemindersPlugin : Plugin() {

    // 'granted', 'denied' or 'prompt'. Before Android 13 there is no prompt:
    // it is whatever the system's own switch for the app says.
    @PluginMethod
    fun permission(call: PluginCall) {
        call.resolve(JSObject().put("state", state()))
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || state() == "granted") {
            call.resolve(JSObject().put("state", state()))
            return
        }
        requestPermissionForAlias("notifications", call, "permissionAnswered")
    }

    @PermissionCallback
    private fun permissionAnswered(call: PluginCall) {
        call.resolve(JSObject().put("state", state()))
    }

    // What Android has been asked to deliver, as the plan it came from.
    @PluginMethod
    fun pending(call: PluginCall) {
        call.resolve(JSObject().put("reminders", ReminderPlan.toJson(ReminderScheduler.held(context)).toString()))
    }

    private fun state(): String {
        if (NotificationManagerCompat.from(context).areNotificationsEnabled()) return "granted"
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return "denied"
        return when (getPermissionState("notifications")) {
            PermissionState.DENIED -> "denied"
            else -> "prompt"
        }
    }
}
