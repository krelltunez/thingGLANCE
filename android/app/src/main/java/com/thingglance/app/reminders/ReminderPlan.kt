package com.thingglance.app.reminders

import org.json.JSONArray
import org.json.JSONObject

// A reminder as the web app planned it (src/core/reminders.ts), in the form
// the snapshot carries. Which dates notify, when, and on whose device is
// decided there; nothing here decides anything.
data class PlannedReminder(
    // Stable across runs: the event's key plus the stage.
    val id: String,
    val eventKey: String,
    // When it fires, epoch milliseconds.
    val at: Long,
    val title: String,
    val body: String,
    // What a tap opens: a thingglance:// link.
    val link: String,
) {
    // Android's ids are ints. The same value as reminderNumericId() on the web
    // side, which is Java's own string hash made positive.
    val numericId: Int get() = (id.hashCode() and 0x7fffffff).let { if (it == 0) 1 else it }

    // Everything a scheduled notification shows or acts on. One whose
    // signature changed is out of date.
    val signature: String get() = "$id|$at|$title|$body|$link"

    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("eventKey", eventKey).put("at", at)
        .put("title", title).put("body", body).put("link", link)
}

object ReminderPlan {
    // The reminders in a snapshot's `reminders` array. A row that cannot be
    // scheduled (no id, no time) is left out, never guessed at.
    fun parse(array: JSONArray?): List<PlannedReminder> {
        if (array == null) return emptyList()
        val out = ArrayList<PlannedReminder>(array.length())
        for (i in 0 until array.length()) {
            val r = array.optJSONObject(i) ?: continue
            val id = r.optString("id", "")
            val at = r.optLong("at", 0L)
            if (id.isEmpty() || at <= 0L) continue
            out.add(
                PlannedReminder(
                    id = id,
                    eventKey = r.optString("eventKey", ""),
                    at = at,
                    title = r.optString("title", ""),
                    body = r.optString("body", ""),
                    link = r.optString("link", "").ifBlank { "thingglance://queue" },
                ),
            )
        }
        return out
    }

    fun toJson(list: List<PlannedReminder>): JSONArray = JSONArray().also { a -> list.forEach { a.put(it.toJson()) } }

    data class Diff(val schedule: List<PlannedReminder>, val cancel: List<PlannedReminder>, val keep: List<PlannedReminder>)

    // What has to change so that what Android holds is exactly what is wanted:
    // the mirror of diffReminders() in src/core/reminders.ts. A reminder whose
    // moment has passed is not wanted: nothing is sent late.
    fun diff(wanted: List<PlannedReminder>, held: List<PlannedReminder>, now: Long): Diff {
        val want = LinkedHashMap<Int, PlannedReminder>()
        // Two reminders landing on one Android id is about a one-in-a-million
        // chance; the sooner one keeps it.
        for (r in wanted.filter { it.at > now }.sortedBy { it.at }) want.putIfAbsent(r.numericId, r)
        val have = held.associateBy { it.numericId }
        val schedule = want.values.filter { have[it.numericId]?.signature != it.signature }
        val keep = want.values.filter { have[it.numericId]?.signature == it.signature }
        val cancel = held.filter { !want.containsKey(it.numericId) }
        return Diff(schedule, cancel, keep)
    }
}
