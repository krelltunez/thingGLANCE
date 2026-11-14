package com.thingglance.app.sse

// How long to wait before connecting again: doubling from a second up to
// thirty, starting over once a connection has stayed up long enough to count
// as healthy. A stream that opens and drops at once keeps backing off, so a
// broken endpoint is never hammered. The same policy as the web reader.
class SseBackoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 30_000,
    private val minStableMs: Long = 5_000,
) {
    private var attempt = 0

    fun nextDelayMs(): Long {
        val delay = minOf(maxMs, baseMs shl attempt.coerceIn(0, 30))
        attempt++
        return delay
    }

    fun onClosed(openDurationMs: Long) {
        if (openDurationMs >= minStableMs) attempt = 0
    }
}
