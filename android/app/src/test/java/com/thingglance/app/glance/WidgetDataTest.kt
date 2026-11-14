package com.thingglance.app.glance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.GregorianCalendar

// The widgets work out countdowns and read the app's snapshot on their own.
// These pin that against the web app's own rules (src/core/dates.ts) and
// against payloads that are missing, old or broken.
class WidgetDataTest {
    private val labels = WidgetLabels("Needs a decision", "Nothing", "Next up", "Nothing", "today", "{{n}}d", "{{n}}mo", "{{n}}y")

    @Test
    fun aDayIsARealCalendarDate() {
        assertEquals(0L, dayNumber("1970-01-01"))
        assertEquals(1L, dayNumber("1970-01-02"))
        assertEquals(dayNumber("2028-02-29")!! + 1, dayNumber("2028-03-01"))
        for (bad in listOf("2027-13-45", "2027-02-29", "2027-02-31", "0000-00-00", "2027-1-5x", "", "tomorrow")) {
            assertNull(bad, dayNumber(bad))
        }
    }

    @Test
    fun daysAreCountedOnTheCalendar() {
        val today = todayNumber(GregorianCalendar(2026, 10, 14, 23, 30)) // 14 Nov, late evening
        assertEquals(0, daysUntil("2026-11-14", today))
        assertEquals(1, daysUntil("2026-11-15", today))
        assertEquals(-1, daysUntil("2026-11-13", today))
        assertEquals(365, daysUntil("2027-11-14", today))
        // Across the spring clock change, where a clock-based count loses a day.
        assertEquals(2, (dayNumber("2027-03-15")!! - dayNumber("2027-03-13")!!).toInt())
    }

    @Test
    fun theCountdownMatchesTheApp() {
        assertEquals("T-0", tMinus(0, labels))
        assertEquals("T-12d", tMinus(12, labels))
        assertEquals("T+19d", tMinus(-19, labels))
        assertEquals("T-59d", tMinus(59, labels))
        assertEquals("T-2mo", tMinus(60, labels))
        assertEquals("T+3mo", tMinus(-90, labels))
        assertEquals("T-24mo", tMinus(729, labels))
        assertEquals("T-2y", tMinus(730, labels))
        assertEquals("T-2.5y", tMinus(913, labels))
    }

    @Test
    fun theCountdownUsesTheAppsOwnUnits() {
        val german = labels.copy(days = "{{n}} T.", months = "{{n}} Mon.", years = "{{n}} J.")
        assertEquals("T-12 T.", tMinus(12, german))
        assertEquals("T+3 Mon.", tMinus(-90, german))
    }

    @Test
    fun urgencyFollowsTheDistance() {
        assertEquals(Urgency.PAST, urgency(-1))
        assertEquals(Urgency.URGENT, urgency(0))
        assertEquals(Urgency.URGENT, urgency(14))
        assertEquals(Urgency.SOON, urgency(15))
        assertEquals(Urgency.LATER, urgency(61))
    }

    private val payload = """
        {"snapshot":{"version":1,"locale":"de-AT","attention":[
            {"key":"coverage-end:c1:2027-01-15","type":"coverage-end","date":"2027-01-15","days":62,"severity":"soon","title":"AppleCare+ endet","detail":"MacBook Pro","state":"sent","handlerId":null,"link":"thingglance://event/coverage-end%3Ac1%3A2027-01-15"},
            {"key":"broken","type":"renewal","date":"2027-13-45","title":"x","detail":"y","link":"thingglance://event/broken"},
            {"type":"renewal","date":"2027-02-01","title":"no key","detail":"y"}
          ],"upcoming":[
            {"key":"renewal:s1:2027-02-01","type":"renewal","date":"2027-02-01","title":"iCloud+ renews","detail":"Apple"}
          ]},
         "labels":{"decideTitle":"Zu entscheiden","decideEmpty":"Nichts","nextTitle":"Als Nächstes","nextEmpty":"Nichts","today":"heute","days":"{{n}}T","months":"{{n}}Mon","years":"{{n}}J"}}
    """.trimIndent()

    @Test
    fun readsTheSnapshotTheAppWrote() {
        val data = WidgetSnapshot.parse(payload)
        assertTrue(data.loaded)
        assertEquals("de-AT", data.locale.toLanguageTag())
        assertEquals("Zu entscheiden", data.labels.decideTitle)
        // Rows that cannot be drawn or opened are left out, not shown broken.
        assertEquals(1, data.attention.size)
        val first = data.attention[0]
        assertEquals("AppleCare+ endet", first.title)
        assertEquals("sent", first.state)
        assertEquals("thingglance://event/coverage-end%3Ac1%3A2027-01-15", first.link)
        // A row with no link of its own still opens the app.
        assertEquals("thingglance://queue", data.upcoming[0].link)
        assertEquals("open", data.upcoming[0].state)
        assertEquals(first, data.next)
    }

    @Test
    fun whatWasClearedOrDoneIsNotNext() {
        val row = { state: String, title: String -> "{\"key\":\"$title\",\"date\":\"2190-01-15\",\"title\":\"$title\",\"state\":\"$state\"}" }
        val data = WidgetSnapshot.parse("{\"snapshot\":{\"attention\":[],\"upcoming\":[${row("dismissed", "a")},${row("done", "b")},${row("sent", "c")},${row("open", "d")}]}}")
        assertEquals("c", data.next?.title)
        // And a date already behind us is not "next" either.
        val past = WidgetSnapshot.parse("{\"snapshot\":{\"upcoming\":[{\"key\":\"old\",\"date\":\"1999-01-15\",\"title\":\"old\"}]}}")
        assertNull(past.next)
    }

    @Test
    fun aPayloadThatIsMissingOrBrokenDrawsAsNotLoaded() {
        for (bad in listOf(null, "", "   ", "{", "[]", "{\"labels\":{}}", "null")) {
            val data = WidgetSnapshot.parse(bad)
            assertFalse(bad ?: "null", data.loaded)
            assertTrue(data.attention.isEmpty())
            assertNull(data.next)
            assertEquals("Needs a decision", data.labels.decideTitle)
        }
    }

    @Test
    fun fieldsAddedLaterAreIgnoredAndMissingOnesHaveDefaults() {
        val data = WidgetSnapshot.parse("""{"snapshot":{"version":1,"somethingNew":true,"upcoming":[{"key":"k","date":"2027-01-15","extra":1}]}}""")
        assertTrue(data.loaded)
        assertEquals("en", data.locale.toLanguageTag())
        assertEquals("", data.upcoming[0].title)
        assertEquals("Next up", data.labels.nextTitle)
    }
}
