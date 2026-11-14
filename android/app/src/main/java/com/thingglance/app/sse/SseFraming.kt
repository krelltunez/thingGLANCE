package com.thingglance.app.sse

// Splits a server-sent-events stream into its event blocks. The Kotlin mirror
// of drainSseBuffer in src/sync/vaultEventStream.ts, and the same reader the
// sibling apps ship.
//
// It only frames. What a block means stays in one place, the web app's
// parseSseFrame, which every block is handed to. Blocks with no data line
// (the server's heartbeat comments) are dropped here, so the app is not woken
// every twenty seconds for nothing.
class SseFraming(
    // A server that sends bytes and never a blank line would otherwise grow
    // this without end. Real events are a few bytes.
    private val maxBufferChars: Int = 1_048_576,
) {
    private val buffer = StringBuilder()

    // Takes the next piece of the stream and answers every complete block it
    // now has. Throws when the unfinished remainder passes the cap; the reader
    // treats that like any dropped connection.
    fun append(chunk: String): List<String> {
        buffer.append(chunk.replace("\r\n", "\n").replace('\r', '\n'))
        val blocks = mutableListOf<String>()
        var idx = buffer.indexOf("\n\n")
        while (idx != -1) {
            val block = buffer.substring(0, idx)
            buffer.delete(0, idx + 2)
            if (block.split('\n').any { it.startsWith("data:") }) blocks.add(block)
            idx = buffer.indexOf("\n\n")
        }
        if (buffer.length > maxBufferChars) throw SseFramingOverflowException(buffer.length, maxBufferChars)
        return blocks
    }

    // Forgets a half-received block, so it cannot be glued onto the start of
    // the next connection.
    fun reset() {
        buffer.setLength(0)
    }
}

class SseFramingOverflowException(size: Int, cap: Int) :
    RuntimeException("SSE frame buffer exceeded cap: $size > $cap chars")
