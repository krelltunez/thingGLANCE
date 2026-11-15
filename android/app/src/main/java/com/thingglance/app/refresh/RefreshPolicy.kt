package com.thingglance.app.refresh

import org.json.JSONObject

// The decisions around a background refresh, kept apart from Android so they
// can be tested: whether a run should happen, how long it may take, and what
// to record when the page never said how it went.
object RefreshPolicy {
    // The whole run: boot the page, sync, apply, hand over.
    const val CAP_MS = 120_000L
    // A page that has not called the bridge by now is not running the
    // headless root (a broken bundle): give up early.
    const val BOOT_MS = 20_000L
    // A run asked for by something done on the home screen (a tick, "Done" on
    // a notification) is not repeated more often than this. Several ticks in a
    // row are one run's work.
    const val ON_DEMAND_FLOOR_MS = 60_000L
    // The routine run, a few times a day. WorkManager treats it as a hint.
    const val PERIOD_HOURS = 6L

    sealed class Decision {
        // The app is on screen: it does all of this itself.
        object AppIsOpen : Decision()
        data class Throttled(val sinceLastMs: Long) : Decision()
        object Run : Decision()
    }

    fun decide(appOpen: Boolean, onDemand: Boolean, lastRunAt: Long, now: Long): Decision {
        if (appOpen) return Decision.AppIsOpen
        val since = now - lastRunAt
        // A clock that went backwards must not block refreshes for ever.
        if (onDemand && lastRunAt > 0 && since in 0 until ON_DEMAND_FLOOR_MS) return Decision.Throttled(since)
        return Decision.Run
    }

    // What to record for a run whose page reported nothing.
    fun unreported(aborted: Boolean, timedOut: Boolean, rendererGone: Boolean, started: Boolean): Pair<String, String> = when {
        aborted -> "aborted" to "app opened"
        rendererGone -> "failed" to "the page's process ended"
        !started -> "failed" to "the page did not start the refresh"
        timedOut -> "failed" to "took longer than ${CAP_MS / 1000} s"
        else -> "failed" to "no outcome reported"
    }

    // One line of the log from the page's own report
    // ({outcome, reason?, synced, applied, durationMs}).
    fun entry(trigger: String, startedAt: Long, finishedAt: Long, report: String?, fallback: Pair<String, String>?): JSONObject {
        val entry = JSONObject().put("trigger", trigger).put("startedAt", startedAt).put("finishedAt", finishedAt)
        val parsed = try { if (report != null) JSONObject(report) else null } catch (e: Exception) { null }
        if (parsed != null && parsed.optString("outcome").isNotEmpty()) {
            entry.put("outcome", parsed.optString("outcome"))
            if (parsed.has("reason")) entry.put("reason", parsed.optString("reason"))
            entry.put("synced", parsed.optJSONArray("synced") ?: org.json.JSONArray())
            entry.put("applied", parsed.optInt("applied", 0))
        } else {
            val (outcome, reason) = fallback ?: ("failed" to "unreadable report")
            entry.put("outcome", outcome).put("reason", reason)
        }
        return entry
    }
}
