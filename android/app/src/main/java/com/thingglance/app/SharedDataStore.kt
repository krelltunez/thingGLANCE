package com.thingglance.app

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

// What passes between the web app and the surfaces that cannot run it.
//
//   - The widget payload: written by the app, read by widgets
//     (src/native/widgetBridge.ts).
//   - Pending writes: made on the home screen while the app is not running,
//     applied by the app the next time it is (docs/links-and-intents.md). Each
//     carries an id minted here, so applying it twice changes nothing. Writes
//     an automation app asked for wait in the same queue (automation/).
//
// A private preferences file, left out of cloud backup
// (res/xml/data_extraction_rules.xml): it carries names and dates, and the
// app rewrites it on first open.
object SharedDataStore {
    private const val PREFS = "thingglance_shared"
    private const val KEY_WIDGETS = "widget_payload"
    private const val KEY_WRITES = "pending_writes"
    const val ACTION_DECIDE = "decide"
    const val ACTION_SEND = "send"
    // A write nobody collects is not kept for ever.
    private const val MAX_PENDING = 50

    // Counts changes. A widget that is already drawn keeps its composition
    // alive for a while, and asking it to update only recomposes it: it would
    // draw what it read when it started. Widgets watch this so a change is
    // read again (glance/WidgetData.kt: rememberWidgetData).
    private val writes = MutableStateFlow(0)
    val changes: StateFlow<Int> get() = writes

    fun writeWidgetPayload(context: Context, json: String) {
        prefs(context).edit().putString(KEY_WIDGETS, json).apply()
        writes.value += 1
    }

    fun readWidgetPayload(context: Context): String? = prefs(context).getString(KEY_WIDGETS, null)

    // ── Pending writes ───────────────────────────────────────────────────────

    // "Done with this" on a widget row or a notification. Queued in the shape
    // the app's one door for outside writes takes: { action, payload, clientId }.
    @Synchronized
    fun queueDecide(context: Context, eventKey: String, id: String = "widget:" + UUID.randomUUID()) {
        queue(context, ACTION_DECIDE, eventKey, id, JSONObject().put("event_key", eventKey).put("state", "done"))
    }

    // "Send to dayGLANCE": the date becomes a task there. The app does the
    // sending (it holds the key and the connection); this only asks.
    @Synchronized
    fun queueSend(context: Context, eventKey: String, id: String = "widget:" + UUID.randomUUID()) {
        // Once it is done with, there is nothing left to send.
        if (pendingKeys(pending(context), ACTION_DECIDE).contains(eventKey)) return
        queue(context, ACTION_SEND, eventKey, id, JSONObject().put("event_key", eventKey))
    }

    private fun queue(context: Context, action: String, eventKey: String, id: String, payload: JSONObject) {
        val queue = pending(context)
        // One tap, one write: a second tap on a row that is already queued
        // (the widget had not redrawn yet) adds nothing.
        if (pendingKeys(queue, action).contains(eventKey)) return
        queue.put(JSONObject().put("action", action).put("clientId", id).put("payload", payload))
        store(context, trimmed(queue))
    }

    // The queue as JSON, left in place: the app removes what it has applied
    // with acknowledge(), so a write survives the app dying half way through.
    @Synchronized
    fun readPendingWrites(context: Context): String = pending(context).toString()

    // Answers what was taken off, so whoever asked for a write can be told
    // how it went (automation/Automation.kt).
    @Synchronized
    fun acknowledge(context: Context, clientIds: Set<String>): List<JSONObject> {
        if (clientIds.isEmpty()) return emptyList()
        val (kept, settled) = split(pending(context)) { !clientIds.contains(it.optString("clientId")) }
        store(context, kept)
        return settled
    }

    // The queue in two: what a test keeps, and what it does not.
    internal fun split(queue: JSONArray, keep: (JSONObject) -> Boolean): Pair<JSONArray, List<JSONObject>> {
        val kept = JSONArray()
        val gone = ArrayList<JSONObject>()
        for (i in 0 until queue.length()) {
            val w = queue.optJSONObject(i) ?: continue
            if (keep(w)) kept.put(w) else gone.add(w)
        }
        return kept to gone
    }

    // ── Automation apps ──────────────────────────────────────────────────────

    private const val KEY_AUTOMATION = "automation_enabled"

    // Off until the user turns it on: the receiver is open to every app on
    // the phone. Kept here so it holds with the app not running.
    fun isAutomationEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_AUTOMATION, false)

    // Turning it off drops what it had queued: nothing asked for while it was
    // on is applied after the user has said no.
    @Synchronized
    fun setAutomationEnabled(context: Context, enabled: Boolean) {
        prefs(context).edit().putBoolean(KEY_AUTOMATION, enabled).commit()
        if (!enabled) store(context, split(pending(context)) { !it.has("reply") }.first)
    }

    // A write an automation app asked for: { action, payload, clientId, reply }.
    // False when one with the same id is already waiting.
    @Synchronized
    fun queueAutomation(context: Context, entry: JSONObject): Boolean {
        val queue = pending(context)
        if (!added(queue, entry)) return false
        store(context, trimmed(queue))
        return true
    }

    internal fun added(queue: JSONArray, entry: JSONObject): Boolean {
        val id = entry.optString("clientId")
        for (i in 0 until queue.length()) if (queue.optJSONObject(i)?.optString("clientId") == id) return false
        queue.put(entry)
        return true
    }

    // The dates with a "done" waiting to be applied: a widget leaves them out
    // straight away, without waiting for the app.
    fun pendingDecideKeys(context: Context): Set<String> = pendingKeys(pending(context), ACTION_DECIDE)

    // The dates with a "send" waiting: a widget shows them as on their way.
    fun pendingSendKeys(context: Context): Set<String> = pendingKeys(pending(context), ACTION_SEND)

    internal fun pendingDecideKeys(queue: JSONArray): Set<String> = pendingKeys(queue, ACTION_DECIDE)

    internal fun pendingKeys(queue: JSONArray, action: String): Set<String> {
        val keys = HashSet<String>()
        for (i in 0 until queue.length()) {
            val w = queue.optJSONObject(i) ?: continue
            if (w.optString("action") != action) continue
            // Putting a date back is not clearing it.
            if (w.optJSONObject("payload")?.optString("state") == "restore") continue
            val key = w.optJSONObject("payload")?.optString("event_key").orEmpty()
            if (key.isNotEmpty()) keys.add(key)
        }
        return keys
    }

    internal fun trimmed(queue: JSONArray): JSONArray {
        if (queue.length() <= MAX_PENDING) return queue
        val kept = JSONArray()
        for (i in queue.length() - MAX_PENDING until queue.length()) kept.put(queue.get(i))
        return kept
    }

    // ── The background refresh's own record ──────────────────────────────────

    private const val KEY_REFRESH_AT = "refresh_last_at"
    private const val KEY_REFRESH_LOG = "refresh_log"
    private const val MAX_LOG = 20

    fun lastRefreshAt(context: Context): Long = prefs(context).getLong(KEY_REFRESH_AT, 0L)

    fun setLastRefreshAt(context: Context, at: Long) {
        prefs(context).edit().putLong(KEY_REFRESH_AT, at).apply()
    }

    // The last few runs, newest last: what triggered each, when, and how it
    // went. Settings shows the latest; the rest is for diagnosing a phone.
    @Synchronized
    fun appendRefreshLog(context: Context, entry: JSONObject) {
        val log = try { JSONArray(prefs(context).getString(KEY_REFRESH_LOG, "[]")) } catch (e: Exception) { JSONArray() }
        log.put(entry)
        val kept = JSONArray()
        for (i in maxOf(0, log.length() - MAX_LOG) until log.length()) kept.put(log.get(i))
        prefs(context).edit().putString(KEY_REFRESH_LOG, kept.toString()).apply()
    }

    fun refreshLog(context: Context): String = prefs(context).getString(KEY_REFRESH_LOG, "[]") ?: "[]"

    private fun pending(context: Context): JSONArray = try {
        JSONArray(prefs(context).getString(KEY_WRITES, "[]"))
    } catch (e: Exception) {
        JSONArray()
    }

    private fun store(context: Context, queue: JSONArray) {
        // commit(): the widget redraws from this straight after.
        prefs(context).edit().putString(KEY_WRITES, queue.toString()).commit()
        writes.value += 1
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
