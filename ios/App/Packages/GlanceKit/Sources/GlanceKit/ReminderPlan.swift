import Foundation

// Reminders, as the native side sees them.
//
// Which dates notify, and when, is decided in src/core/reminders.ts and travels
// in the snapshot as `reminders`. Nothing here decides anything: it reads that
// list and works out what to schedule and what to cancel so the system's
// pending notifications match it. The Android twin is reminders/ReminderPlan.kt.
public struct PlannedReminder: Equatable {
    public let id: String
    public let eventKey: String
    // Epoch milliseconds.
    public let at: Int64
    public let title: String
    public let body: String
    public let link: String

    public init(id: String, eventKey: String, at: Int64, title: String, body: String, link: String) {
        self.id = id
        self.eventKey = eventKey
        self.at = at
        self.title = title
        self.body = body
        self.link = link
    }

    // Everything a pending notification was made from. One that still matches
    // is left alone; anything else is scheduled again.
    public func signature(canSend: Bool) -> String {
        "\(id)|\(at)|\(title)|\(body)|\(link)|\(canSend ? "send" : "")"
    }

    public var json: [String: Any] {
        ["id": id, "eventKey": eventKey, "at": at, "title": title, "body": body, "link": link]
    }
}

// The few words a notification adds of its own, already in the app's language
// (`labels` in the payload).
public struct ReminderLabels: Equatable {
    public let done: String
    public let send: String

    public init(done: String, send: String) {
        self.done = done
        self.send = send
    }

    // Before the app has ever handed over a payload.
    public static let fallback = ReminderLabels(done: "Done with this", send: "")
}

public struct ReminderOrder: Equatable {
    public let reminders: [PlannedReminder]
    public let labels: ReminderLabels
    // True when this device can hand a date to dayGLANCE. Only then is the
    // button offered: one that can only fail is worse than none.
    public let canSend: Bool
}

public enum ReminderPlan {
    // iOS keeps 64 pending notifications for an app and silently drops the
    // rest. The family leaves room: 56 (docs/ROADMAP.md, Phase 4).
    public static let limit = 56

    // The widgets' payload, as written by the app.
    public static func order(fromPayload json: String?) -> ReminderOrder? {
        guard let json, let data = json.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let snapshot = root["snapshot"] as? [String: Any] else { return nil }
        let labels = root["labels"] as? [String: Any]
        let done = (labels?["done"] as? String) ?? ""
        let canSend = (root["canSend"] as? Bool) ?? false
        return ReminderOrder(
            reminders: parse(snapshot["reminders"] as? [Any]),
            labels: ReminderLabels(done: done.isEmpty ? ReminderLabels.fallback.done : done, send: (labels?["send"] as? String) ?? ""),
            canSend: canSend
        )
    }

    public static func parse(_ array: [Any]?) -> [PlannedReminder] {
        guard let array else { return [] }
        return array.compactMap { item in
            guard let r = item as? [String: Any],
                  let id = r["id"] as? String, !id.isEmpty,
                  let at = (r["at"] as? NSNumber)?.int64Value, at > 0 else { return nil }
            let link = (r["link"] as? String) ?? ""
            return PlannedReminder(
                id: id,
                eventKey: (r["eventKey"] as? String) ?? "",
                at: at,
                title: (r["title"] as? String) ?? "",
                body: (r["body"] as? String) ?? "",
                link: link.isEmpty ? "thingglance://queue" : link
            )
        }
    }

    public struct Diff: Equatable {
        public let schedule: [PlannedReminder]
        // Ids of pending notifications nothing asks for any more.
        public let cancel: [String]
        public let keep: [PlannedReminder]
    }

    // `held`: what the system has pending now, each id with the signature it
    // was scheduled under. Only what is still ahead is wanted, the soonest
    // first, and no more than the system keeps.
    public static func diff(wanted: [PlannedReminder], held: [String: String], canSend: Bool, now: Int64, limit: Int = ReminderPlan.limit) -> Diff {
        var want: [PlannedReminder] = []
        var seen = Set<String>()
        for r in wanted.filter({ $0.at > now }).sorted(by: { $0.at < $1.at }) where !seen.contains(r.id) {
            if want.count >= limit { break }
            seen.insert(r.id)
            want.append(r)
        }
        let schedule = want.filter { held[$0.id] != $0.signature(canSend: canSend) }
        let keep = want.filter { held[$0.id] == $0.signature(canSend: canSend) }
        let cancel = held.keys.filter { !seen.contains($0) }.sorted()
        return Diff(schedule: schedule, cancel: cancel, keep: keep)
    }
}
