package com.thingglance.app.refresh

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RefreshPolicyTest {
    private val now = 10_000_000L

    @Test
    fun nothingRunsWhileTheAppIsOpen() {
        assertTrue(RefreshPolicy.decide(appOpen = true, onDemand = false, lastRunAt = 0, now = now) is RefreshPolicy.Decision.AppIsOpen)
        assertTrue(RefreshPolicy.decide(appOpen = true, onDemand = true, lastRunAt = 0, now = now) is RefreshPolicy.Decision.AppIsOpen)
    }

    @Test
    fun theRoutineRunIsNeverThrottled() {
        assertTrue(RefreshPolicy.decide(false, onDemand = false, lastRunAt = now - 1_000, now = now) is RefreshPolicy.Decision.Run)
    }

    @Test
    fun severalTicksInARowAreOneRunsWork() {
        assertTrue(RefreshPolicy.decide(false, onDemand = true, lastRunAt = now - 5_000, now = now) is RefreshPolicy.Decision.Throttled)
        assertTrue(RefreshPolicy.decide(false, onDemand = true, lastRunAt = now - RefreshPolicy.ON_DEMAND_FLOOR_MS, now = now) is RefreshPolicy.Decision.Run)
        assertTrue(RefreshPolicy.decide(false, onDemand = true, lastRunAt = 0, now = now) is RefreshPolicy.Decision.Run)
    }

    @Test
    fun aClockThatWentBackwardsDoesNotBlockRefreshes() {
        assertTrue(RefreshPolicy.decide(false, onDemand = true, lastRunAt = now + 3_600_000, now = now) is RefreshPolicy.Decision.Run)
    }

    @Test
    fun aRunThatReportedNothingIsStillExplained() {
        assertEquals("aborted" to "app opened", RefreshPolicy.unreported(aborted = true, timedOut = true, rendererGone = false, started = true))
        assertEquals("failed", RefreshPolicy.unreported(false, timedOut = true, rendererGone = false, started = false).first)
        assertTrue(RefreshPolicy.unreported(false, true, false, false).second.contains("did not start"))
        assertTrue(RefreshPolicy.unreported(false, true, false, true).second.contains("longer than"))
        assertTrue(RefreshPolicy.unreported(false, false, true, true).second.contains("process ended"))
    }

    @Test
    fun theLogKeepsThePagesOwnReport() {
        val e = RefreshPolicy.entry("routine", 1, 2, """{"outcome":"ran","synced":["vault","roster"],"applied":1,"durationMs":900}""", null)
        assertEquals("ran", e.getString("outcome"))
        assertEquals(2, e.getJSONArray("synced").length())
        assertEquals(1, e.getInt("applied"))
        assertFalse(e.has("reason"))
        val failed = RefreshPolicy.entry("home-screen", 1, 2, """{"outcome":"failed","reason":"vault: offline","synced":[],"applied":0}""", null)
        assertEquals("vault: offline", failed.getString("reason"))
    }

    @Test
    fun aReportThatCannotBeReadIsRecordedAsAFailure() {
        assertEquals("failed", RefreshPolicy.entry("routine", 1, 2, "not json", null).getString("outcome"))
        assertEquals("app opened", RefreshPolicy.entry("routine", 1, 2, null, "aborted" to "app opened").getString("reason"))
    }
}
