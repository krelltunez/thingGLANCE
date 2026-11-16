import Foundation

// Links made outside the app, for the app to open.
//
// A link only ever navigates (docs/links-and-intents.md): "open on a new
// thing", "show the queue". An extension cannot open the app at a place, and
// an intent that opens the app runs before the page exists, so each writes the
// link down here and the app takes it as it comes to the front
// (WidgetBridgePlugin.takeLink, src/native/capacitor.ts).
public enum OutsideLinks {
    public static let add = "thingglance://action/add"
    public static let addPlan = "thingglance://action/add-plan"
    public static let queue = "thingglance://queue"

    private static let maxName = 200

    // Only the app's own scheme is ever handed on.
    public static func isOurs(_ link: String) -> Bool {
        link.lowercased().hasPrefix("thingglance://") && link.count <= 2000
    }

    // "Open on a new thing called this."
    public static func addLink(name: String?) -> String {
        guard let name, !name.isEmpty else { return add }
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-._~")
        return add + "?name=" + (name.addingPercentEncoding(withAllowedCharacters: allowed) ?? "")
    }

    // What a share names: the page's title if it has one; failing that, the
    // shared text without its links. A bare address names nothing. The same
    // rule as Android's LaunchLinks.sharedName.
    public static func sharedName(subject: String?, text: String?) -> String? {
        let withoutLinks = text.map { $0.replacingOccurrences(of: #"https?://\S+"#, with: " ", options: [.regularExpression, .caseInsensitive]) }
        for candidate in [subject, withoutLinks] {
            let clean = (candidate ?? "")
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            if clean.isEmpty { continue }
            return clean.count <= maxName ? clean : String(clean.prefix(maxName)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return nil
    }
}

public extension SharedStore {
    private static var keyLink: String { "pending_link" }
    private static var keyShares: String { "pending_shares" }
    private static var maxShares: Int { 20 }

    // "Open the app here": a quick action, a shortcut, the Control Center
    // button. One at a time: a newer one replaces an older one nobody took.
    func setPendingLink(_ link: String) {
        guard OutsideLinks.isOurs(link) else { return }
        store(link, forKey: SharedStore.keyLink)
    }

    // Something shared into the app while it was closed. These queue: three
    // pages shared in a row are three things to add.
    func queueShare(name: String?) {
        var shares = strings(forKey: SharedStore.keyShares)
        shares.append(OutsideLinks.addLink(name: name))
        store(Array(shares.suffix(SharedStore.maxShares)), forKey: SharedStore.keyShares)
    }

    // The next link for the app to open, taken off the store: the place it was
    // asked to open at, or with none the oldest share. One per call, so one
    // form opens at a time.
    func takeLink() -> String? {
        if let link = string(forKey: SharedStore.keyLink) {
            remove(forKey: SharedStore.keyLink)
            if OutsideLinks.isOurs(link) { return link }
        }
        var shares = strings(forKey: SharedStore.keyShares)
        guard !shares.isEmpty else { return nil }
        let next = shares.removeFirst()
        store(shares, forKey: SharedStore.keyShares)
        return OutsideLinks.isOurs(next) ? next : nil
    }
}
