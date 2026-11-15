package com.thingglance.app.launcher

import org.json.JSONArray
import org.json.JSONObject

// GLANCElauncher's REFRESH: "confirm your data now" (docs/launcher.md). The
// decisions and the log, kept apart from Android so they can be tested.
//
// The launcher shows how each request went, so every one is logged in the
// shape it reads from the sibling apps: { clientId, requestedAt, liveness,
// outcome, reason?, durationMs?, finishedAt?, waitMs?, headless? }.
object LauncherRefresh {
    // A request still waiting after this long is treated as lost, and a new
    // one is no longer folded into it.
    const val INFLIGHT_MS = 60_000L

    // With the app closed, the launcher gets one background run per this
    // long. thingGLANCE's dates move by the day: a run every time the launcher
    // comes to the front would spend battery to learn nothing.
    const val HEADLESS_FLOOR_MS = 10 * 60_000L

    const val MAX_LOG = 20

    const val QUEUED = "queued"
    const val SCHEDULED = "scheduled"
    const val COALESCED = "coalesced"
    const val THROTTLED = "throttled"
    const val UNANSWERED = "unanswered"
    const val DEFERRED = "deferred"
    private val WAITING = setOf(QUEUED, SCHEDULED)

    sealed class Route {
        // Another request is already on its way: this one rides along.
        object Coalesced : Route()
        // The app's page exists: it is asked, and held awake while it answers.
        object Queued : Route()
        // No page: a background run is scheduled.
        object Scheduled : Route()
        // No page, and a background run was made too recently.
        data class Throttled(val sinceMs: Long) : Route()
    }

    fun parse(json: String?): JSONArray = try { JSONArray(json ?: "[]") } catch (e: Exception) { JSONArray() }

    fun find(log: JSONArray, clientId: String): JSONObject? {
        for (i in log.length() - 1 downTo 0) {
            val e = log.optJSONObject(i) ?: continue
            if (e.optString("clientId") == clientId) return e
        }
        return null
    }

    // The launcher re-sends what it has not seen answered; an id met before
    // is not a new request.
    fun seen(log: JSONArray, clientId: String): Boolean = find(log, clientId) != null

    fun route(log: JSONArray, appOpen: Boolean, lastHeadlessAt: Long, now: Long): Route {
        val last = log.optJSONObject(log.length() - 1)
        val inFlight = last != null && last.optString("outcome") in WAITING && !last.has("finishedAt") && now - last.optLong("requestedAt") in 0 until INFLIGHT_MS
        if (inFlight) return Route.Coalesced
        if (appOpen) return Route.Queued
        val since = now - lastHeadlessAt
        // A clock that went backwards must not block refreshes for ever.
        if (lastHeadlessAt > 0 && since in 0 until HEADLESS_FLOOR_MS) return Route.Throttled(since)
        return Route.Scheduled
    }

    fun entry(clientId: String, now: Long, appOpen: Boolean, route: Route): JSONObject {
        val entry = JSONObject().put("clientId", clientId).put("requestedAt", now).put("liveness", if (appOpen) "alive" else "dead")
        when (route) {
            is Route.Coalesced -> entry.put("outcome", COALESCED).put("reason", "a refresh is in flight").put("finishedAt", now)
            is Route.Queued -> entry.put("outcome", QUEUED)
            is Route.Scheduled -> entry.put("outcome", SCHEDULED).put("reason", "the app is not running: background refresh scheduled")
            is Route.Throttled -> entry.put("outcome", THROTTLED).put("finishedAt", now)
                .put("reason", "the app is not running, and a background refresh ran ${(route.sinceMs + 30_000) / 60_000} min ago")
        }
        return entry
    }

    // The log with one more entry, newest last, bounded.
    fun appended(log: JSONArray, entry: JSONObject): JSONArray {
        val out = JSONArray()
        for (i in maxOf(0, log.length() - (MAX_LOG - 1)) until log.length()) out.put(log.get(i))
        return out.put(entry)
    }

    // The log with `patch` merged into the entry for `clientId`, or null when
    // there is none (pruned, or never written).
    fun patched(log: JSONArray, clientId: String, patch: JSONObject): JSONArray? {
        val entry = find(log, clientId) ?: return null
        for (key in patch.keys()) entry.put(key, patch.get(key))
        return log
    }

    // True once the entry has an outcome: anything but waiting, or a finish
    // stamp. A missing entry is nothing to wait for.
    fun answered(entry: JSONObject?): Boolean {
        if (entry == null) return true
        if (entry.has("finishedAt") && !entry.isNull("finishedAt")) return true
        return entry.optString("outcome") !in WAITING
    }

    // What is written when the app was held awake and its page never said how
    // the refresh went. Null once answered.
    fun unanswered(entry: JSONObject, heldFrom: Long, now: Long): JSONObject? {
        if (answered(entry)) return null
        val late = seconds(heldFrom - entry.optLong("requestedAt", heldFrom))
        return JSONObject().put("outcome", UNANSWERED).put("finishedAt", now)
            .put("reason", "the app's page did not answer while it was held awake for ${seconds(now - heldFrom)} s (the hold began $late s after the request)")
    }

    // What a background run made of a request: the page's own report, or the
    // worker's verdict when the page reported nothing.
    fun finished(entry: JSONObject, outcome: String, reason: String?, startedAt: Long, now: Long): JSONObject {
        val patch = JSONObject().put("outcome", outcome).put("finishedAt", now).put("durationMs", (now - startedAt).coerceAtLeast(0)).put("headless", true)
            .put("waitMs", (startedAt - entry.optLong("requestedAt", startedAt)).coerceAtLeast(0))
        if (reason != null) patch.put("reason", reason) else patch.put("reason", JSONObject.NULL)
        return patch
    }

    // ── Closing a page that stopped answering (LauncherPageRetire) ───────────

    // How long the app must have been in the background. A page stalls about
    // a minute after it is left, and anything it was saving has long landed.
    const val RETIRE_MIN_BACKGROUND_MS = 45_000L

    // Only an app in the background (stopped since `stoppedAt`; 0 while it is
    // on screen) for at least that long.
    fun mayRetire(stoppedAt: Long, now: Long): Boolean = stoppedAt > 0 && now - stoppedAt >= RETIRE_MIN_BACKGROUND_MS

    // The page's answer to the check, as evaluateJavascript returns it: only
    // "ok" lets it close.
    fun pageReady(checkResult: String?): Boolean = checkResult == "\"ok\""

    // On the unanswered entry: the page was closed, and a run follows.
    fun retired(entry: JSONObject): JSONObject =
        JSONObject().put("reason", entry.optString("reason") + "; the app closed the unresponsive page, and a background refresh follows").put("pageClosed", true)

    // On the unanswered entry: the page was left open, and why.
    fun kept(entry: JSONObject, why: String): JSONObject =
        JSONObject().put("reason", entry.optString("reason") + "; the page was left open: $why")

    // The run that follows a closed page, logged as the receiver logs one for
    // an app that is not running. The launcher knows the id's ending.
    fun headlessFollowUp(clientId: String, now: Long): JSONObject = JSONObject()
        .put("clientId", "$clientId-headless").put("requestedAt", now).put("liveness", "dead").put("outcome", SCHEDULED)
        .put("reason", "the app's page had stopped answering, so the app closed it: background refresh scheduled")

    private fun seconds(ms: Long): Long = (ms.coerceAtLeast(0) + 500) / 1000
}
