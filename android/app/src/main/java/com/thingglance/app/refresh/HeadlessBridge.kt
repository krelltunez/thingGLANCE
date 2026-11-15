package com.thingglance.app.refresh

import android.content.Context
import android.webkit.JavascriptInterface
import com.thingglance.app.SecureStore
import com.thingglance.app.SharedDataStore
import com.thingglance.app.WidgetBridgePlugin
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

// `window.ThingGlanceHeadless` for a background refresh (src/headless/): the
// allowlist of what a run may reach, and nothing more. There is no Capacitor
// in the headless WebView, so this stands in for what the run needs from the
// plugins: the keystore, HTTP, the hand-over to widgets and reminders, and
// the queue of writes made on the home screen. Keep the list equal to
// HEADLESS_BRIDGE_METHODS in src/headless/headlessMode.ts.
//
// Every call marks the run as started: a page that never calls is not running
// the headless root.
class HeadlessBridge(
    private val context: Context,
    private val run: RefreshWorker.Run,
    private val onHttpResult: (json: String) -> Unit,
) {
    // ── The keystore ─────────────────────────────────────────────────────────
    // Each answers {"value": …} or {"error": …}: "nothing stored" and "could
    // not read" must stay different across the bridge (src/sync/secrets.ts).

    @JavascriptInterface
    fun secureGet(key: String): String {
        run.markStarted()
        return try {
            JSONObject().put("value", SecureStore.get(context, key) ?: JSONObject.NULL).toString()
        } catch (e: SecureStore.Unavailable) {
            JSONObject().put("error", "the keystore is unavailable").toString()
        }
    }

    @JavascriptInterface
    fun secureSet(key: String, value: String): String {
        run.markStarted()
        return try {
            SecureStore.set(context, key, value)
            JSONObject().put("value", JSONObject.NULL).toString()
        } catch (e: SecureStore.Unavailable) {
            JSONObject().put("error", "the keystore is unavailable").toString()
        }
    }

    @JavascriptInterface
    fun secureDelete(key: String): String {
        run.markStarted()
        return try {
            SecureStore.delete(context, key)
            JSONObject().put("value", JSONObject.NULL).toString()
        } catch (e: SecureStore.Unavailable) {
            JSONObject().put("error", "the keystore is unavailable").toString()
        }
    }

    // ── HTTP ─────────────────────────────────────────────────────────────────

    // Runs on a worker thread and answers {id, result} through onHttpResult,
    // result being {status, body, headers} (names lower-cased) or {error}.
    @JavascriptInterface
    fun httpRequestAsync(callId: String, method: String, url: String, headersJson: String, body: String?) {
        run.markStarted()
        executor.execute {
            val result = try {
                request(method, url, JSONObject(headersJson), body)
            } catch (e: Exception) {
                JSONObject().put("error", e.message ?: e.toString())
            }
            onHttpResult(JSONObject().put("id", callId).put("result", result).toString())
        }
    }

    private fun request(method: String, url: String, headers: JSONObject, body: String?): JSONObject {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method.uppercase()
            // A request must not outlive the run.
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
        }
        try {
            for (name in headers.keys()) conn.setRequestProperty(name, headers.optString(name))
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            val responseHeaders = JSONObject()
            for ((name, values) in conn.headerFields) {
                if (name != null && values.isNotEmpty()) responseHeaders.put(name.lowercase(), values.joinToString(", "))
            }
            return JSONObject().put("status", status).put("body", text).put("headers", responseHeaders)
        } finally {
            conn.disconnect()
        }
    }

    // ── The home screen ──────────────────────────────────────────────────────

    // The same hand-over the app makes through WidgetBridgePlugin: the payload
    // is stored, the widgets redraw, and Android's alarms are made to match
    // the reminder plan inside it.
    @JavascriptInterface
    fun updateSnapshot(json: String) {
        run.markStarted()
        SharedDataStore.writeWidgetPayload(context, json)
        WidgetBridgePlugin.refreshAll(context)
        WidgetBridgePlugin.applyReminders(context, json)
    }

    @JavascriptInterface
    fun pendingWrites(): String {
        run.markStarted()
        return SharedDataStore.readPendingWrites(context)
    }

    @JavascriptInterface
    fun acknowledgeWrites(idsJson: String) {
        run.markStarted()
        val ids = HashSet<String>()
        try {
            val given = JSONArray(idsJson)
            for (i in 0 until given.length()) ids.add(given.optString(i))
        } catch (e: Exception) {
            return
        }
        SharedDataStore.acknowledge(context, ids)
        WidgetBridgePlugin.refreshAll(context)
    }

    // ── The run's protocol with the worker ───────────────────────────────────

    // True once the app has been opened: the run stops at its next step.
    @JavascriptInterface
    fun shouldAbort(): Boolean {
        run.markStarted()
        return run.abortRequested
    }

    @JavascriptInterface
    fun done(json: String) {
        run.markStarted()
        run.finish(json)
    }

    companion object {
        private val executor: ExecutorService = Executors.newCachedThreadPool()
    }
}
