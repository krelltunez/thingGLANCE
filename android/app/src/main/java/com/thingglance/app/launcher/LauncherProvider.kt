package com.thingglance.app.launcher

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.UriMatcher
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import com.thingglance.app.SharedDataStore
import com.thingglance.app.refresh.RefreshWorker

// The read-only face GLANCElauncher sees (docs/launcher.md):
// content://com.thingglance.app.launcher/<collection> serves the rows
// LauncherRows maps out of the payload the app last handed over. Every change
// notifies the authority, so the launcher's observer sees it without polling.
//
// Guarded in the manifest by com.thingglance.permission.LAUNCHER, which only
// the launcher's signing certificate holds. Nothing is ever inserted, updated
// or deleted here: writes go through LauncherIntentReceiver.
class LauncherProvider : ContentProvider() {

    private val matcher = UriMatcher(UriMatcher.NO_MATCH).apply {
        for (c in LauncherRows.COLLECTIONS) addURI(LauncherRows.AUTHORITY, c, 1)
    }

    override fun onCreate(): Boolean = true

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? {
        if (matcher.match(uri) != 1) return null
        val ctx = context ?: return null
        val collection = uri.lastPathSegment ?: return null
        val rows = LauncherRows.rows(SharedDataStore.readWidgetPayload(ctx), collection, live(ctx)) ?: return null
        val cursor = MatrixCursor(LauncherRows.COLUMNS, rows.size)
        rows.forEachIndexed { i, row -> cursor.addRow(arrayOf<Any?>(i, row.id, row.json)) }
        cursor.setNotificationUri(ctx.contentResolver, CONTENT_URI)
        return cursor
    }

    override fun getType(uri: Uri): String? =
        if (matcher.match(uri) == 1) "vnd.android.cursor.dir/vnd.thingglance.${uri.lastPathSegment}" else null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = throw UnsupportedOperationException("read-only")
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("read-only")
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = throw UnsupportedOperationException("read-only")

    companion object {
        // Observers register here, and every change notifies it.
        val CONTENT_URI: Uri = Uri.parse("content://${LauncherRows.AUTHORITY}")

        // What is only known at the moment of a read.
        fun live(context: Context): LauncherRows.Live = LauncherRows.Live(
            checkedAt = SharedDataStore.launcherCheckedAt(context),
            syncedAt = SharedDataStore.launcherSyncedAt(context),
            refreshLog = SharedDataStore.launcherRefreshLog(context),
            rendererAlive = RefreshWorker.appOpen,
            headlessRunning = RefreshWorker.running,
            cleared = SharedDataStore.pendingDecideKeys(context),
            sending = SharedDataStore.pendingSendKeys(context),
        )

        // Something the launcher shows has changed. Safe from anywhere: with
        // no launcher installed there is nobody listening.
        fun changed(context: Context) {
            try {
                context.contentResolver.notifyChange(CONTENT_URI, null)
            } catch (e: Exception) {
                // A provider that is not up yet has no observers to miss it.
            }
        }
    }
}
