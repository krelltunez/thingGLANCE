package com.thingglance.app.refresh

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// Debug builds only (this file and its manifest entry live under src/debug, so
// neither is in a release build): lets a test run the routine refresh now.
// Android will not run periodic work ahead of its schedule, however it is
// asked, and the schedule is hours.
//
//   adb shell am broadcast -n com.thingglance.app/.refresh.DebugRefreshReceiver
class DebugRefreshReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        RefreshWorker.runRoutineNow(context)
    }
}
