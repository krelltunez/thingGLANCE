package com.thingglance.app.launcher

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LauncherRefreshTest {
    private val now = 1_763_222_400_000L
    private fun log(vararg entries: JSONObject) = JSONArray().apply { entries.forEach { put(it) } }
    private fun waiting(id: String, outcome: String, agoMs: Long) = JSONObject().put("clientId", id).put("requestedAt", now - agoMs).put("outcome", outcome)

    @Test fun `a live app is asked, a closed one gets a background run`() {
        assertEquals(LauncherRefresh.Route.Queued, LauncherRefresh.route(log(), appOpen = true, lastHeadlessAt = 0, now = now))
        assertEquals(LauncherRefresh.Route.Scheduled, LauncherRefresh.route(log(), appOpen = false, lastHeadlessAt = 0, now = now))
    }

    @Test fun `a closed app runs for the launcher at most every ten minutes`() {
        assertEquals(LauncherRefresh.Route.Throttled(9 * 60_000L), LauncherRefresh.route(log(), false, now - 9 * 60_000L, now))
        assertEquals(LauncherRefresh.Route.Scheduled, LauncherRefresh.route(log(), false, now - 10 * 60_000L, now))
        // The floor is about background runs: a live app is always asked.
        assertEquals(LauncherRefresh.Route.Queued, LauncherRefresh.route(log(), true, now - 1_000L, now))
        // A clock that went backwards does not block refreshes for ever.
        assertEquals(LauncherRefresh.Route.Scheduled, LauncherRefresh.route(log(), false, now + 60_000L, now))
    }

    @Test fun `a second request rides along with one still on its way`() {
        assertEquals(LauncherRefresh.Route.Coalesced, LauncherRefresh.route(log(waiting("r1", "queued", 5_000)), true, 0, now))
        assertEquals(LauncherRefresh.Route.Coalesced, LauncherRefresh.route(log(waiting("r1", "scheduled", 30_000)), false, 0, now))
        // Lost, not in flight: a new request starts again.
        assertEquals(LauncherRefresh.Route.Queued, LauncherRefresh.route(log(waiting("r1", "queued", 61_000)), true, 0, now))
        // Answered: nothing to ride along with.
        assertEquals(LauncherRefresh.Route.Queued, LauncherRefresh.route(log(waiting("r1", "queued", 5_000).put("finishedAt", now - 1_000)), true, 0, now))
    }

    @Test fun `each route is logged in the launcher's words`() {
        val queued = LauncherRefresh.entry("r1", now, true, LauncherRefresh.Route.Queued)
        assertEquals("queued", queued.getString("outcome"))
        assertEquals("alive", queued.getString("liveness"))
        assertFalse(queued.has("finishedAt"))
        val scheduled = LauncherRefresh.entry("r2", now, false, LauncherRefresh.Route.Scheduled)
        assertEquals("scheduled", scheduled.getString("outcome"))
        assertEquals("dead", scheduled.getString("liveness"))
        val throttled = LauncherRefresh.entry("r3", now, false, LauncherRefresh.Route.Throttled(4 * 60_000L))
        assertEquals("throttled", throttled.getString("outcome"))
        assertTrue(throttled.getString("reason").contains("4 min ago"))
        assertTrue(throttled.has("finishedAt"))
        assertEquals("coalesced", LauncherRefresh.entry("r4", now, true, LauncherRefresh.Route.Coalesced).getString("outcome"))
    }

    @Test fun `the log keeps the newest twenty, and an id is met once`() {
        var l = JSONArray()
        for (i in 1..25) l = LauncherRefresh.appended(l, JSONObject().put("clientId", "r$i"))
        assertEquals(LauncherRefresh.MAX_LOG, l.length())
        assertEquals("r6", l.getJSONObject(0).getString("clientId"))
        assertTrue(LauncherRefresh.seen(l, "r25"))
        assertFalse(LauncherRefresh.seen(l, "r1"))
        assertNull(LauncherRefresh.patched(l, "r1", JSONObject().put("outcome", "ran")))
        assertEquals("ran", LauncherRefresh.find(LauncherRefresh.patched(l, "r25", JSONObject().put("outcome", "ran"))!!, "r25")!!.getString("outcome"))
    }

    @Test fun `a page that never answers is recorded as unanswered, once`() {
        val entry = waiting("r1", "queued", 62_000)
        assertFalse(LauncherRefresh.answered(entry))
        val patch = LauncherRefresh.unanswered(entry, heldFrom = now - 60_000, now = now)
        assertNotNull(patch)
        assertEquals("unanswered", patch!!.getString("outcome"))
        assertTrue(patch.getString("reason").contains("held awake for 60 s"))
        assertTrue(patch.getString("reason").contains("began 2 s after"))
        // Answered in the meantime: left alone.
        assertNull(LauncherRefresh.unanswered(entry.put("outcome", "ran"), now - 60_000, now))
        assertTrue(LauncherRefresh.answered(null))
    }

    @Test fun `a background run's outcome says how long Android held it and how long it took`() {
        val entry = waiting("r1", "scheduled", 12_000)
        val patch = LauncherRefresh.finished(entry, "ran", null, startedAt = now - 9_000, now = now)
        assertEquals("ran", patch.getString("outcome"))
        assertEquals(9_000, patch.getLong("durationMs"))
        assertEquals(3_000, patch.getLong("waitMs"))
        assertTrue(patch.getBoolean("headless"))
        assertTrue(patch.isNull("reason"))
        assertEquals("vault: offline", LauncherRefresh.finished(entry, "failed", "vault: offline", now - 9_000, now).getString("reason"))
    }

    @Test fun `a stalled page is closed only after a while in the background, and only when it says ok`() {
        assertFalse(LauncherRefresh.mayRetire(stoppedAt = 0, now = now))
        assertFalse(LauncherRefresh.mayRetire(now - 10_000, now))
        assertTrue(LauncherRefresh.mayRetire(now - LauncherRefresh.RETIRE_MIN_BACKGROUND_MS, now))
        assertTrue(LauncherRefresh.pageReady("\"ok\""))
        assertFalse(LauncherRefresh.pageReady("\"busy\""))
        assertFalse(LauncherRefresh.pageReady(null))
        val entry = JSONObject().put("clientId", "r1").put("outcome", "unanswered").put("reason", "no answer")
        val closed = LauncherRefresh.retired(entry)
        assertTrue(closed.getBoolean("pageClosed"))
        assertTrue(closed.getString("reason").startsWith("no answer; the app closed"))
        assertTrue(LauncherRefresh.kept(entry, "it has something open").getString("reason").endsWith("left open: it has something open"))
        val follow = LauncherRefresh.headlessFollowUp("r1", now)
        assertEquals("r1-headless", follow.getString("clientId"))
        assertEquals("scheduled", follow.getString("outcome"))
        assertEquals("dead", follow.getString("liveness"))
    }

    @Test fun `a write is rebuilt from what it should carry, and nothing else`() {
        val decide = LauncherIntentReceiver.write(LauncherIntentReceiver.ACTION_DECIDE, """{"event_key":"renewal:s1:2026-12-01","extra":"x"}""", "w1")!!
        assertEquals("decide", decide.getString("action"))
        assertEquals("w1", decide.getString("clientId"))
        assertEquals("launcher", decide.getString("from"))
        assertEquals(setOf("event_key", "state"), decide.getJSONObject("payload").keys().asSequence().toSet())
        assertEquals("renewal:s1:2026-12-01", decide.getJSONObject("payload").getString("event_key"))
        assertEquals("done", decide.getJSONObject("payload").getString("state"))
        assertEquals("restore", LauncherIntentReceiver.write(LauncherIntentReceiver.ACTION_DECIDE, """{"event_key":"k","state":"restore"}""", "w2")!!.getJSONObject("payload").getString("state"))
        assertEquals("done", LauncherIntentReceiver.write(LauncherIntentReceiver.ACTION_DECIDE, """{"event_key":"k","state":"shred"}""", "w3")!!.getJSONObject("payload").getString("state"))
        val send = LauncherIntentReceiver.write(LauncherIntentReceiver.ACTION_SEND, """{"event_key":"k"}""", "w4")!!
        assertEquals("send", send.getString("action"))
        assertFalse(send.getJSONObject("payload").has("state"))
        // No date named, or not JSON: nothing to queue.
        assertNull(LauncherIntentReceiver.write(LauncherIntentReceiver.ACTION_DECIDE, "{}", "w5"))
        assertNull(LauncherIntentReceiver.write(LauncherIntentReceiver.ACTION_SEND, "nope", "w6"))
        assertNull(LauncherIntentReceiver.write(LauncherIntentReceiver.ACTION_REFRESH, """{"event_key":"k"}""", "w7"))
    }
}
