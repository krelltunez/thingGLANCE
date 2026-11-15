package com.thingglance.app.launcher

import org.json.JSONArray
import org.json.JSONObject

// What GLANCElauncher reads (docs/launcher.md): the payload the app handed
// over for the widgets, as rows. One cursor per collection, each row the
// collection's JSON object and its id.
//
//   meta       one row: what the lists were built for (day, currency, counts,
//              plan costs), and how fresh it all is
//   attention  the dates that need a decision, most pressing first
//   upcoming   the dates still ahead, soonest first
//   things     every thing in service
//   charges    what plans will charge in the next 30 days
//
// Pure over the JSON text, so the mapping is tested on the JVM; the provider
// only adds the Android plumbing. The `meta` field names are the ones the
// launcher already reads from dayGLANCE and lastGLANCE.
object LauncherRows {
    const val AUTHORITY = "com.thingglance.app.launcher"

    // This contract's own version, apart from the snapshot's.
    const val VERSION = 1

    val COLLECTIONS: List<String> = listOf("meta", "attention", "upcoming", "things", "charges")

    // A row number, the row's id, and the row as JSON.
    val COLUMNS = arrayOf("_id", "id", "json")

    data class Row(val id: String, val json: String)

    // What is known only at the moment of the read.
    data class Live(
        // When the app last looked, changed or not (epoch ms; 0: never).
        val checkedAt: Long = 0L,
        // The last full vault sync the app reported outside a payload.
        val syncedAt: String? = null,
        val refreshLog: String? = null,
        // True while the app's own page exists in this process.
        val rendererAlive: Boolean = false,
        val headlessRunning: Boolean = false,
        // Dates ticked on a widget or a notification that the app has not
        // applied yet: gone from here too, so every surface agrees.
        val cleared: Set<String> = emptySet(),
        val sending: Set<String> = emptySet(),
    )

    // The rows of `collection`, or null for one this provider does not serve.
    fun rows(payloadJson: String?, collection: String, live: Live = Live()): List<Row>? {
        if (collection !in COLLECTIONS) return null
        val root = payloadJson?.let { try { JSONObject(it) } catch (e: Exception) { null } }
        val snapshot = root?.optJSONObject("snapshot")
        val launcher = root?.optJSONObject("launcher")
        if (collection == "meta") return listOf(Row("meta", meta(root, snapshot, launcher, live).toString()))
        if (snapshot == null) return emptyList()
        return when (collection) {
            "attention" -> events(launcher?.optJSONArray("attention") ?: snapshot.optJSONArray("attention"), live, dropCleared = true)
            "upcoming" -> events(launcher?.optJSONArray("upcoming") ?: snapshot.optJSONArray("upcoming"), live, dropCleared = false)
            "things" -> objects(snapshot.optJSONArray("things")) { it.optString("id") }
            else -> objects(launcher?.optJSONArray("charges") ?: snapshot.optJSONObject("charges")?.optJSONArray("items")) {
                it.optString("subscriptionId") + ":" + it.optString("date")
            }
        }
    }

    private fun meta(root: JSONObject?, snapshot: JSONObject?, launcher: JSONObject?, live: Live): JSONObject {
        val meta = JSONObject().put("version", VERSION)
        if (snapshot == null) {
            // Installed, never opened: there is a provider and nothing in it.
            meta.put("empty", true)
        } else {
            meta.put("snapshotVersion", snapshot.optInt("version", 0))
            meta.put("updatedAt", snapshot.optString("generatedAt"))
            meta.put("today", snapshot.optString("day"))
            meta.put("currency", snapshot.optString("currency"))
            meta.put("locale", snapshot.optString("locale"))
            snapshot.optJSONObject("burn")?.let { meta.put("burn", it) }
            snapshot.optJSONObject("counts")?.let { counts ->
                // The queue, less what was ticked off and is waiting to be applied.
                val shown = launcher?.optJSONArray("attention") ?: snapshot.optJSONArray("attention")
                val gone = (0 until (shown?.length() ?: 0)).count { shown?.optJSONObject(it)?.optString("key") in live.cleared }
                meta.put("counts", JSONObject(counts.toString()).put("attention", (counts.optInt("attention", 0) - gone).coerceAtLeast(0)))
            }
            snapshot.optJSONObject("charges")?.let { c ->
                meta.put("charges", JSONObject().put("days", c.optInt("days", 30)).put("total", c.optDouble("total", 0.0)).put("count", c.optInt("count", 0))
                    .put("months", c.optJSONArray("months") ?: JSONArray()))
            }
            meta.put("canSend", root?.optBoolean("canSend", false) ?: false)
            // The app's own words for what the launcher cannot word itself.
            root?.optJSONObject("labels")?.let { l ->
                val words = JSONObject()
                for (key in WORDS) if (l.has(key)) words.put(key, l.get(key))
                meta.put("labels", words)
            }
            meta.put("handledWrites", launcher?.optJSONArray("handledWrites") ?: JSONArray())
        }
        if (live.checkedAt > 0) meta.put("checkedAt", live.checkedAt)
        // The later of the two the app has told us: in the payload, or since.
        val synced = listOfNotNull(launcher?.optString("syncedAt")?.takeIf { it.isNotEmpty() && it != "null" }, live.syncedAt?.takeIf { it.isNotEmpty() }).maxOrNull()
        meta.put("syncedAt", synced ?: JSONObject.NULL)
        meta.put("rendererAlive", live.rendererAlive)
        meta.put("headlessRunning", live.headlessRunning)
        meta.put("refreshLog", live.refreshLog?.let { try { JSONArray(it) } catch (e: Exception) { null } } ?: JSONArray())
        return meta
    }

    private val WORDS = listOf("verdicts", "sent", "send", "done", "days", "months", "years", "today")

    private fun events(array: JSONArray?, live: Live, dropCleared: Boolean): List<Row> {
        val out = ArrayList<Row>()
        for (i in 0 until (array?.length() ?: 0)) {
            val e = array?.optJSONObject(i) ?: continue
            val key = e.optString("key")
            if (key.isEmpty()) continue
            val cleared = key in live.cleared
            if (cleared && dropCleared) continue
            val row = when {
                cleared -> JSONObject(e.toString()).put("state", "done")
                key in live.sending && e.optString("state", "open") == "open" -> JSONObject(e.toString()).put("state", "sent")
                else -> e
            }
            out.add(Row(key, row.toString()))
        }
        return out
    }

    private fun objects(array: JSONArray?, id: (JSONObject) -> String): List<Row> {
        val out = ArrayList<Row>()
        for (i in 0 until (array?.length() ?: 0)) {
            val o = array?.optJSONObject(i) ?: continue
            out.add(Row(id(o).ifEmpty { i.toString() }, o.toString()))
        }
        return out
    }
}
