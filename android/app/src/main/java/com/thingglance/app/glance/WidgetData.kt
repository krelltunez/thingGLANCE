package com.thingglance.app.glance

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import com.thingglance.app.MainActivity
import com.thingglance.app.SharedDataStore
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.GregorianCalendar
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.roundToInt

// What the widgets draw, read from the payload the web app wrote
// (src/native/widgetBridge.ts): the snapshot of docs/snapshot.md plus the
// widgets' own words in the app's language.
//
// Nothing here is translated. Titles and details arrive as text; the labels
// arrive with them. Two things are worked out on the spot, because a widget is
// drawn long after the app last ran: how many days away each date is, and how
// that date is written.

internal data class WidgetEvent(
    val key: String,
    val type: String,
    val date: String,
    val title: String,
    val detail: String,
    val state: String,
    val link: String,
)

// One charge a plan will make (snapshot: charges.items).
internal data class WidgetCharge(val subscriptionId: String, val name: String, val date: String, val amount: Double, val link: String)

// One thing (snapshot: things). `remaining` is the share of its window left,
// 0 to 1, and `lifeEnd` the day that window closes; both null with no dates.
internal data class WidgetThing(val id: String, val name: String, val verdict: String, val remaining: Double?, val lifeEnd: String?)

internal data class WidgetLabels(
    val decideTitle: String,
    val decideEmpty: String,
    val nextTitle: String,
    val nextEmpty: String,
    val today: String,
    // What the buttons on a row are called, for screen readers, and what a
    // date already handed to dayGLANCE is marked with.
    val done: String,
    val send: String,
    val sent: String,
    val days: String,
    val months: String,
    val years: String,
    // The newer widgets.
    val addThing: String = "Add a thing",
    val chargesTitle: String = "Plans, next 30 days",
    val chargesEmpty: String = "Nothing due in the next 30 days",
    val thingTitle: String = "A single thing",
    val thingPick: String = "Which thing?",
    val thingAuto: String = "Closest to the end of its window",
    val thingNone: String = "No things yet",
    val thingGone: String = "No longer tracked",
    // A verdict's name by its code.
    val verdicts: Map<String, String> = emptyMap(),
)

internal data class WidgetData(
    // False until the app has been opened once and written a payload.
    val loaded: Boolean,
    val locale: Locale,
    // True when the app is connected to dayGLANCE: only then is there a
    // "send" to offer.
    val canSend: Boolean,
    val labels: WidgetLabels,
    val attention: List<WidgetEvent>,
    val upcoming: List<WidgetEvent>,
    // ISO 4217, for every amount.
    val currency: String = "USD",
    val chargesTotal: Double = 0.0,
    val chargesCount: Int = 0,
    val charges: List<WidgetCharge> = emptyList(),
    val things: List<WidgetThing> = emptyList(),
) {
    // The thing a single-thing widget shows: the one chosen for it, or, left
    // on automatic, the one closest to the end of its window. Null when the
    // chosen one is gone, or there are none.
    fun thing(chosenId: String?): WidgetThing? =
        if (chosenId != null) things.firstOrNull { it.id == chosenId }
        else things.filter { it.remaining != null }.minByOrNull { it.remaining!! } ?: things.firstOrNull()

    // The date that matters most right now: what needs a decision first, else
    // the nearest one ahead.
    fun without(cleared: Set<String>): WidgetData =
        if (cleared.isEmpty()) this else copy(attention = attention.filter { it.key !in cleared }, upcoming = upcoming.filter { it.key !in cleared })

    // A date the user has just sent from the home screen reads as sent at
    // once, before the app has done the sending.
    fun sending(keys: Set<String>): WidgetData {
        if (keys.isEmpty()) return this
        val mark = { e: WidgetEvent -> if (e.key in keys && e.state == "open") e.copy(state = "sent") else e }
        return copy(attention = attention.map(mark), upcoming = upcoming.map(mark))
    }

    // Offered on a date that needs a decision and has not been handed over.
    fun canSend(event: WidgetEvent): Boolean = canSend && event.state == "open" && needsDecision(event)

    // In the queue, so "Done with this" applies. A date that is only the
    // nearest one ahead is not waiting on anyone yet.
    fun needsDecision(event: WidgetEvent): Boolean = attention.any { it.key == event.key }

    // One that was cleared or done is no longer "next".
    val next: WidgetEvent? get() = attention.firstOrNull()
        ?: upcoming.firstOrNull { daysUntil(it.date) >= 0 && it.state != "done" && it.state != "dismissed" }
}

// Shown before the app has ever written anything. The only words the widgets
// carry themselves; they cannot know the app's language yet.
private val FALLBACK_LABELS = WidgetLabels(
    decideTitle = "Needs a decision",
    decideEmpty = "Open thingGLANCE to load your dates",
    nextTitle = "Next up",
    nextEmpty = "Open thingGLANCE to load your dates",
    today = "today",
    done = "Done with this",
    send = "Send to dayGLANCE",
    sent = "In dayGLANCE",
    days = "{{n}}d",
    months = "{{n}}mo",
    years = "{{n}}y",
)

// The payload as it is now, read again whenever the app writes a new one.
// Reading it once outside the composition is the obvious thing to do and is
// wrong: see SharedDataStore.changes.
@Composable
internal fun rememberWidgetData(context: Context): WidgetData {
    val written by SharedDataStore.changes.collectAsState()
    return remember(written) { WidgetSnapshot.read(context) }
}

internal object WidgetSnapshot {
    // What the app last wrote, less any date the user has since cleared from
    // the home screen: that write is still waiting for the app, and the row
    // should not sit there until it runs.
    fun read(context: Context): WidgetData =
        parse(SharedDataStore.readWidgetPayload(context))
            .without(SharedDataStore.pendingDecideKeys(context))
            .sending(SharedDataStore.pendingSendKeys(context))

    // A payload that is missing or unreadable draws as "not loaded", never as a
    // crash: a widget that throws shows the system's error tile.
    fun parse(json: String?): WidgetData {
        val empty = WidgetData(false, Locale.getDefault(), false, FALLBACK_LABELS, emptyList(), emptyList())
        if (json.isNullOrBlank()) return empty
        return try {
            val root = JSONObject(json)
            val snapshot = root.getJSONObject("snapshot")
            val l = root.optJSONObject("labels") ?: JSONObject()
            val text = { key: String, fallback: String -> l.optString(key, "").ifBlank { fallback } }
            WidgetData(
                loaded = true,
                locale = Locale.forLanguageTag(snapshot.optString("locale", "en")),
                canSend = root.optBoolean("canSend", false),
                labels = WidgetLabels(
                    decideTitle = text("decideTitle", FALLBACK_LABELS.decideTitle),
                    decideEmpty = text("decideEmpty", "Nothing needs a decision"),
                    nextTitle = text("nextTitle", FALLBACK_LABELS.nextTitle),
                    nextEmpty = text("nextEmpty", "Nothing coming up"),
                    today = text("today", FALLBACK_LABELS.today),
                    done = text("done", FALLBACK_LABELS.done),
                    send = text("send", FALLBACK_LABELS.send),
                    sent = text("sent", FALLBACK_LABELS.sent),
                    days = text("days", FALLBACK_LABELS.days),
                    months = text("months", FALLBACK_LABELS.months),
                    years = text("years", FALLBACK_LABELS.years),
                    addThing = text("addThing", FALLBACK_LABELS.addThing),
                    chargesTitle = text("chargesTitle", FALLBACK_LABELS.chargesTitle),
                    chargesEmpty = text("chargesEmpty", FALLBACK_LABELS.chargesEmpty),
                    thingTitle = text("thingTitle", FALLBACK_LABELS.thingTitle),
                    thingPick = text("thingPick", FALLBACK_LABELS.thingPick),
                    thingAuto = text("thingAuto", FALLBACK_LABELS.thingAuto),
                    thingNone = text("thingNone", FALLBACK_LABELS.thingNone),
                    thingGone = text("thingGone", FALLBACK_LABELS.thingGone),
                    verdicts = l.optJSONObject("verdicts")?.let { v -> v.keys().asSequence().associateWith { k -> v.optString(k, k) } } ?: emptyMap(),
                ),
                attention = events(snapshot.optJSONArray("attention")),
                upcoming = events(snapshot.optJSONArray("upcoming")),
                currency = snapshot.optString("currency", "USD").ifBlank { "USD" },
                chargesTotal = finite(snapshot.optJSONObject("charges")?.optDouble("total", 0.0)),
                chargesCount = snapshot.optJSONObject("charges")?.optInt("count", 0) ?: 0,
                charges = charges(snapshot.optJSONObject("charges")?.optJSONArray("items")),
                things = things(snapshot.optJSONArray("things")),
            )
        } catch (e: Exception) {
            empty
        }
    }

    private fun finite(value: Double?): Double = if (value == null || value.isNaN() || value.isInfinite()) 0.0 else value

    private fun charges(array: JSONArray?): List<WidgetCharge> {
        if (array == null) return emptyList()
        val out = ArrayList<WidgetCharge>(array.length())
        for (i in 0 until array.length()) {
            val c = array.optJSONObject(i) ?: continue
            val id = c.optString("subscriptionId", "")
            val date = c.optString("date", "")
            if (id.isEmpty() || dayNumber(date) == null) continue
            out.add(WidgetCharge(id, c.optString("name", ""), date, finite(c.optDouble("amount", 0.0)), c.optString("link", "").ifBlank { "thingglance://view/plans" }))
        }
        return out
    }

    private fun things(array: JSONArray?): List<WidgetThing> {
        if (array == null) return emptyList()
        val out = ArrayList<WidgetThing>(array.length())
        for (i in 0 until array.length()) {
            val t = array.optJSONObject(i) ?: continue
            val id = t.optString("id", "")
            if (id.isEmpty()) continue
            val remaining = if (t.isNull("remaining")) null else finite(t.optDouble("remaining")).coerceIn(0.0, 1.0)
            val lifeEnd = t.optString("lifeEnd", "").takeIf { dayNumber(it) != null }
            out.add(WidgetThing(id, t.optString("name", ""), t.optString("verdict", "unknown"), remaining, lifeEnd))
        }
        return out
    }

    private fun events(array: JSONArray?): List<WidgetEvent> {
        if (array == null) return emptyList()
        val out = ArrayList<WidgetEvent>(array.length())
        for (i in 0 until array.length()) {
            val e = array.optJSONObject(i) ?: continue
            val key = e.optString("key", "")
            val date = e.optString("date", "")
            // A row with no key or no real date cannot be drawn or opened.
            if (key.isEmpty() || dayNumber(date) == null) continue
            out.add(
                WidgetEvent(
                    key = key,
                    type = e.optString("type", ""),
                    date = date,
                    title = e.optString("title", ""),
                    detail = e.optString("detail", ""),
                    state = e.optString("state", "open"),
                    link = e.optString("link", "").ifBlank { "thingglance://queue" },
                ),
            )
        }
        return out
    }
}

// ── Dates ────────────────────────────────────────────────────────────────────

// Days since 1970 for a YYYY-MM-DD date, counted on the calendar (not the
// clock, which loses a day where clocks change at midnight). Null when the
// text is not a real date.
internal fun dayNumber(day: String): Long? {
    val parts = day.split("-")
    if (parts.size != 3) return null
    val y = parts[0].toIntOrNull() ?: return null
    val m = parts[1].toIntOrNull() ?: return null
    val d = parts[2].toIntOrNull() ?: return null
    if (y < 1970 || y > 2200 || m !in 1..12 || d < 1) return null
    val cal = GregorianCalendar(TimeZone.getTimeZone("UTC"))
    cal.clear()
    cal.set(y, m - 1, 1)
    if (d > cal.getActualMaximum(Calendar.DAY_OF_MONTH)) return null
    cal.set(Calendar.DAY_OF_MONTH, d)
    return cal.timeInMillis / 86_400_000L
}

// Today as a day number, in the device's own time zone.
internal fun todayNumber(now: Calendar = Calendar.getInstance()): Long {
    val cal = GregorianCalendar(TimeZone.getTimeZone("UTC"))
    cal.clear()
    cal.set(now.get(Calendar.YEAR), now.get(Calendar.MONTH), now.get(Calendar.DAY_OF_MONTH))
    return cal.timeInMillis / 86_400_000L
}

// Days from today to a date; negative once it has passed.
internal fun daysUntil(day: String, today: Long = todayNumber()): Int = ((dayNumber(day) ?: today) - today).toInt()

// The app's countdown notation (src/core/dates.ts: tMinus), with the unit
// templates from the app's catalog: "T-12d" before a date, "T+3mo" after it.
internal fun tMinus(days: Int, labels: WidgetLabels): String {
    if (days == 0) return "T-0"
    val distance = abs(days)
    val sign = if (days > 0) "-" else "+"
    val unit = when {
        distance < 60 -> labels.days.replace("{{n}}", distance.toString())
        distance < 730 -> labels.months.replace("{{n}}", (distance / 30.44).roundToInt().toString())
        else -> {
            val years = (distance / 365.25 * 10).roundToInt() / 10.0
            val shown = if (years == years.toLong().toDouble()) years.toLong().toString() else years.toString()
            labels.years.replace("{{n}}", shown)
        }
    }
    return "T$sign$unit"
}

// "Jan 15" as the snapshot's language writes it.
internal fun shortDate(day: String, locale: Locale): String {
    val number = dayNumber(day) ?: return day
    return try {
        val format = SimpleDateFormat(DateFormat.getBestDateTimePattern(locale, "MMMd"), locale)
        format.timeZone = TimeZone.getTimeZone("UTC")
        format.format(java.util.Date(number * 86_400_000L))
    } catch (e: Exception) {
        day
    }
}

// An amount as the app writes it (src/core/money.ts: money): the currency's own
// symbol and grouping for the snapshot's language, with cents only for a small
// amount that has them.
internal fun formatMoney(amount: Double, currency: String, locale: Locale): String {
    val cents = Math.abs(amount) < 100 && amount % 1.0 != 0.0
    return try {
        java.text.NumberFormat.getCurrencyInstance(locale).apply {
            this.currency = java.util.Currency.getInstance(currency)
            minimumFractionDigits = if (cents) 2 else 0
            maximumFractionDigits = if (cents) 2 else 0
        }.format(amount)
    } catch (e: Exception) {
        "$currency " + String.format(Locale.ROOT, if (cents) "%.2f" else "%.0f", amount)
    }
}

// How pressing a date is, by how close it is (the app's own bands).
internal enum class Urgency { PAST, URGENT, SOON, LATER }

internal fun urgency(days: Int): Urgency = when {
    days < 0 -> Urgency.PAST
    days <= 14 -> Urgency.URGENT
    days <= 60 -> Urgency.SOON
    else -> Urgency.LATER
}

// ── Opening the app ──────────────────────────────────────────────────────────

// A tap opens the app at a thingglance:// link. The app routes it itself, and
// a link only ever navigates (docs/links-and-intents.md).
internal fun openLinkIntent(context: Context, link: String): Intent =
    Intent(context, MainActivity::class.java)
        .setAction(Intent.ACTION_VIEW)
        .setData(Uri.parse(link))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

internal const val QUEUE_LINK = "thingglance://queue"
