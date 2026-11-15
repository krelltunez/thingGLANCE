package com.thingglance.app.launcher

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.thingglance.app.MainActivity
import com.thingglance.app.SharedDataStore
import com.thingglance.app.refresh.RefreshWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

// Closes the app's own page when it has stopped answering in the background,
// and hands the work to a background run, as a swipe from Recents would.
//
// A backgrounded WebView can stop answering its bridge for hours while still
// running a script handed to it directly (seen on the emulator a minute after
// the app was left, as the sibling apps saw it on phones). Held awake or not,
// such a page never applies a write GLANCElauncher sent and never runs the
// refresh it asked for. A background run does both, but must never share
// storage with a live page: so the page goes first.
//
// Closing it is safe only when nothing is lost, so every step must hold or
// the page is left as it is:
//   - the app has been in the background for a while (LauncherRefresh.mayRetire),
//     long after anything it was saving has landed;
//   - the page answers the check "ok": it runs, and has no form or sheet open
//     (src/native/widgetBridge.ts);
//   - it is still in the background on the main thread, just before it closes.
// The page is closed with finish(), so the next open starts fresh from
// storage, which the background run keeps current.
object LauncherPageRetire {
    private const val TAG = "ThingGlanceLauncher"
    private const val CHECK_TIMEOUT_MS = 3_000L
    private const val CLOSE_TIMEOUT_MS = 5_000L

    // After a hold that ended with the work not done. `refreshId` is the
    // REFRESH it was for, or null for a write. Never throws.
    suspend fun closeIfUnresponsive(context: Context, refreshId: String?) {
        try {
            val activity = MainActivity.liveInstance() ?: return
            if (!LauncherRefresh.mayRetire(MainActivity.stoppedAt, System.currentTimeMillis())) return
            val check = withTimeoutOrNull(CHECK_TIMEOUT_MS) {
                suspendCancellableCoroutine<String?> { cont ->
                    Handler(Looper.getMainLooper()).post { activity.checkRetireReady { if (cont.isActive) cont.resume(it) } }
                }
            }
            if (!LauncherRefresh.pageReady(check)) {
                note(context, refreshId) { LauncherRefresh.kept(it, if (check == null) "it did not answer the check" else "it has something open") }
                return
            }
            // Opened in the meantime: the page is live again and syncs as it opens.
            val closing = withContext(Dispatchers.Main) {
                if (MainActivity.stoppedAt == 0L || activity.isFinishing) false else { activity.finish(); true }
            }
            if (!closing) return
            withTimeoutOrNull(CLOSE_TIMEOUT_MS) { while (RefreshWorker.appOpen) delay(100) }
            if (RefreshWorker.appOpen) {
                note(context, refreshId) { LauncherRefresh.kept(it, "it did not close") }
                return
            }
            if (refreshId != null) {
                note(context, refreshId) { LauncherRefresh.retired(it) }
                // The run that follows is its own entry, as for a closed app.
                val follow = LauncherRefresh.headlessFollowUp(refreshId, System.currentTimeMillis())
                SharedDataStore.appendLauncherRefresh(context, follow)
                RefreshWorker.requestForLauncher(context, follow.getString("clientId"))
            } else {
                // A write is waiting in the queue: the run applies it.
                RefreshWorker.requestSoon(context)
            }
            Log.i(TAG, "closed the unresponsive page, background run scheduled")
        } catch (e: Exception) {
            Log.w(TAG, "could not close the unresponsive page", e)
        } finally {
            LauncherProvider.changed(context)
        }
    }

    private fun note(context: Context, refreshId: String?, patch: (org.json.JSONObject) -> org.json.JSONObject) {
        if (refreshId == null) return
        val entry = SharedDataStore.launcherRefreshEntry(context, refreshId) ?: return
        SharedDataStore.patchLauncherRefresh(context, refreshId, patch(entry))
    }
}
