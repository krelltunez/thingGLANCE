package com.thingglance.app.sse

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URL

class SseTest {
    @Test
    fun framesAreSplitOnBlankLinesAcrossReads() {
        val f = SseFraming()
        assertEquals(emptyList<String>(), f.append("event: activity\ndata: {\"se"))
        assertEquals(listOf("event: activity\ndata: {\"seq\":7}"), f.append("q\":7}\n\n"))
        assertEquals(listOf("data: a", "data: b"), f.append("data: a\n\ndata: b\n\ndata: c"))
        assertEquals(listOf("data: c"), f.append("\r\n\r\n"))
    }

    @Test
    fun heartbeatsAreDropped() {
        val f = SseFraming()
        assertEquals(emptyList<String>(), f.append(": keepalive\n\n"))
        assertEquals(listOf("data: x"), f.append(": keepalive\n\ndata: x\n\n"))
    }

    @Test
    fun aHalfReceivedBlockIsForgottenOnReset() {
        val f = SseFraming()
        f.append("data: half")
        f.reset()
        assertEquals(listOf("data: whole"), f.append("data: whole\n\n"))
    }

    @Test(expected = SseFramingOverflowException::class)
    fun aStreamThatNeverEndsABlockIsCutOff() {
        SseFraming(maxBufferChars = 16).append("data: " + "x".repeat(64))
    }

    @Test
    fun backoffDoublesToItsCapAndStartsOverAfterAHealthyConnection() {
        val b = SseBackoff()
        assertEquals(listOf(1_000L, 2_000L, 4_000L, 8_000L, 16_000L, 30_000L, 30_000L), List(7) { b.nextDelayMs() })
        b.onClosed(openDurationMs = 1_000) // a flap: keep backing off
        assertEquals(30_000L, b.nextDelayMs())
        b.onClosed(openDurationMs = 60_000) // a real connection: start over
        assertEquals(1_000L, b.nextDelayMs())
    }

    @Test
    fun theTokenOnlyTravelsInTheClearOnTheLocalNetwork() {
        for (ok in listOf("https://vault.example.com", "http://localhost:8080", "http://10.0.2.2:8791", "http://192.168.1.20:8080", "http://172.20.0.5", "http://nas.local:8080", "http://100.101.102.103:8080", "http://[::1]:8080")) {
            assertTrue(ok, SseUrlPolicy.isSecureOrLan(URL(ok)))
        }
        for (bad in listOf("http://vault.example.com", "http://8.8.8.8", "http://172.32.0.1", "http://100.63.0.1", "http://192.169.1.1", "ftp://192.168.1.1")) {
            assertFalse(bad, SseUrlPolicy.isSecureOrLan(URL(bad)))
        }
    }
}
