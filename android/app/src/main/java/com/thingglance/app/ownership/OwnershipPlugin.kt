package com.thingglance.app.ownership

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

// Tells the web app whether this copy was bought, so it can keep the record
// in the vault too (src/native/ownership.ts). App only: a background refresh
// has no use for it, and it is not on the headless allowlist.
@CapacitorPlugin(name = "Ownership")
class OwnershipPlugin : Plugin() {

    // { since, store, version } when the Play Store installed the app, or {}.
    @PluginMethod
    fun get(call: PluginCall) {
        val fact = Ownership.ensure(context)
        val answer = JSObject()
        if (fact != null) answer.put("since", fact.since).put("store", fact.store).put("version", fact.version)
        call.resolve(answer)
    }
}
