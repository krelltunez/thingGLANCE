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
//     carries an id minted here, so applying it twice changes nothing.
//
// A private preferences file, left out of cloud backup
// (res/xml/data_extraction_rules.xml): it carries names and dates, and the
// app rewrites it on first open.
object SharedDataStore {
    private const val PREFS = "thingglance_shared"
    private const val KEY_WIDGETS = "widget_payload"
    private const val KEY_WRITES = "pending_writes"
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

    // "Done with this" on a widget row. Queued in the shape the app's one door
    // for outside writes takes: { action, payload, clientId }.
    @Synchronized
    fun queueDecide(context: Context, eventKey: String, id: String = "widget:" + UUID.randomUUID()) {
        val queue = pending(context)
        // One tap, one write: a second tap on a row that is already queued
        // (the widget had not redrawn yet) adds nothing.
        if (pendingDecideKeys(queue).contains(eventKey)) return
        queue.put(
            JSONObject()
                .put("action", "decide")
                .put("clientId", id)
                .put("payload", JSONObject().put("event_key", eventKey).put("state", "done")),
        )
        store(context, trimmed(queue))
    }

    // The queue as JSON, left in place: the app removes what it has applied
    // with acknowledge(), so a write survives the app dying half way through.
    @Synchronized
    fun readPendingWrites(context: Context): String = pending(context).toString()

    @Synchronized
    fun acknowledge(context: Context, clientIds: Set<String>) {
        if (clientIds.isEmpty()) return
        val kept = JSONArray()
        val queue = pending(context)
        for (i in 0 until queue.length()) {
            val w = queue.optJSONObject(i) ?: continue
            if (!clientIds.contains(w.optString("clientId"))) kept.put(w)
        }
        store(context, kept)
    }

    // The dates with a "done" waiting to be applied: a widget leaves them out
    // straight away, without waiting for the app.
    fun pendingDecideKeys(context: Context): Set<String> = pendingDecideKeys(pending(context))

    internal fun pendingDecideKeys(queue: JSONArray): Set<String> {
        val keys = HashSet<String>()
        for (i in 0 until queue.length()) {
            val w = queue.optJSONObject(i) ?: continue
            if (w.optString("action") != "decide") continue
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
