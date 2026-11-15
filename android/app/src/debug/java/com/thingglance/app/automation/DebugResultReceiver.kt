package com.thingglance.app.automation

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.json.JSONObject

// A test hook, in debug builds only: writes each RESULT addressed to this
// app's own package to the log, where scripts/android-check.mjs reads it.
// It stands in for the automation app on an emulator that has none.
class DebugResultReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val result = intent.getStringExtra("result") ?: ""
        Log.i("TgAutomationResult", (intent.getStringExtra("action") ?: "") + " " + brief(result))
    }

    // A log line holds about four thousand characters and a snapshot is
    // longer: keep its counts, and how long the whole answer was.
    private fun brief(result: String): String = try {
        val parsed = JSONObject(result)
        val snapshot = parsed.optJSONObject("snapshot")
        if (snapshot == null) result
        else parsed.put("snapshot", JSONObject().put("version", snapshot.opt("version")).put("counts", snapshot.opt("counts"))).put("_length", result.length).toString()
    } catch (e: Exception) {
        result.take(3000)
    }
}
