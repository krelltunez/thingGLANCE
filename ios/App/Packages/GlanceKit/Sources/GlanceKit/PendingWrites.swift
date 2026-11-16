import Foundation

// The queue of writes made outside the app (a notification's button, a widget's
// tick). Nothing here applies one: the app does, through the one door every
// write from outside uses (src/intents/), and acknowledges it afterwards.
//
// An entry is `{ action, payload, clientId }`, the same object Android queues
// (android: SharedDataStore.kt) and src/native/widgetBridge.ts collects. The
// id is minted where the write was made, so applying it twice changes nothing.
public enum PendingWrites {
    public static let decide = "decide"
    public static let send = "send"
    // A queue nobody is draining must not grow without end.
    public static let maxPending = 50

    public typealias Entry = [String: Any]

    public static func parse(_ json: String?) -> [Entry] {
        guard let json, let data = json.data(using: .utf8),
              let array = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
        return array.compactMap { $0 as? Entry }
    }

    public static func encode(_ queue: [Entry]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: queue, options: [.sortedKeys]),
              let json = String(data: data, encoding: .utf8) else { return "[]" }
        return json
    }

    // The dates an action is already queued for. A "restore" is a decide too,
    // and is not a tick: it must not hide the row it puts back.
    public static func keys(in queue: [Entry], action: String) -> Set<String> {
        var keys = Set<String>()
        for entry in queue where entry["action"] as? String == action {
            let payload = entry["payload"] as? [String: Any]
            if payload?["state"] as? String == "restore" { continue }
            if let key = payload?["event_key"] as? String, !key.isEmpty { keys.insert(key) }
        }
        return keys
    }

    // "Done with this". A second tick on the same date adds nothing.
    public static func addingDecide(_ queue: [Entry], eventKey: String, clientId: String) -> [Entry] {
        adding(queue, action: decide, eventKey: eventKey, clientId: clientId, payload: ["event_key": eventKey, "state": "done"])
    }

    // "Send to dayGLANCE". Not for a date that is already being settled.
    public static func addingSend(_ queue: [Entry], eventKey: String, clientId: String) -> [Entry] {
        if keys(in: queue, action: decide).contains(eventKey) { return queue }
        return adding(queue, action: send, eventKey: eventKey, clientId: clientId, payload: ["event_key": eventKey])
    }

    private static func adding(_ queue: [Entry], action: String, eventKey: String, clientId: String, payload: [String: Any]) -> [Entry] {
        if eventKey.isEmpty || keys(in: queue, action: action).contains(eventKey) { return queue }
        if queue.contains(where: { $0["clientId"] as? String == clientId }) { return queue }
        return trimmed(queue + [["action": action, "clientId": clientId, "payload": payload]])
    }

    // What is left once the app has applied these.
    public static func acknowledging(_ queue: [Entry], clientIds: Set<String>) -> [Entry] {
        queue.filter { !clientIds.contains(($0["clientId"] as? String) ?? "") }
    }

    public static func trimmed(_ queue: [Entry]) -> [Entry] {
        queue.count <= maxPending ? queue : Array(queue.suffix(maxPending))
    }
}
