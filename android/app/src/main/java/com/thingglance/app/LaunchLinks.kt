package com.thingglance.app

import android.content.Intent
import android.net.Uri

// Turns the ways Android can start the app into the one thing the web app
// understands: a thingglance:// link (docs/links-and-intents.md). The web side
// has a single router for links, so nothing here opens a screen itself.
//
//   - Something shared from another app (a product page, a name) becomes
//     "add a thing, with this name".
//   - An intent Android is replaying (the activity being rebuilt after the
//     system killed it, or reopened from Recents) is stripped: the link it
//     carried was acted on the first time, and acting on it again would reopen
//     a form the user closed hours ago.
object LaunchLinks {
    private const val MAX_NAME = 200
    private val URL = Regex("""https?://\S+""", RegexOption.IGNORE_CASE)

    fun forLaunch(intent: Intent?, restored: Boolean): Intent? {
        if (intent == null) return null
        val replayed = restored || (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0
        if (replayed && carriesSomething(intent)) return Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return asLink(intent)
    }

    // A share becomes a VIEW of an "add" link; anything else is left alone.
    fun asLink(intent: Intent?): Intent? {
        if (intent == null || intent.action != Intent.ACTION_SEND) return intent
        if (intent.type?.startsWith("text/") != true) return intent
        val name = sharedName(intent.getStringExtra(Intent.EXTRA_SUBJECT), intent.getStringExtra(Intent.EXTRA_TEXT))
        return Intent(Intent.ACTION_VIEW, Uri.parse(addLink(name))).setPackage(intent.`package`).setComponent(intent.component)
    }

    private fun carriesSomething(intent: Intent): Boolean =
        intent.action == Intent.ACTION_SEND || (intent.action == Intent.ACTION_VIEW && intent.data != null)

    fun addLink(name: String?): String =
        if (name.isNullOrEmpty()) "thingglance://action/add" else "thingglance://action/add?name=" + Uri.encode(name)

    // What to call the thing. A browser shares the page title as the subject
    // and the address as the text; a shopping app often shares "Name https://…"
    // as the text alone. The title wins, then the text without its links. A
    // bare address names nothing, so the form opens empty.
    fun sharedName(subject: String?, text: String?): String? {
        val candidate = sequenceOf(subject, text?.let { URL.replace(it, " ") })
            .map { it?.replace(Regex("""\s+"""), " ")?.trim().orEmpty() }
            .firstOrNull { it.isNotEmpty() } ?: return null
        return if (candidate.length <= MAX_NAME) candidate else candidate.substring(0, MAX_NAME).trim()
    }
}
