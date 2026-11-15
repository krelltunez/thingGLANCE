package com.thingglance.app.tiles

import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import com.thingglance.app.R
import com.thingglance.app.glance.ADD_LINK
import com.thingglance.app.glance.QUEUE_LINK
import com.thingglance.app.glance.WidgetSnapshot
import com.thingglance.app.glance.openLinkIntent

// Quick Settings tiles. Each opens the app at a thingglance:// link, the same
// ones the widgets and shortcuts use, and changes nothing itself.
//
// A tile's words come from the payload the app wrote for the widgets, so they
// are in the app's language; the names in the manifest are only what Android
// shows before the app has ever run. A tile is drawn when the panel opens, so
// it reads the payload then and needs no telling when it changes.

// Which tiles there are, for the "add to Quick Settings" buttons in Settings.
internal data class TileSpec(val service: Class<out TileService>, val icon: Int)

internal val TILES: Map<String, TileSpec> = mapOf(
    "decide" to TileSpec(DecideTileService::class.java, R.drawable.ic_stat_notify),
    "add" to TileSpec(AddThingTileService::class.java, R.drawable.ic_widget_add),
)

// A tile's name in the app's language, as far as the payload knows it.
internal fun tileLabel(kind: String, labels: com.thingglance.app.glance.WidgetLabels): String =
    if (kind == "add") labels.addThing else labels.decideTitle

private fun TileService.open(link: String) {
    val launch = {
        val intent = openLinkIntent(this, link)
        if (Build.VERSION.SDK_INT >= 34) {
            startActivityAndCollapse(PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        } else {
            @Suppress("DEPRECATION", "StartActivityAndCollapseDeprecated")
            startActivityAndCollapse(intent)
        }
    }
    // On a locked phone the app opens once it is unlocked, not over the lock.
    if (isLocked) unlockAndRun { launch() } else launch()
}

// "Needs a decision": how many dates are waiting, lit when any are. A tap
// opens the queue.
class DecideTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile ?: return
        val data = WidgetSnapshot.read(this)
        tile.label = data.labels.decideTitle
        tile.state = if (data.attentionCount > 0) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
        // Nothing is said about a queue the app has not told us about yet.
        if (Build.VERSION.SDK_INT >= 29) tile.subtitle = if (data.loaded) data.waitingText else null
        tile.updateTile()
    }

    override fun onClick() {
        super.onClick()
        open(QUEUE_LINK)
    }
}

// "Add a thing": a tap opens the add form.
class AddThingTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        val tile = qsTile ?: return
        tile.label = WidgetSnapshot.read(this).labels.addThing
        // Not a switch: it is never "on".
        tile.state = Tile.STATE_INACTIVE
        tile.updateTile()
    }

    override fun onClick() {
        super.onClick()
        open(ADD_LINK)
    }
}
