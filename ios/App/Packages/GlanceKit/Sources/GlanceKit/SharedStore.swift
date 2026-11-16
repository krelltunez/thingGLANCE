import Foundation

// The one store the app and its extensions share: an App Group's defaults.
// The app (through WidgetBridgePlugin) writes down what the other surfaces
// show; they write down what the user did there. The web app stays the source
// of truth, and this is only the hand-off, as on Android (SharedDataStore.kt).
public struct SharedStore {
    // In App.entitlements, in every extension's entitlements, and on each App
    // ID in the developer portal. A wrong name fails without a word: every
    // read looks like "no data yet". `isAvailable` is how to tell.
    public static let suiteName = "group.com.thingglance.app"

    private static let keyPayload = "widget_payload"
    private static let keyWrites = "pending_writes"
    private static let keyCheckedAt = "checked_at"
    private static let keySyncedAt = "synced_at"

    private let defaults: UserDefaults?

    public init(defaults: UserDefaults? = UserDefaults(suiteName: SharedStore.suiteName)) {
        self.defaults = defaults
    }

    // False when the group is missing from the entitlements or the profile.
    public static var isAvailable: Bool {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName) != nil
    }

    // MARK: - What the surfaces show

    // The widgets' payload: `{ snapshot, labels, canSend, launcher }`, as
    // src/native/widgetBridge.ts builds it.
    public func writePayload(_ json: String, now: Date = Date()) {
        defaults?.set(json, forKey: SharedStore.keyPayload)
        defaults?.set(now.timeIntervalSince1970, forKey: SharedStore.keyCheckedAt)
    }

    public func readPayload() -> String? {
        defaults?.string(forKey: SharedStore.keyPayload)
    }

    // "Still here, nothing changed": when the app last looked.
    public func touchHeartbeat(syncedAt: String?, now: Date = Date()) {
        defaults?.set(now.timeIntervalSince1970, forKey: SharedStore.keyCheckedAt)
        if let syncedAt, !syncedAt.isEmpty { defaults?.set(syncedAt, forKey: SharedStore.keySyncedAt) }
    }

    public func checkedAt() -> Date? {
        guard let at = defaults?.double(forKey: SharedStore.keyCheckedAt), at > 0 else { return nil }
        return Date(timeIntervalSince1970: at)
    }

    public func syncedAt() -> String? {
        defaults?.string(forKey: SharedStore.keySyncedAt)
    }

    // MARK: - What the user did outside the app

    private func queue() -> [PendingWrites.Entry] {
        PendingWrites.parse(defaults?.string(forKey: SharedStore.keyWrites))
    }

    private func store(_ queue: [PendingWrites.Entry]) {
        defaults?.set(PendingWrites.encode(queue), forKey: SharedStore.keyWrites)
    }

    public func queueDecide(eventKey: String, clientId: String = "widget:" + UUID().uuidString.lowercased()) {
        store(PendingWrites.addingDecide(queue(), eventKey: eventKey, clientId: clientId))
    }

    public func queueSend(eventKey: String, clientId: String = "widget:" + UUID().uuidString.lowercased()) {
        store(PendingWrites.addingSend(queue(), eventKey: eventKey, clientId: clientId))
    }

    // A JSON array, for the app to apply.
    public func pendingWrites() -> String {
        PendingWrites.encode(queue())
    }

    public func acknowledge(clientIds: Set<String>) {
        if clientIds.isEmpty { return }
        store(PendingWrites.acknowledging(queue(), clientIds: clientIds))
    }

    // Dates ticked or sent and not yet applied: a surface leaves them out, or
    // marks them, without waiting for the app.
    public func pendingDecideKeys() -> Set<String> { PendingWrites.keys(in: queue(), action: PendingWrites.decide) }
    public func pendingSendKeys() -> Set<String> { PendingWrites.keys(in: queue(), action: PendingWrites.send) }
}
