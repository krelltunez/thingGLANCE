import Foundation

// What a widget draws, read out of the payload the app writes
// (`{ snapshot, labels, canSend }`, src/native/widgetBridge.ts). The snapshot's
// shape is a frozen contract (docs/snapshot.md); this reads the few fields a
// widget shows and ignores the rest. The Android twin is glance/WidgetData.kt.

public struct WidgetEvent: Equatable, Identifiable {
    public let key: String
    public let type: String
    public let date: String
    public let title: String
    public let detail: String
    // open | sent | done | dismissed
    public let state: String
    public let link: String
    public var id: String { key }

    public init(key: String, type: String, date: String, title: String, detail: String, state: String, link: String) {
        self.key = key
        self.type = type
        self.date = date
        self.title = title
        self.detail = detail
        self.state = state
        self.link = link
    }

    func with(state: String) -> WidgetEvent {
        WidgetEvent(key: key, type: type, date: date, title: title, detail: detail, state: state, link: link)
    }
}

public struct WidgetCharge: Equatable {
    public let subscriptionId: String
    public let name: String
    public let date: String
    public let amount: Double
    public let link: String
}

public struct WidgetThing: Equatable, Identifiable {
    public let id: String
    public let name: String
    public let verdict: String
    // The share of its life left, 0 to 1, or nil when nothing says.
    public let remaining: Double?
    public let lifeEnd: String?
}

// The words a widget adds of its own, already in the app's language.
public struct WidgetLabels: Equatable {
    public var decideTitle = "Needs a decision"
    public var decideEmpty = "Open thingGLANCE to load your dates"
    public var nextTitle = "Next up"
    public var nextEmpty = "Open thingGLANCE to load your dates"
    public var today = "today"
    public var done = "Done with this"
    public var send = "Send to dayGLANCE"
    public var sent = "In dayGLANCE"
    public var addThing = "Add a thing"
    public var chargesTitle = "Plans, next 30 days"
    public var chargesEmpty = "Nothing due in the next 30 days"
    public var thingTitle = "A single thing"
    public var thingPick = "Which thing?"
    public var thingAuto = "Closest to the end of its window"
    public var thingNone = "No things yet"
    public var thingGone = "No longer tracked"
    public var verdicts: [String: String] = [:]
    // [0] is "Nothing waiting", [2] is "2 waiting".
    public var waiting: [String] = []
    public var days = "{{n}}d"
    public var months = "{{n}}mo"
    public var years = "{{n}}y"

    public init() {}
}

public struct WidgetData: Equatable {
    // False until the app has handed over a payload.
    public var loaded = false
    public var locale = Locale.current
    public var canSend = false
    public var labels = WidgetLabels()
    public var attention: [WidgetEvent] = []
    public var upcoming: [WidgetEvent] = []
    // How many dates are waiting in all; the list holds only the first few.
    public var attentionCount = 0
    public var currency = "USD"
    public var chargesTotal = 0.0
    public var chargesCount = 0
    public var charges: [WidgetCharge] = []
    public var things: [WidgetThing] = []

    public init() {}

    // The tile's line for the number waiting, picked from the phrases the app
    // wrote out (a count picks a plural form, which is the catalog's to know).
    public var waitingText: String? {
        labels.waiting.isEmpty ? nil : labels.waiting[min(attentionCount, labels.waiting.count - 1)]
    }

    // The date to show when there is room for one.
    public func next(today: Int = Countdown.todayNumber()) -> WidgetEvent? {
        attention.first ?? upcoming.first { Countdown.daysUntil($0.date, today: today) >= 0 && $0.state != "done" && $0.state != "dismissed" }
    }

    // The chosen thing, or with no choice the one closest to the end of its
    // window. Nil for a choice that is gone.
    public func thing(chosenId: String?) -> WidgetThing? {
        if let chosenId { return things.first { $0.id == chosenId } }
        return things.filter { $0.remaining != nil }.min { ($0.remaining ?? 1) < ($1.remaining ?? 1) } ?? things.first
    }

    public func needsDecision(_ event: WidgetEvent) -> Bool {
        attention.contains { $0.key == event.key }
    }

    public func canSend(_ event: WidgetEvent) -> Bool {
        canSend && event.state == "open" && needsDecision(event)
    }

    // Dates ticked outside the app and not yet applied: gone from every list
    // at once, without waiting for the app.
    public func without(_ cleared: Set<String>) -> WidgetData {
        if cleared.isEmpty { return self }
        var copy = self
        copy.attention = attention.filter { !cleared.contains($0.key) }
        copy.upcoming = upcoming.filter { !cleared.contains($0.key) }
        copy.attentionCount = max(0, attentionCount - (attention.count - copy.attention.count))
        return copy
    }

    // Dates being sent to dayGLANCE: marked as sent while the app catches up.
    public func sending(_ keys: Set<String>) -> WidgetData {
        if keys.isEmpty { return self }
        var copy = self
        let mark: (WidgetEvent) -> WidgetEvent = { keys.contains($0.key) && $0.state == "open" ? $0.with(state: "sent") : $0 }
        copy.attention = attention.map(mark)
        copy.upcoming = upcoming.map(mark)
        return copy
    }

    public static func parse(_ json: String?) -> WidgetData {
        guard let json, let data = json.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let snapshot = root["snapshot"] as? [String: Any] else { return WidgetData() }
        var out = WidgetData()
        out.loaded = true
        out.locale = Locale(identifier: (snapshot["locale"] as? String) ?? "en")
        out.canSend = (root["canSend"] as? Bool) ?? false
        out.labels = labels(root["labels"] as? [String: Any])
        out.attention = events(snapshot["attention"])
        out.upcoming = events(snapshot["upcoming"])
        let counted = ((snapshot["counts"] as? [String: Any])?["attention"] as? NSNumber)?.intValue ?? 0
        out.attentionCount = max(counted, out.attention.count)
        let currency = (snapshot["currency"] as? String) ?? ""
        out.currency = currency.isEmpty ? "USD" : currency
        let charges = snapshot["charges"] as? [String: Any]
        out.chargesTotal = finite(charges?["total"])
        out.chargesCount = (charges?["count"] as? NSNumber)?.intValue ?? 0
        out.charges = ((charges?["items"] as? [Any]) ?? []).compactMap(charge)
        out.things = ((snapshot["things"] as? [Any]) ?? []).compactMap(thing)
        return out
    }

    private static func finite(_ value: Any?) -> Double {
        guard let number = (value as? NSNumber)?.doubleValue, number.isFinite else { return 0 }
        return number
    }

    private static func labels(_ l: [String: Any]?) -> WidgetLabels {
        var out = WidgetLabels()
        // With a payload in hand the lists are known to be empty, not unread.
        out.decideEmpty = "Nothing needs a decision"
        out.nextEmpty = "Nothing coming up"
        guard let l else { return out }
        func text(_ key: String, _ path: WritableKeyPath<WidgetLabels, String>) {
            if let value = l[key] as? String, !value.isEmpty { out[keyPath: path] = value }
        }
        text("decideTitle", \.decideTitle); text("decideEmpty", \.decideEmpty)
        text("nextTitle", \.nextTitle); text("nextEmpty", \.nextEmpty)
        text("today", \.today); text("done", \.done); text("send", \.send); text("sent", \.sent)
        text("addThing", \.addThing); text("chargesTitle", \.chargesTitle); text("chargesEmpty", \.chargesEmpty)
        text("thingTitle", \.thingTitle); text("thingPick", \.thingPick); text("thingAuto", \.thingAuto)
        text("thingNone", \.thingNone); text("thingGone", \.thingGone)
        text("days", \.days); text("months", \.months); text("years", \.years)
        if let verdicts = l["verdicts"] as? [String: Any] { out.verdicts = verdicts.compactMapValues { $0 as? String } }
        if let waiting = l["waiting"] as? [Any] { out.waiting = waiting.map { ($0 as? String) ?? "" } }
        return out
    }

    private static func events(_ value: Any?) -> [WidgetEvent] {
        ((value as? [Any]) ?? []).compactMap { item in
            guard let e = item as? [String: Any], let key = e["key"] as? String, !key.isEmpty,
                  let date = e["date"] as? String, Countdown.dayNumber(date) != nil else { return nil }
            let link = (e["link"] as? String) ?? ""
            return WidgetEvent(
                key: key,
                type: (e["type"] as? String) ?? "",
                date: date,
                title: (e["title"] as? String) ?? "",
                detail: (e["detail"] as? String) ?? "",
                state: (e["state"] as? String) ?? "open",
                link: link.isEmpty ? "thingglance://queue" : link
            )
        }
    }

    private static func charge(_ item: Any) -> WidgetCharge? {
        guard let c = item as? [String: Any], let id = c["subscriptionId"] as? String, !id.isEmpty,
              let date = c["date"] as? String, Countdown.dayNumber(date) != nil else { return nil }
        let link = (c["link"] as? String) ?? ""
        return WidgetCharge(subscriptionId: id, name: (c["name"] as? String) ?? "", date: date, amount: finite(c["amount"]), link: link.isEmpty ? "thingglance://view/plans" : link)
    }

    private static func thing(_ item: Any) -> WidgetThing? {
        guard let t = item as? [String: Any], let id = t["id"] as? String, !id.isEmpty else { return nil }
        let remaining = (t["remaining"] as? NSNumber).map { min(1, max(0, $0.doubleValue.isFinite ? $0.doubleValue : 0)) }
        let lifeEnd = (t["lifeEnd"] as? String).flatMap { Countdown.dayNumber($0) != nil ? $0 : nil }
        return WidgetThing(id: id, name: (t["name"] as? String) ?? "", verdict: (t["verdict"] as? String) ?? "unknown", remaining: remaining, lifeEnd: lifeEnd)
    }
}

public extension SharedStore {
    // What a surface should draw now: the payload, less what was ticked
    // outside the app since, with what is being sent marked as sent.
    func widgetData() -> WidgetData {
        WidgetData.parse(readPayload()).without(pendingDecideKeys()).sending(pendingSendKeys())
    }
}
