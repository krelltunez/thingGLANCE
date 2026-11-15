package com.thingglance.app.launcher

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.thingglance.app.SharedDataStore
import com.thingglance.app.WidgetBridgePlugin
import com.thingglance.app.refresh.RefreshWorker
import org.json.JSONObject

// Where GLANCElauncher's writes land (docs/launcher.md). Beside the
// automation receiver, and sharing its queue, with two differences:
//
//   - It sits behind com.thingglance.permission.LAUNCHER in the manifest, so
//     only the launcher can reach it, and it does not consult the automation
//     switch: that switch is for the door every app on the phone can knock on.
//   - It sends no answer back. The launcher keeps each write in its outbox and
//     reads how it went from the next snapshot (meta.handledWrites).
//
// Like every other surface it applies nothing itself: a write is queued as
// { action, payload, clientId } and the app applies it through its one door
// for outside writes, once, however many times the launcher re-sends it.
//
// Actions: com.thingglance.app.launcher.DECIDE, .SEND and .REFRESH (not a
// write: "confirm your data now").
class LauncherIntentReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action !in ACTIONS) return
        val clientId = intent.getStringExtra("clientId")?.takeIf { it.isNotBlank() }
        if (clientId == null) {
            Log.w(TAG, "dropped $action: no clientId")
            return
        }
        if (action == ACTION_REFRESH) {
            refresh(context, clientId)
            return
        }
        val entry = write(action, intent.getStringExtra("payload"), clientId) ?: return
        // Already waiting under this id: the launcher is re-sending, because
        // nobody has applied it yet. It is not queued twice, but whoever should
        // apply it is nudged again.
        if (SharedDataStore.queueLauncher(context, entry)) {
            // A date cleared here leaves the widgets at once, like a tick on one.
            WidgetBridgePlugin.refreshAll(context)
            LauncherProvider.changed(context)
        }
        if (RefreshWorker.appOpen) {
            // The app's page applies it. A backgrounded app is frozen within
            // minutes, and the nudge would sit unread: hold it awake until the
            // write has left the queue.
            WidgetBridgePlugin.announcePendingWrites()
            LauncherAwakeWorker.hold(context, LauncherAwakeWorker.FOR_WRITE, clientId)
        } else {
            // Nothing running: a background refresh applies it and carries it
            // to the vault.
            RefreshWorker.requestSoon(context)
        }
    }

    // REFRESH, routed by whether the app's page exists. With one, the page is
    // asked and held awake while it answers. With none, a background run is
    // scheduled, at most every ten minutes. Either way the request is logged
    // and the launcher reads the outcome from meta.refreshLog.
    private fun refresh(context: Context, clientId: String) {
        val now = System.currentTimeMillis()
        val appOpen = RefreshWorker.appOpen
        val route = SharedDataStore.logLauncherRefresh(context, clientId, now, appOpen) ?: return
        when (route) {
            is LauncherRefresh.Route.Queued -> {
                LauncherAwakeWorker.hold(context, LauncherAwakeWorker.FOR_REFRESH, clientId)
                if (!WidgetBridgePlugin.askLiveAppForLauncherRefresh(clientId)) {
                    // The activity is there and its bridge is not: nobody to ask.
                    SharedDataStore.patchLauncherRefresh(context, clientId, JSONObject().put("outcome", LauncherRefresh.UNANSWERED).put("finishedAt", now).put("reason", "the app is starting or stopping: there was no page to ask"))
                }
            }
            is LauncherRefresh.Route.Scheduled -> try {
                RefreshWorker.requestForLauncher(context, clientId)
            } catch (e: Exception) {
                Log.w(TAG, "could not schedule a background refresh", e)
                SharedDataStore.patchLauncherRefresh(context, clientId, JSONObject().put("outcome", LauncherRefresh.DEFERRED).put("finishedAt", now).put("reason", "the app is not running, and no background refresh could be scheduled: ${e.message}"))
            }
            else -> Unit
        }
        LauncherProvider.changed(context)
    }

    companion object {
        private const val TAG = "ThingGlanceLauncher"
        const val ACTION_DECIDE = "com.thingglance.app.launcher.DECIDE"
        const val ACTION_SEND = "com.thingglance.app.launcher.SEND"
        const val ACTION_REFRESH = "com.thingglance.app.launcher.REFRESH"
        val ACTIONS = setOf(ACTION_DECIDE, ACTION_SEND, ACTION_REFRESH)
        private val STATES = setOf("done", "dismissed", "restore")

        // A write as the queue holds it, or null when it names no date. The
        // payload is rebuilt field by field, so nothing else rides in on it.
        internal fun write(action: String, rawPayload: String?, clientId: String): JSONObject? {
            val given = try { JSONObject(rawPayload ?: "{}") } catch (e: Exception) { return null }
            val key = given.optString("event_key").takeIf { it.isNotBlank() } ?: return null
            val payload = JSONObject().put("event_key", key)
            val name = when (action) {
                ACTION_DECIDE -> {
                    payload.put("state", given.optString("state").takeIf { it in STATES } ?: "done")
                    SharedDataStore.ACTION_DECIDE
                }
                ACTION_SEND -> SharedDataStore.ACTION_SEND
                else -> return null
            }
            return JSONObject().put("action", name).put("clientId", clientId).put("payload", payload).put("from", "launcher")
        }
    }
}
