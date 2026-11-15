package com.thingglance.app.launcher

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LauncherRowsTest {
    private fun event(key: String, state: String = "open") = JSONObject().put("key", key).put("title", "Warranty ends").put("state", state).put("date", "2026-11-24")

    private fun payload(launcher: Boolean = true): String {
        val snapshot = JSONObject()
            .put("version", 1).put("generatedAt", "2026-11-15T16:00:00.000Z").put("day", "2026-11-15").put("currency", "USD").put("locale", "en-US")
            .put("counts", JSONObject().put("things", 2).put("subscriptions", 1).put("attention", 3).put("urgent", 1).put("covered", 1))
            .put("burn", JSONObject().put("monthly", 10.0).put("yearly", 120.0).put("replacementMonthly", 25.0))
            .put("attention", JSONArray().put(event("a")).put(event("b")))
            .put("upcoming", JSONArray().put(event("a")).put(event("u")))
            .put("things", JSONArray().put(JSONObject().put("id", "t1").put("name", "Laptop")))
            .put("charges", JSONObject().put("days", 30).put("total", 12.5).put("count", 1)
                .put("items", JSONArray().put(JSONObject().put("subscriptionId", "s1").put("date", "2026-12-01").put("amount", 12.5)))
                .put("months", JSONArray().put(JSONObject().put("month", "2026-11-01").put("total", 0)).put(JSONObject().put("month", "2026-12-01").put("total", 12.5))))
        val root = JSONObject().put("snapshot", snapshot).put("canSend", true)
            .put("labels", JSONObject().put("verdicts", JSONObject().put("prime", "Prime")).put("sent", "In dayGLANCE").put("waiting", JSONArray().put("Nothing waiting")))
        if (launcher) root.put("launcher", JSONObject()
            .put("attention", JSONArray().put(event("a")).put(event("b")).put(event("c")))
            .put("upcoming", JSONArray().put(event("a")).put(event("u")).put(event("v")))
            .put("charges", JSONArray().put(JSONObject().put("subscriptionId", "s1").put("date", "2026-12-01")).put(JSONObject().put("subscriptionId", "s2").put("date", "2026-12-03")))
            .put("handledWrites", JSONArray().put(JSONObject().put("clientId", "w1").put("action", "decide").put("entityId", "a")))
            .put("syncedAt", "2026-11-15T15:00:00.000Z"))
        return root.toString()
    }

    private fun meta(payload: String?, live: LauncherRows.Live = LauncherRows.Live()) = JSONObject(LauncherRows.rows(payload, "meta", live)!!.single().json)
    private fun ids(payload: String?, collection: String, live: LauncherRows.Live = LauncherRows.Live()) = LauncherRows.rows(payload, collection, live)!!.map { it.id }

    @Test fun `serves only its own collections`() {
        assertNull(LauncherRows.rows(payload(), "secrets"))
        for (c in LauncherRows.COLLECTIONS) assertTrue(LauncherRows.rows(payload(), c) != null)
    }

    @Test fun `takes the launcher's longer lists, and the widgets' when there are none`() {
        assertEquals(listOf("a", "b", "c"), ids(payload(), "attention"))
        assertEquals(listOf("a", "u", "v"), ids(payload(), "upcoming"))
        assertEquals(listOf("s1:2026-12-01", "s2:2026-12-03"), ids(payload(), "charges"))
        assertEquals(listOf("t1"), ids(payload(), "things"))
        // A payload written by a build from before the launcher: still readable.
        assertEquals(listOf("a", "b"), ids(payload(launcher = false), "attention"))
        assertEquals(listOf("s1:2026-12-01"), ids(payload(launcher = false), "charges"))
    }

    @Test fun `meta carries what the launcher measures freshness from, in the names it reads`() {
        val m = meta(payload(), LauncherRows.Live(checkedAt = 1_763_222_400_000, refreshLog = """[{"clientId":"r1","outcome":"ran"}]""", rendererAlive = true))
        assertEquals("2026-11-15T16:00:00.000Z", m.getString("updatedAt"))
        assertEquals(1_763_222_400_000, m.getLong("checkedAt"))
        assertEquals("2026-11-15T15:00:00.000Z", m.getString("syncedAt"))
        assertTrue(m.getBoolean("rendererAlive"))
        assertFalse(m.getBoolean("headlessRunning"))
        assertEquals("r1", m.getJSONArray("refreshLog").getJSONObject(0).getString("clientId"))
        assertEquals("w1", m.getJSONArray("handledWrites").getJSONObject(0).getString("clientId"))
        assertEquals("2026-11-15", m.getString("today"))
        assertEquals("USD", m.getString("currency"))
        assertEquals(3, m.getJSONObject("counts").getInt("attention"))
        assertEquals(12.5, m.getJSONObject("charges").getDouble("total"), 0.0)
        assertEquals(2, m.getJSONObject("charges").getJSONArray("months").length())
        assertTrue(m.getBoolean("canSend"))
        // The app's words for what the launcher cannot word itself, and not the rest.
        assertEquals("Prime", m.getJSONObject("labels").getJSONObject("verdicts").getString("prime"))
        assertFalse(m.getJSONObject("labels").has("waiting"))
    }

    @Test fun `the later of the two sync times wins, and none is null`() {
        assertEquals("2026-11-15T15:30:00.000Z", meta(payload(), LauncherRows.Live(syncedAt = "2026-11-15T15:30:00.000Z")).getString("syncedAt"))
        assertEquals("2026-11-15T15:00:00.000Z", meta(payload(), LauncherRows.Live(syncedAt = "2026-11-15T14:00:00.000Z")).getString("syncedAt"))
        assertTrue(meta(payload(launcher = false)).isNull("syncedAt"))
    }

    @Test fun `a date ticked off elsewhere is gone before the app has applied it`() {
        val live = LauncherRows.Live(cleared = setOf("a"), sending = setOf("b"))
        assertEquals(listOf("b", "c"), ids(payload(), "attention", live))
        assertEquals(2, meta(payload(), live).getJSONObject("counts").getInt("attention"))
        val rows = LauncherRows.rows(payload(), "attention", live)!!
        assertEquals("sent", JSONObject(rows[0].json).getString("state"))
        // Upcoming keeps every date still ahead, with where its decision stands.
        val upcoming = LauncherRows.rows(payload(), "upcoming", live)!!
        assertEquals(listOf("a", "u", "v"), upcoming.map { it.id })
        assertEquals("done", JSONObject(upcoming[0].json).getString("state"))
    }

    @Test fun `installed and never opened is a meta row that says so, and nothing else`() {
        val m = meta(null, LauncherRows.Live(rendererAlive = false))
        assertTrue(m.getBoolean("empty"))
        assertFalse(m.has("checkedAt"))
        assertEquals(emptyList<String>(), ids(null, "attention"))
        assertEquals(emptyList<String>(), ids("not json", "things"))
    }
}
