package com.thingglance.app.reminders

import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

// The Kotlin mirror of diffReminders() and reminderNumericId() in
// src/core/reminders.ts. If these disagree with the web side, a reminder is
// scheduled twice or never cancelled.
class ReminderPlanTest {
    private fun r(id: String, at: Long, title: String = "Warranty ends", body: String = "Laptop", key: String = id.substringBefore('@')) =
        PlannedReminder(id, key, at, title, body, "thingglance://event/$key")

    private val now = 1_000_000L
    private val a = r("coverage-end:c1:2027-01-15@heads-up", now + 10_000)
    private val b = r("coverage-end:c1:2027-01-15@last-call", now + 20_000)

    @Test
    fun theAndroidIdIsTheWebSidesHash() {
        // reminderNumericId() in src/core/reminders.ts for the same strings.
        fun web(id: String): Int {
            var h = 0
            for (ch in id) h = 31 * h + ch.code
            val positive = h and 0x7fffffff
            return if (positive == 0) 1 else positive
        }
        for (id in listOf(a.id, b.id, "renewal:9f71f076-dbe1-4fd4-a0d3-76cacb31bcd1:2027-02-01@last-call", "")) {
            assertEquals(id, web(id), r(id, 1).numericId)
        }
        assertTrue(a.numericId > 0 && a.numericId != b.numericId)
    }

    @Test
    fun everythingIsScheduledOnAPhoneThatHoldsNothing() {
        val d = ReminderPlan.diff(listOf(a, b), emptyList(), now)
        assertEquals(listOf(a, b), d.schedule)
        assertTrue(d.cancel.isEmpty() && d.keep.isEmpty())
    }

    @Test
    fun anUnchangedPlanTouchesNothing() {
        val d = ReminderPlan.diff(listOf(a, b), listOf(a, b), now)
        assertTrue(d.schedule.isEmpty() && d.cancel.isEmpty())
        assertEquals(listOf(a, b), d.keep)
    }

    @Test
    fun whatIsNoLongerPlannedIsCancelledAndOnlyThat() {
        val stale = r("renewal:s1:2027-02-01@last-call", now + 5_000)
        val d = ReminderPlan.diff(listOf(a, b), listOf(a, b, stale), now)
        assertEquals(listOf(stale), d.cancel)
        assertTrue(d.schedule.isEmpty())
    }

    @Test
    fun aChangedTimeOrWordingIsScheduledAgain() {
        val later = a.copy(at = a.at + 3_600_000)
        assertEquals(listOf(later), ReminderPlan.diff(listOf(later, b), listOf(a, b), now).schedule)
        val renamed = a.copy(body = "Work laptop")
        assertEquals(listOf(renamed), ReminderPlan.diff(listOf(renamed, b), listOf(a, b), now).schedule)
    }

    @Test
    fun aReminderWhoseMomentHasPassedIsNotSentLate() {
        val past = r("coverage-end:c2:2026-01-01@last-call", now - 1)
        val d = ReminderPlan.diff(listOf(past, a), listOf(past), now)
        assertEquals(listOf(a), d.schedule)
        assertEquals(listOf(past), d.cancel)
    }

    @Test
    fun aPlanSurvivesBeingStoredAndReadBack() {
        assertEquals(listOf(a, b), ReminderPlan.parse(ReminderPlan.toJson(listOf(a, b))))
    }

    @Test
    fun rowsThatCannotBeScheduledAreLeftOut() {
        val parsed = ReminderPlan.parse(JSONArray("""[{"id":"x@last-call","at":5,"title":"t"},{"at":5},{"id":"no-time"},"junk",{"id":"y@heads-up","at":9,"eventKey":"y","link":""}]"""))
        assertEquals(listOf("x@last-call", "y@heads-up"), parsed.map { it.id })
        assertEquals("thingglance://queue", parsed[1].link)
    }
}
