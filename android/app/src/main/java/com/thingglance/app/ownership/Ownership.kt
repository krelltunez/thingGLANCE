package com.thingglance.app.ownership

import android.content.Context
import android.os.Build

// "Owned since": the record that this copy of the app was bought.
//
// thingGLANCE is sold for one price, with no paywall, so nothing checks this.
// It is written so that, if the app ever became free with a paywall, the
// people who paid for it could be told apart from the people who did not:
// Google Play does not tell an app whether its user once bought it
// (docs/release.md, "Owned since").
//
// A purchase is taken to be an install made by the Play Store. A build put on
// the phone any other way (adb, a downloaded APK) records nothing. The date is
// when Android first installed the app.
//
// Kept in a preferences file of its own, which, unlike the app's other files,
// IS left in Android's cloud backup and in a phone-to-phone transfer
// (res/xml/data_extraction_rules.xml): it holds no user data, and it is the
// one thing that should follow the buyer to a new phone. The web app also
// copies it into the vault (src/native/ownership.ts).
object Ownership {
    const val PREFS = "thingglance_owned"
    private const val KEY_SINCE = "since"
    private const val KEY_STORE = "store"
    private const val KEY_VERSION = "version"

    const val PLAY_STORE = "com.android.vending"

    data class Fact(val since: Long, val store: String, val version: String)

    // Which store, if any, an installer is.
    fun storeOf(installer: String?): String? = if (installer == PLAY_STORE) "play" else null

    // The record to hold from here on: the one already held, whatever it says,
    // or a new one when a store installed the app. Null when neither.
    fun settle(existing: Fact?, installer: String?, firstInstallTime: Long, version: String): Fact? =
        existing ?: storeOf(installer)?.takeIf { firstInstallTime > 0 }?.let { Fact(firstInstallTime, it, version) }

    fun read(context: Context): Fact? {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val since = prefs.getLong(KEY_SINCE, 0L)
        val store = prefs.getString(KEY_STORE, null)
        return if (since > 0 && !store.isNullOrEmpty()) Fact(since, store, prefs.getString(KEY_VERSION, "") ?: "") else null
    }

    // Reads the record, writing it first if this is the start that finds out.
    fun ensure(context: Context): Fact? {
        val existing = read(context)
        if (existing != null) return existing
        val fact = try {
            val info = context.packageManager.getPackageInfo(context.packageName, 0)
            settle(null, installer(context), info.firstInstallTime, info.versionName ?: "")
        } catch (e: Exception) {
            null
        } ?: return null
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putLong(KEY_SINCE, fact.since).putString(KEY_STORE, fact.store).putString(KEY_VERSION, fact.version).apply()
        return fact
    }

    @Suppress("DEPRECATION")
    private fun installer(context: Context): String? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        else context.packageManager.getInstallerPackageName(context.packageName)
}
