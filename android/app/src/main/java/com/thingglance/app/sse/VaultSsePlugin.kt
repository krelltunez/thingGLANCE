package com.thingglance.app.sse

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject

// The web app's handle on the native event-stream reader (VaultSseClient).
// It says "wanted" or "not wanted" with the connection; every message the
// reader produces comes back as an `sseMessage` event, in the shapes the
// sibling apps' shells use:
//   {type:'open'}                    connected (again)
//   {type:'frame', block:'…'}        one raw event block
//   {type:'closed'}                  dropped; the reader will reconnect
//   {type:'error', message, code?}   with a code it has stopped for good
//
// Registered in MainActivity; the web side is src/native/vaultSse.ts.
@CapacitorPlugin(name = "VaultSse")
class VaultSsePlugin : Plugin() {
    private var client: VaultSseClient? = null

    override fun load() {
        client = VaultSseClient { msg ->
            try {
                notifyListeners("sseMessage", JSObject.fromJSONObject(JSONObject(msg)))
            } catch (_: Exception) {
                // A message that cannot be passed on must not break the bridge.
            }
        }
        // The activity may already be on screen by the time the plugin loads.
        client?.setForeground(true)
    }

    @PluginMethod
    fun start(call: PluginCall) {
        val url = call.getString("vaultUrl")
        val token = call.getString("vaultToken")
        val account = call.getString("accountId")
        if (url.isNullOrEmpty() || token.isNullOrEmpty() || account.isNullOrEmpty()) {
            call.reject("vaultUrl, vaultToken and accountId are required")
            return
        }
        client?.enable(url, token, account)
        call.resolve()
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        client?.disable()
        call.resolve()
    }

    // Connected only while the app is on screen: Android would drop the socket
    // in the background anyway, and the vault's first frame on reconnect says
    // where things stand.
    override fun handleOnStart() {
        client?.setForeground(true)
    }

    override fun handleOnStop() {
        client?.setForeground(false)
    }

    override fun handleOnDestroy() {
        client?.shutdown()
        client = null
    }
}
