package com.thingglance.app.glance

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.LinearLayout
import android.widget.ListView
import androidx.appcompat.app.AppCompatActivity
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Shown when a single-thing widget is placed: which thing should it show?
// The first choice is "automatic" (the thing closest to the end of its
// window); the rest are the things in the snapshot the app last wrote. A plain
// list, shown as a dialog. Its words come from the app with the snapshot, so
// they are in the app's language.
class ThingConfigActivity : AppCompatActivity() {
    private var appWidgetId = AppWidgetManager.INVALID_APPWIDGET_ID

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Backing out cancels the placement.
        setResult(RESULT_CANCELED)
        appWidgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            finish()
            return
        }
        val pad = (16 * resources.displayMetrics.density).toInt()
        val list = ListView(this)
        setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad, pad, 0)
            addView(list, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT))
        })
        // The snapshot is read off the main thread: a disk read and a parse.
        MainScope().launch {
            val data = withContext(Dispatchers.IO) { WidgetSnapshot.read(this@ThingConfigActivity) }
            title = data.labels.thingPick
            val things = data.things.sortedBy { it.name.lowercase() }
            // (id, label); a null id is "automatic".
            val choices: List<Pair<String?, String>> = listOf<Pair<String?, String>>(null to data.labels.thingAuto) + things.map { it.id to it.name }
            list.adapter = ArrayAdapter(this@ThingConfigActivity, android.R.layout.simple_list_item_1, choices.map { it.second })
            list.setOnItemClickListener { _, _, position, _ -> choose(choices[position].first) }
        }
    }

    private fun choose(thingId: String?) {
        MainScope().launch {
            val glanceId = GlanceAppWidgetManager(this@ThingConfigActivity).getGlanceIdBy(appWidgetId)
            updateAppWidgetState(this@ThingConfigActivity, glanceId) { prefs ->
                if (thingId == null) prefs.remove(THING_PREF_KEY) else prefs[THING_PREF_KEY] = thingId
            }
            ThingWidget().update(this@ThingConfigActivity, glanceId)
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
            finish()
        }
    }
}
