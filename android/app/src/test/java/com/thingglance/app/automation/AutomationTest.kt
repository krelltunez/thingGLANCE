package com.thingglance.app.automation

import com.thingglance.app.LaunchLinks
import com.thingglance.app.SharedDataStore
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// What a broadcast from an automation app becomes, and what it is answered
// with. (The broadcasts themselves need Android: scripts/android-check.mjs
// sends real ones on an emulator.)
class AutomationTest {
    private val mint = { "minted-id" }

    @Test
    fun everyBroadcastActionIsMappedToTheHandlersOwnName() {
        // Sent on unmapped, each of these would be an unknown action and do nothing.
        assertEquals("create_thing", Automation.entry("app.thingglance.CREATE", "{}", mint)!!.getString("action"))
        assertEquals("create_plan", Automation.entry("app.thingglance.CREATE_PLAN", "{}", mint)!!.getString("action"))
        assertEquals("add_coverage", Automation.entry("app.thingglance.ADD_COVERAGE", "{}", mint)!!.getString("action"))
        assertEquals("decide", Automation.entry("app.thingglance.DECIDE", "{}", mint)!!.getString("action"))
        assertEquals("send", Automation.entry("app.thingglance.SEND", "{}", mint)!!.getString("action"))
        // Not writes: a query is answered on the spot, an open is a link.
        assertNull(Automation.entry(Automation.ACTION_QUERY, "{}", mint))
        assertNull(Automation.entry(Automation.ACTION_OPEN, "{}", mint))
        assertNull(Automation.entry("app.thingglance.DELETE", "{}", mint))
        assertNull(Automation.entry("create_thing", "{}", mint))
    }

    @Test
    fun aWriteKeepsItsPayloadAndRemembersWhatWasAsked() {
        val entry = Automation.entry("app.thingglance.CREATE", """{"name":"Kettle","price":"39.99","client_id":" abc-123 ","reply_to":"net.dinglisch.android.taskerm"}""", mint)!!
        assertEquals("abc-123", entry.getString("clientId"))
        val payload = entry.getJSONObject("payload")
        assertEquals("Kettle", payload.getString("name"))
        assertEquals("39.99", payload.getString("price"))
        // The transport's own two fields do not travel on to the handler.
        assertFalse(payload.has("client_id"))
        assertFalse(payload.has("reply_to"))
        // The answer goes out under the action exactly as it was sent.
        assertEquals("app.thingglance.CREATE", entry.getJSONObject("reply").getString("action"))
        assertEquals("net.dinglisch.android.taskerm", entry.getJSONObject("reply").getString("to"))
    }

    @Test
    fun aWriteWithNoIdOfItsOwnIsGivenOne() {
        assertEquals("minted-id", Automation.entry("app.thingglance.CREATE", """{"name":"Kettle"}""", mint)!!.getString("clientId"))
        assertEquals("minted-id", Automation.entry("app.thingglance.CREATE", """{"name":"Kettle","client_id":"   "}""", mint)!!.getString("clientId"))
        // An id too long to be one is not used.
        assertEquals("minted-id", Automation.entry("app.thingglance.CREATE", """{"client_id":"${"x".repeat(300)}"}""", mint)!!.getString("clientId"))
        // No reply_to: the answer is for whoever listens.
        assertFalse(Automation.entry("app.thingglance.CREATE", "{}", mint)!!.getJSONObject("reply").has("to"))
    }

    @Test
    fun aPayloadThatIsNotAnObjectIsAnEmptyOne() {
        for (bad in listOf(null, "", "   ", "not json", "[1,2]", "42", "{\"name\":")) {
            val entry = Automation.entry("app.thingglance.CREATE", bad, mint)!!
            assertEquals(bad ?: "null", 0, entry.getJSONObject("payload").length())
            assertEquals("minted-id", entry.getString("clientId"))
        }
    }

    @Test
    fun theAnswerIsOnlyAddressedToSomethingThatLooksLikeAnApp() {
        assertEquals("com.example.app", Automation.replyTo(JSONObject().put("reply_to", " com.example.app ")))
        for (bad in listOf("", "tasker", "com..app", "com.example.app; rm", "1com.example", "com.example.", "x".repeat(300) + ".app")) {
            assertNull(bad, Automation.replyTo(JSONObject().put("reply_to", bad)))
        }
        assertNull(Automation.replyTo(JSONObject()))
    }

    @Test
    fun aQueryIsAnsweredFromTheSnapshotInHand() {
        val answer = Automation.queryResult("""{"snapshot":{"version":1,"counts":{"attention":2}},"labels":{}}""")
        assertTrue(answer.getBoolean("success"))
        assertEquals(2, answer.getJSONObject("snapshot").getJSONObject("counts").getInt("attention"))
        // Only the snapshot goes out, not the widgets' own words beside it.
        assertFalse(answer.has("labels"))
        for (none in listOf(null, "", "{", "{}", "[]")) {
            val refused = Automation.queryResult(none)
            assertFalse(none ?: "null", refused.getBoolean("success"))
            assertEquals("unavailable", refused.getString("code"))
        }
    }

    @Test
    fun onlyAWriteThatAskedIsAnswered() {
        val fromTasker = Automation.entry("app.thingglance.CREATE", """{"name":"Kettle","client_id":"t1","reply_to":"com.example.app"}""", mint)!!
        val unaddressed = Automation.entry("app.thingglance.DECIDE", """{"event_key":"k","client_id":"t2"}""", mint)!!
        val widgetTick = JSONObject().put("action", "decide").put("clientId", "widget:1").put("payload", JSONObject().put("event_key", "k"))
        val unanswered = Automation.entry("app.thingglance.SEND", """{"event_key":"k","client_id":"t3"}""", mint)!!
        val results = """{"t1":{"success":true,"thing_id":"t1"},"t2":{"success":false,"code":"not_found","error":"No such date"},"widget:1":{"success":true}}"""
        val replies = Automation.replies(listOf(fromTasker, unaddressed, widgetTick, unanswered), results)
        // The widget's tick asked for no answer; the send got none to pass on.
        assertEquals(2, replies.size)
        assertEquals("app.thingglance.CREATE", replies[0].action)
        assertEquals("com.example.app", replies[0].to)
        val first = JSONObject(replies[0].result)
        assertTrue(first.getBoolean("success"))
        assertEquals("t1", first.getString("thing_id"))
        // The write's id comes back with it.
        assertEquals("t1", first.getString("client_id"))
        assertEquals("app.thingglance.DECIDE", replies[1].action)
        assertNull(replies[1].to)
        assertEquals("not_found", JSONObject(replies[1].result).getString("code"))
        // Results that cannot be read answer nobody, and break nothing.
        assertTrue(Automation.replies(listOf(fromTasker), "not json").isEmpty())
        assertTrue(Automation.replies(listOf(fromTasker), null).isEmpty())
    }

    @Test
    fun theQueueTakesAWriteOnceAndDropsAutomationWritesOnRequest() {
        val queue = JSONArray()
        val first = Automation.entry("app.thingglance.CREATE", """{"name":"Kettle","client_id":"t1"}""", mint)!!
        assertTrue(SharedDataStore.added(queue, first))
        // The sender retrying while it waits adds nothing.
        assertFalse(SharedDataStore.added(queue, Automation.entry("app.thingglance.CREATE", """{"name":"Kettle again","client_id":"t1"}""", mint)!!))
        queue.put(JSONObject().put("action", "decide").put("clientId", "widget:1").put("payload", JSONObject().put("event_key", "k")))
        assertEquals(2, queue.length())
        // Switched off: what automation queued goes, a widget's tick stays.
        val (kept, gone) = SharedDataStore.split(queue) { !it.has("reply") }
        assertEquals(1, kept.length())
        assertEquals("widget:1", kept.getJSONObject(0).getString("clientId"))
        assertEquals("t1", gone.single().getString("clientId"))
    }

    @Test
    fun aDateClearedByAutomationLeavesTheWidgetsLikeATickButARestoreDoesNot() {
        val queue = JSONArray()
        SharedDataStore.added(queue, Automation.entry("app.thingglance.DECIDE", """{"event_key":"cleared","client_id":"a"}""", mint)!!)
        SharedDataStore.added(queue, Automation.entry("app.thingglance.DECIDE", """{"event_key":"put-back","state":"restore","client_id":"b"}""", mint)!!)
        SharedDataStore.added(queue, Automation.entry("app.thingglance.SEND", """{"event_key":"sent","client_id":"c"}""", mint)!!)
        assertEquals(setOf("cleared"), SharedDataStore.pendingKeys(queue, "decide"))
        assertEquals(setOf("sent"), SharedDataStore.pendingKeys(queue, "send"))
    }

    @Test
    fun anOpenCarriesALinkOrNothing() {
        assertEquals("thingglance://view/plans", LaunchLinks.openLink("thingglance://view/plans", null))
        assertEquals("thingglance://view/plans", LaunchLinks.openLink(null, """{"link":"thingglance://view/plans"}"""))
        // A bare path is the same link without its scheme.
        assertEquals("thingglance://queue", LaunchLinks.openLink(" queue ", null))
        assertEquals("thingglance://action/add?name=Kettle", LaunchLinks.openLink(null, """{"link":"action/add?name=Kettle"}"""))
        // The extra wins over the payload.
        assertEquals("thingglance://queue", LaunchLinks.openLink("queue", """{"link":"view/plans"}"""))
        // Anything else just opens the app.
        for (none in listOf<Pair<String?, String?>>(null to null, "" to "{}", null to "not json", "https://example.com/x" to null, "javascript:alert(1)" to null, "two words" to null)) {
            assertNull(none.toString(), LaunchLinks.openLink(none.first, none.second))
        }
    }
}
