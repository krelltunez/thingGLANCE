package com.thingglance.app.sse

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import kotlin.coroutines.coroutineContext

// The vault's live event stream, read natively.
//
// The WebView cannot read it: the app's requests go out on a native stack that
// hands back whole responses, and this one never ends. So the shell holds the
// connection (GET {vault}/events with the device token), splits it into event
// blocks, and passes each to the web app, which already knows what to do with
// one (src/sync/vaultEventStream.ts). Ported from the sibling apps' reader.
//
// It only ever causes the app to sync sooner. Polling carries on underneath,
// and nothing depends on an event arriving.
//
// It runs only while the web app wants it AND the app is on screen. It drops
// when the app goes to the background and reconnects, with backoff, on any
// drop. On every connect the vault sends its newest position first, so the
// app catches up on whatever it missed.
class VaultSseClient(private val sink: (String) -> Unit) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var readerJob: Job? = null
    // Kept so that stopping can close the socket: cancelling the coroutine does
    // not interrupt a blocking read.
    @Volatile private var active: HttpURLConnection? = null
    @Volatile private var wanted = false
    @Volatile private var foreground = false
    @Volatile private var vaultUrl: String? = null
    @Volatile private var token: String? = null
    @Volatile private var accountId: String? = null

    @Synchronized
    fun enable(url: String, bearer: String, account: String) {
        val changed = vaultUrl != url.trimEnd('/') || token != bearer || accountId != account
        vaultUrl = url.trimEnd('/')
        token = bearer
        accountId = account
        wanted = true
        // A different connection replaces the one being read.
        if (changed) stopReader()
        reconcile()
    }

    @Synchronized
    fun disable() {
        wanted = false
        reconcile()
    }

    @Synchronized
    fun setForeground(fg: Boolean) {
        foreground = fg
        reconcile()
    }

    @Synchronized
    fun shutdown() {
        wanted = false
        foreground = false
        stopReader()
        scope.cancel()
    }

    private fun reconcile() {
        if (wanted && foreground && vaultUrl != null && token != null && accountId != null) startReader() else stopReader()
    }

    private fun startReader() {
        if (readerJob?.isActive == true) return
        val url = vaultUrl ?: return
        val bearer = token ?: return
        val account = accountId ?: return
        readerJob = scope.launch { runLoop(url, bearer, account) }
    }

    private fun stopReader() {
        readerJob?.cancel()
        readerJob = null
        try { active?.disconnect() } catch (_: Exception) {}
    }

    private suspend fun runLoop(url: String, bearer: String, account: String) {
        val backoff = SseBackoff()
        while (coroutineContext[Job]?.isActive == true) {
            val openedAt = System.currentTimeMillis()
            try {
                connectAndRead(url, bearer, account)
            } catch (e: SseTerminalException) {
                // Trying again cannot help (a refused token, an insecure
                // address, a server with no /events). Say so once and stop; a
                // later enable() starts afresh.
                if (coroutineContext[Job]?.isActive != true) return
                Log.w(TAG, "event stream stopped (${e.code}): ${e.message}")
                push(JSONObject().put("type", "error").put("code", e.code).put("message", e.message ?: e.code))
                return
            } catch (e: Exception) {
                if (coroutineContext[Job]?.isActive != true) return
                Log.w(TAG, "event stream read error: ${e.message}")
                push(JSONObject().put("type", "error").put("message", e.message ?: "sse error"))
            }
            if (coroutineContext[Job]?.isActive != true) return
            push(JSONObject().put("type", "closed"))
            backoff.onClosed(System.currentTimeMillis() - openedAt)
            delay(backoff.nextDelayMs())
        }
    }

    private suspend fun connectAndRead(url: String, bearer: String, account: String) {
        val target = URL("$url/events?accountId=" + URLEncoder.encode(account, "UTF-8"))
        // The token never travels in the clear over the open internet. The
        // app allows plain http so that a vault on the home network works
        // (res/xml/network_security_config.xml); this is the check that keeps
        // it to the home network for this request.
        if (!SseUrlPolicy.isSecureOrLan(target)) {
            throw SseTerminalException("insecure", "refused: http is only allowed to a vault on the local network")
        }
        val conn = (target.openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("Authorization", "Bearer $bearer")
            setRequestProperty("Accept", "text/event-stream")
            connectTimeout = 20_000
            // Longer than the server's twenty-second heartbeat, so a healthy
            // quiet stream never trips it and a dead one is noticed.
            readTimeout = 60_000
            instanceFollowRedirects = true
        }
        active = conn
        try {
            val code = conn.responseCode
            if (code == 401 || code == 403) throw SseTerminalException("auth", "the vault refused the device token ($code)")
            if (code == 404) throw SseTerminalException("unsupported", "this vault has no event stream")
            if (code !in 200..299) throw RuntimeException("event stream connect failed: $code")
            push(JSONObject().put("type", "open"))
            val framing = SseFraming()
            val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
            val chunk = CharArray(2048)
            while (coroutineContext[Job]?.isActive == true) {
                val n = reader.read(chunk)
                if (n == -1) break
                for (block in framing.append(String(chunk, 0, n))) {
                    push(JSONObject().put("type", "frame").put("block", block))
                }
            }
        } finally {
            active = null
            try { conn.disconnect() } catch (_: Exception) {}
        }
    }

    private fun push(msg: JSONObject) = sink(msg.toString())

    companion object {
        private const val TAG = "VaultSseClient"
    }
}

// An error reconnecting cannot fix. `code` is what the web app is told.
class SseTerminalException(val code: String, message: String) : RuntimeException(message)

// https anywhere; http only to this device or the local network.
object SseUrlPolicy {
    fun isSecureOrLan(url: URL): Boolean {
        val scheme = (url.protocol ?: "").lowercase()
        if (scheme == "https") return true
        if (scheme != "http") return false
        return isLocalOrLanHost(url.host ?: "")
    }

    fun isLocalOrLanHost(rawHost: String): Boolean {
        var host = rawHost.trim().lowercase()
        if (host.startsWith("[") && host.endsWith("]")) host = host.substring(1, host.length - 1)
        if (host.isEmpty()) return false
        if (host == "localhost" || host.endsWith(".localhost") || host == "::1" || host.endsWith(".local")) return true
        val m = Regex("""^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$""").find(host) ?: return false
        val octets = m.groupValues.drop(1).map { it.toInt() }
        if (octets.any { it > 255 }) return false
        val (a, b) = octets
        return when {
            a == 127 -> true
            a == 10 -> true
            a == 192 && b == 168 -> true
            a == 172 && b in 16..31 -> true
            // Tailscale and other carrier-grade NAT addresses: a private
            // overlay, and a common home for a self-hosted vault.
            a == 100 && b in 64..127 -> true
            else -> false
        }
    }
}
