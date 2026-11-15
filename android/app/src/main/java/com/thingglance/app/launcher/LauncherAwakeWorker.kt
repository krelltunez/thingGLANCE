package com.thingglance.app.launcher

import android.content.Context
import android.os.Build
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.thingglance.app.SharedDataStore
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull

// Keeps the app awake while its own page answers GLANCElauncher.
//
// With the page alive, the receiver hands the work to it: a write to apply, a
// refresh to run. But Android freezes a backgrounded app, its WebView
// included, a couple of minutes after it goes idle. The receiver is thawed
// for the broadcast; the page is not, and the request would wait until the
// app is next opened. An app running a job is not frozen, so the receiver
// also starts this one. It does nothing but wait for the page to finish, and
// then ends so the app can be frozen again.
//
// It runs nothing itself. The work is the app's own, in its one page, as when
// the app is on screen. Modelled on the sibling apps' LauncherAwakeWorker.
class LauncherAwakeWorker(private val appContext: Context, params: WorkerParameters) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val clientId = inputData.getString(KEY_CLIENT_ID) ?: return Result.success()
        val what = inputData.getString(KEY_FOR) ?: FOR_REFRESH
        val heldFrom = System.currentTimeMillis()
        val finished = withTimeoutOrNull(if (what == FOR_WRITE) WRITE_HOLD_MS else LauncherRefresh.INFLIGHT_MS) {
            while (!done(what, clientId)) delay(POLL_MS)
            true
        } ?: false
        if (!finished) {
            // A refresh is not left reading "queued" for ever: say it went
            // unanswered. A write needs no such note: it stays queued.
            if (what == FOR_REFRESH) {
                if (!SharedDataStore.launcherRefreshUnanswered(appContext, clientId, heldFrom, System.currentTimeMillis())) return Result.success()
                LauncherProvider.changed(appContext)
            }
            // A backgrounded page that stopped answering is closed, when that
            // loses nothing, and a background run does the work instead.
            LauncherPageRetire.closeIfUnresponsive(appContext, if (what == FOR_REFRESH) clientId else null)
        }
        return Result.success()
    }

    private fun done(what: String, clientId: String): Boolean =
        if (what == FOR_WRITE) !SharedDataStore.isPendingWrite(appContext, clientId)
        else LauncherRefresh.answered(SharedDataStore.launcherRefreshEntry(appContext, clientId))

    companion object {
        private const val KEY_CLIENT_ID = "clientId"
        private const val KEY_FOR = "for"
        const val FOR_REFRESH = "refresh"
        const val FOR_WRITE = "write"
        private const val WRITE_HOLD_MS = 20_000L
        private const val POLL_MS = 500L

        // One hold per kind: a newer request replaces an older one's hold.
        fun hold(context: Context, what: String, clientId: String) {
            val request = OneTimeWorkRequestBuilder<LauncherAwakeWorker>()
                .setInputData(Data.Builder().putString(KEY_CLIENT_ID, clientId).putString(KEY_FOR, what).build())
            // Expedited, so it starts now and not when Android next feels like
            // running jobs. From Android 12 that is a plain job; before it,
            // it would need a foreground notification, and the launcher's
            // permission does not exist there anyway.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) request.setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            try {
                WorkManager.getInstance(context).enqueueUniqueWork("thingglance-launcher-awake-$what", ExistingWorkPolicy.REPLACE, request.build())
            } catch (e: Exception) {
                // No hold: the page answers when it next wakes.
            }
        }
    }
}
