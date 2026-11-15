package com.thingglance.app.automation

import android.content.Context
import android.content.Intent
import com.thingglance.app.SharedDataStore
import org.json.JSONObject

// Automation apps (Tasker, MacroDroid, Automate): another app on the phone
// drives thingGLANCE by sending Android broadcasts (docs/tasker.md).
//
// Nothing new is decided here. A broadcast is turned into the same
// { action, payload, clientId } the widgets queue, and goes into the same
// queue (SharedDataStore). The app applies it through its one door for
// outside writes, on screen or in a background refresh, and the answer comes
// back here to be broadcast as a RESULT.
//
// All of it is off until the user turns it on (Settings, Integrations): the
// receiver is open to every app on the phone, and so is the answer.
internal object Automation {
    const val ACTION_QUERY = "app.thingglance.QUERY"
    const val ACTION_OPEN = "app.thingglance.OPEN"
    const val ACTION_RESULT = "app.thingglance.RESULT"

    // The broadcast's action, and what the app's handler calls it
    // (src/intents/handleIntent.ts). Sent on as it arrives, every action
    // would be "unknown" and silently do nothing.
    val WRITES: Map<String, String> = mapOf(
        "app.thingglance.CREATE" to "create_thing",
        "app.thingglance.CREATE_PLAN" to "create_plan",
        "app.thingglance.ADD_COVERAGE" to "add_coverage",
        "app.thingglance.DECIDE" to "decide",
        "app.thingglance.SEND" to "send",
    )

    private const val MAX_ID = 200
    private val PACKAGE = Regex("""[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+""")

    // The payload as an object. It arrives as text in one extra; anything that
    // is not a JSON object is an empty one, which the handler then refuses by
    // name ("name is required"), not a crash here.
    fun payload(raw: String?): JSONObject = try {
        if (raw.isNullOrBlank()) JSONObject() else JSONObject(raw)
    } catch (e: Exception) {
        JSONObject()
    }

    // Where the answer goes: `reply_to`, an app's package name. Left out, the
    // answer is broadcast to whoever is listening.
    fun replyTo(payload: JSONObject): String? =
        payload.optString("reply_to", "").trim().takeIf { it.length <= MAX_ID && PACKAGE.matches(it) }

    // A write, as the queue holds it. Null for an action that is not a write.
    //
    // `client_id` is the sender's own id for it: sent again unchanged, the
    // write is applied once. Without one an id is made here, which still makes
    // the trip from this queue to the app safe to repeat, though not a
    // profile that fires twice.
    fun entry(action: String, rawPayload: String?, mintId: () -> String): JSONObject? {
        val handler = WRITES[action] ?: return null
        val given = payload(rawPayload)
        val id = given.optString("client_id", "").trim().takeIf { it.isNotEmpty() && it.length <= MAX_ID } ?: mintId()
        val reply = JSONObject().put("action", action)
        replyTo(given)?.let { reply.put("to", it) }
        // The two fields that are the transport's own do not travel on.
        given.remove("client_id")
        given.remove("reply_to")
        return JSONObject().put("action", handler).put("clientId", id).put("payload", given).put("reply", reply)
    }

    // QUERY is answered on the spot, from the snapshot the app last wrote for
    // the widgets (docs/snapshot.md): no page has to be running for it.
    // `generatedAt` in it says how old it is.
    fun queryResult(widgetPayload: String?): JSONObject {
        val snapshot = try {
            if (widgetPayload.isNullOrBlank()) null else JSONObject(widgetPayload).optJSONObject("snapshot")
        } catch (e: Exception) {
            null
        }
        return if (snapshot != null) JSONObject().put("success", true).put("snapshot", snapshot)
        else JSONObject().put("success", false).put("code", "unavailable").put("error", "thingGLANCE has not written a snapshot yet. Open it once.")
    }

    // The answers to broadcast for writes the app has finished with: for each
    // queue entry that asked for one, where it goes and what it says. The
    // write's id is added, so a sender that let one be made can still match it.
    data class Reply(val action: String, val to: String?, val result: String)

    fun replies(settled: List<JSONObject>, resultsJson: String?): List<Reply> {
        val results = try {
            if (resultsJson.isNullOrBlank()) JSONObject() else JSONObject(resultsJson)
        } catch (e: Exception) {
            JSONObject()
        }
        val out = ArrayList<Reply>()
        for (write in settled) {
            val reply = write.optJSONObject("reply") ?: continue
            val action = reply.optString("action", "")
            val id = write.optString("clientId", "")
            // No answer for it: say nothing, not a made-up success.
            val result = results.optJSONObject(id) ?: continue
            if (action.isEmpty()) continue
            out.add(Reply(action, reply.optString("to", "").ifEmpty { null }, JSONObject(result.toString()).put("client_id", id).toString()))
        }
        return out
    }

    // ── What touches Android ─────────────────────────────────────────────────

    // Two text extras, as the sibling apps send them: the action that was
    // asked for, exactly as it was sent, and the answer as JSON.
    fun broadcast(context: Context, reply: Reply) {
        if (!SharedDataStore.isAutomationEnabled(context)) return
        val intent = Intent(ACTION_RESULT).putExtra("action", reply.action).putExtra("result", reply.result)
        if (reply.to != null) intent.setPackage(reply.to)
        context.sendBroadcast(intent)
    }

    // Called by both bridges once the app has applied (or refused) writes.
    fun acknowledged(context: Context, settled: List<JSONObject>, resultsJson: String?) {
        for (reply in replies(settled, resultsJson)) broadcast(context, reply)
    }
}
