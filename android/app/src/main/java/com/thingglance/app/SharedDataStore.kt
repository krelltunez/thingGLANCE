package com.thingglance.app

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

// What the web app has handed over for surfaces that cannot run it: today, the
// widget payload (src/native/widgetBridge.ts). A private preferences file,
// left out of cloud backup (res/xml/data_extraction_rules.xml): it carries
// names and dates, and the app rewrites it on first open.
object SharedDataStore {
    private const val PREFS = "thingglance_shared"
    private const val KEY_WIDGETS = "widget_payload"

    // Counts writes. A widget that is already drawn keeps its composition alive
    // for a while, and asking it to update only recomposes it: it would draw
    // the payload it read when it started. Widgets watch this so a write is
    // read again (glance/WidgetData.kt: rememberWidgetData).
    private val writes = MutableStateFlow(0)
    val changes: StateFlow<Int> get() = writes

    fun writeWidgetPayload(context: Context, json: String) {
        prefs(context).edit().putString(KEY_WIDGETS, json).apply()
        writes.value += 1
    }

    fun readWidgetPayload(context: Context): String? = prefs(context).getString(KEY_WIDGETS, null)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
