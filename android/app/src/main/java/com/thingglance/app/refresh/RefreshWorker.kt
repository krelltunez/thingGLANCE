package com.thingglance.app.refresh

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.thingglance.app.SharedDataStore
import com.thingglance.app.WidgetBridgePlugin
import com.thingglance.app.launcher.LauncherProvider
import com.thingglance.app.launcher.LauncherRefresh
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

// The background refresh: the app's own work, done without the app being
// opened. Modelled on the sibling apps' headless refresh.
//
// It boots the web bundle in a WebView with no Activity, at
// https://localhost/index.html?headless=refresh, where main.tsx runs
// src/headless/headlessRefresh.ts: sync with the vault, apply what was ticked
// on the home screen, hand over a fresh snapshot. From that the widgets are
// redrawn and the reminders re-planned (HeadlessBridge.updateSnapshot).
//
// Capacitor needs an Activity, so this WebView has no Capacitor. It serves the
// app's own files at the app's own origin, so it shares the app's storage,
// and HeadlessBridge stands in for the plugins a run uses.
//
// Three triggers: a routine run a few times a day, a run soon after
// something is done on the home screen while the app is closed, so that it
// reaches the vault and the household's other devices, and a run
// GLANCElauncher asked for (launcher/LauncherIntentReceiver.kt), whose
// outcome is also written where the launcher reads it.
//
// If the app is opened during a run, abortForLiveApp() destroys this WebView,
// on the main thread, before the app's own loads. Two pages must never work
// on the same storage at once.
class RefreshWorker(private val appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    // One headless WebView and its outcome.
    class Run {
        @Volatile var abortRequested = false
            private set
        // Set by the first bridge call: the page is running the headless root.
        @Volatile var started = false
            private set
        @Volatile var rendererGone = false
        @Volatile var webView: WebView? = null
        // The page's own report, or null when the worker had to decide.
        val done = CompletableDeferred<String?>()

        fun markStarted() { started = true }
        fun finish(json: String?) { done.complete(json) }

        // Main thread only.
        fun abort() {
            abortRequested = true
            teardown()
            done.complete(null)
        }

        fun teardown() {
            val wv = webView ?: return
            webView = null
            try {
                wv.stopLoading()
                wv.loadUrl("about:blank")
                wv.destroy()
            } catch (e: Exception) {
                Log.w(TAG, "headless WebView teardown", e)
            }
        }
    }

    override suspend fun doWork(): Result {
        val trigger = inputData.getString(KEY_TRIGGER) ?: TRIGGER_ROUTINE
        val launcherId = inputData.getString(KEY_LAUNCHER_ID)
        val now = System.currentTimeMillis()
        val decision = RefreshPolicy.decide(appOpen, trigger == TRIGGER_ON_DEMAND, SharedDataStore.lastRefreshAt(appContext), now)
        when (decision) {
            // The app's own page exists, so it does the work itself: a second
            // page on the same storage is exactly what must not happen. It is
            // asked, and this job stays alive a little while so the process is
            // not put back to sleep under it.
            is RefreshPolicy.Decision.AppIsOpen -> {
                // Opened between the launcher's request and this run: the app
                // syncs as it opens, so the request is answered by that.
                answerLauncher(launcherId, "aborted", "app opened", now)
                if (WidgetBridgePlugin.askLiveAppToRefresh()) delay(LIVE_REFRESH_HOLD_MS)
                return Result.success()
            }
            // Too soon after the last run. What was asked for is not dropped:
            // one more run is set for when the floor has passed, and it will
            // carry everything queued by then.
            is RefreshPolicy.Decision.Throttled -> {
                requestLater(appContext, RefreshPolicy.ON_DEMAND_FLOOR_MS - decision.sinceLastMs)
                return Result.success()
            }
            is RefreshPolicy.Decision.Run -> run(trigger, now, launcherId)
        }
        return Result.success()
    }

    // Writes how a run went where GLANCElauncher reads it.
    private fun answerLauncher(clientId: String?, outcome: String, reason: String?, startedAt: Long) {
        if (clientId == null) return
        val entry = SharedDataStore.launcherRefreshEntry(appContext, clientId) ?: return
        SharedDataStore.patchLauncherRefresh(appContext, clientId, LauncherRefresh.finished(entry, outcome, reason, startedAt, System.currentTimeMillis()))
        LauncherProvider.changed(appContext)
    }

    private suspend fun run(trigger: String, startedAt: Long, launcherId: String?) {
        // Stamped at the start, so a run that crashes still counts.
        SharedDataStore.setLastRefreshAt(appContext, startedAt)
        val run = Run()
        val booted = withContext(Dispatchers.Main) {
            // The same thread as MainActivity.onCreate: either the app is
            // already up, or an app that opens from here on finds `current`.
            if (appOpen) return@withContext false
            current = run
            run.webView = buildWebView(run)
            run.webView?.loadUrl(ENTRY)
            true
        }
        if (!booted) {
            answerLauncher(launcherId, "aborted", "app opened", startedAt)
            return
        }
        // The launcher's page says a refresh is under way.
        LauncherProvider.changed(appContext)

        val reported = withTimeoutOrNull(RefreshPolicy.CAP_MS) {
            val starting = withTimeoutOrNull(RefreshPolicy.BOOT_MS) {
                while (!run.started && !run.done.isCompleted) delay(250)
            }
            if (starting == null) null else run.done.await()
        }
        val timedOut = !run.done.isCompleted
        withContext(Dispatchers.Main) {
            if (current === run) current = null
            run.teardown()
        }
        val fallback = if (reported == null) RefreshPolicy.unreported(run.abortRequested, timedOut, run.rendererGone, run.started) else null
        val entry = RefreshPolicy.entry(trigger, startedAt, System.currentTimeMillis(), reported, fallback)
        SharedDataStore.appendRefreshLog(appContext, entry)
        answerLauncher(launcherId, entry.optString("outcome", "failed"), if (entry.has("reason")) entry.optString("reason") else null, startedAt)
        Log.i(TAG, "background refresh: $entry")
    }

    private fun buildWebView(run: Run): WebView {
        val assets = assetLoader(appContext)
        val webView = WebView(appContext)
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            // The headless page never navigates anywhere else.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != HOST && request.url.toString() != "about:blank"

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                run.rendererGone = true
                run.webView = null
                run.finish(null)
                return true
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    Log.w(TAG, "headless js: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                }
                return true
            }
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        // Through the main Looper, never webView.post: a View that is not
        // attached to a window holds its posted work until it is, and this one
        // never is. (The sibling apps' first device run hung on exactly that.)
        val bridge = HeadlessBridge(appContext, run) { json ->
            mainHandler.post {
                run.webView?.evaluateJavascript("window.__tgHeadlessHttpDone && window.__tgHeadlessHttpDone($json)", null)
            }
        }
        webView.addJavascriptInterface(bridge, "ThingGlanceHeadless")
        return webView
    }

    companion object {
        private const val TAG = "ThingGlanceRefresh"
        private const val ROUTINE_WORK = "thingglance-refresh-routine"
        private const val ON_DEMAND_WORK = "thingglance-refresh-on-demand"
        private const val KEY_TRIGGER = "trigger"
        private const val KEY_LAUNCHER_ID = "launcherClientId"
        const val TRIGGER_LAUNCHER = "launcher"
        private const val LIVE_REFRESH_HOLD_MS = 20_000L
        const val TRIGGER_ROUTINE = "routine"
        const val TRIGGER_ON_DEMAND = "home-screen"
        // Capacitor's origin: the app's storage lives there.
        private const val HOST = "localhost"
        private const val ENTRY = "https://$HOST/index.html?headless=refresh"
        private val mainHandler = Handler(Looper.getMainLooper())

        // The run in progress, if any. Written on the main thread.
        @Volatile private var current: Run? = null

        // True while the app's own page exists (MainActivity sets it).
        @JvmStatic @Volatile var appOpen: Boolean = false

        // True while a background run's page exists.
        @JvmStatic val running: Boolean get() = current != null

        // Called first thing in MainActivity.onCreate, on the main thread,
        // before the app's own page loads: a run in progress is destroyed.
        @JvmStatic
        fun abortForLiveApp() {
            appOpen = true
            current?.abort()
            current = null
        }

        // The routine run. Asking again changes nothing (KEEP), so the app
        // asks every time it starts.
        @JvmStatic
        fun ensureRoutine(context: Context) {
            val request = PeriodicWorkRequestBuilder<RefreshWorker>(RefreshPolicy.PERIOD_HOURS, TimeUnit.HOURS)
                .setInputData(Data.Builder().putString(KEY_TRIGGER, TRIGGER_ROUTINE).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(ROUTINE_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        // The routine run, once, now. Periodic work cannot be run ahead of its
        // schedule, so a test (the debug build's DebugRefreshReceiver) asks
        // for the same work as a one-off.
        @JvmStatic
        fun runRoutineNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<RefreshWorker>()
                .setInputData(Data.Builder().putString(KEY_TRIGGER, TRIGGER_ROUTINE).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("thingglance-refresh-now", ExistingWorkPolicy.REPLACE, request)
        }

        // Something was done on the home screen with the app closed: run soon,
        // once there is a network, so it reaches the vault. One queued run
        // answers every tick made while it waits.
        @JvmStatic
        fun requestSoon(context: Context) {
            if (appOpen) return
            val request = OneTimeWorkRequestBuilder<RefreshWorker>()
                .setInputData(Data.Builder().putString(KEY_TRIGGER, TRIGGER_ON_DEMAND).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(ON_DEMAND_WORK, ExistingWorkPolicy.KEEP, request)
        }

        // GLANCElauncher asked for a refresh and the app is not running. The
        // receiver has already decided it is not too soon and logged the
        // request under `clientId`; the run writes its outcome there.
        // Expedited from Android 12 (a plain job there), so it starts now
        // and not when Android next runs jobs; the launcher's permission does
        // not exist before 12.
        @JvmStatic
        fun requestForLauncher(context: Context, clientId: String) {
            val request = OneTimeWorkRequestBuilder<RefreshWorker>()
                .setInputData(Data.Builder().putString(KEY_TRIGGER, TRIGGER_LAUNCHER).putString(KEY_LAUNCHER_ID, clientId).build())
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) request.setExpedited(androidx.work.OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            WorkManager.getInstance(context).enqueueUniqueWork("thingglance-refresh-launcher", ExistingWorkPolicy.KEEP, request.build())
        }

        // The run that follows a throttled one. Its own name, because the work
        // asking for it is still running under the other.
        private fun requestLater(context: Context, delayMs: Long) {
            val request = OneTimeWorkRequestBuilder<RefreshWorker>()
                .setInputData(Data.Builder().putString(KEY_TRIGGER, TRIGGER_ON_DEMAND).build())
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(maxOf(1_000L, delayMs), TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("$ON_DEMAND_WORK-later", ExistingWorkPolicy.KEEP, request)
        }

        // The app's web files (assets/public, where `cap sync` puts them) at
        // Capacitor's origin.
        private fun assetLoader(context: Context): WebViewAssetLoader =
            WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/", WebViewAssetLoader.PathHandler { path ->
                    val file = path.ifEmpty { "index.html" }
                    try {
                        WebResourceResponse(mimeOf(file), "utf-8", context.assets.open("public/$file"))
                    } catch (e: Exception) {
                        null
                    }
                })
                .build()

        private fun mimeOf(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
            "html" -> "text/html"
            "js", "mjs" -> "application/javascript"
            "css" -> "text/css"
            "json", "webmanifest" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            else -> "application/octet-stream"
        }
    }
}
