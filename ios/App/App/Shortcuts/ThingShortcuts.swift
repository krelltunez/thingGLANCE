import AppIntents
import Foundation
import GlanceKit
import WidgetKit

// What Siri, Spotlight and the Shortcuts app can do with thingGLANCE without
// anyone building anything.
//
// Two of them answer or act with the app closed, from what the app last wrote
// to the App Group: nothing here opens the database, and a date is settled the
// way a widget's tick settles it, by queueing a write the app applies. The
// other two open the app at a place, which is a link.
//
// App Shortcuts need iOS 16, and these parameter summaries iOS 17; the app
// itself still runs on 15, hence the availability marks.

// A date in the queue, for "Settle a date" to ask about.
@available(iOS 17.0, *)
struct WaitingDateEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Date"
    static let defaultQuery = WaitingDateQuery()

    // The event's key.
    let id: String
    let title: String
    let detail: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(title)", subtitle: "\(detail)")
    }
}

@available(iOS 17.0, *)
struct WaitingDateQuery: EntityStringQuery {
    private func waiting() -> [WaitingDateEntity] {
        SharedStore().widgetData().attention.map { WaitingDateEntity(id: $0.key, title: $0.title, detail: $0.detail) }
    }

    func entities(for identifiers: [String]) async throws -> [WaitingDateEntity] {
        let all = waiting()
        return identifiers.compactMap { id in all.first { $0.id == id } }
    }

    func entities(matching string: String) async throws -> [WaitingDateEntity] {
        waiting().filter { $0.title.localizedCaseInsensitiveContains(string) || $0.detail.localizedCaseInsensitiveContains(string) }
    }

    func suggestedEntities() async throws -> [WaitingDateEntity] {
        waiting()
    }
}

@available(iOS 17.0, *)
struct WhatsNextIntent: AppIntent {
    static let title: LocalizedStringResource = "What's next"
    static let description = IntentDescription("Says how many dates are waiting for a decision and which comes first, without opening the app.")
    static let openAppWhenRun = false

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let data = SharedStore().widgetData()
        let answer = WhatsNextIntent.answer(data, today: Countdown.todayNumber())
        return .result(value: answer, dialog: IntentDialog(stringLiteral: answer))
    }

    // The words are the app's wherever it wrote them (the waiting line, the
    // date's own title and detail); only the day count is made here.
    static func answer(_ data: WidgetData, today: Int) -> String {
        guard data.loaded else { return data.labels.nextEmpty }
        guard let next = data.next(today: today) else { return data.waitingText ?? data.labels.nextEmpty }
        let days = Countdown.daysUntil(next.date, today: today)
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = data.locale
        formatter.unitsStyle = .full
        formatter.dateTimeStyle = .named
        let when = formatter.localizedString(from: DateComponents(day: days))
        let first = "\(next.title), \(next.detail): \(when)."
        guard let waiting = data.waitingText, data.attentionCount > 0 else { return first }
        return "\(waiting). \(first)"
    }
}

@available(iOS 17.0, *)
struct SettleDateIntent: AppIntent {
    static let title: LocalizedStringResource = "Settle a date"
    static let description = IntentDescription("Marks a date in the queue as done with, without opening the app. It only records the decision: nothing is cancelled or renewed.")
    static let openAppWhenRun = false

    @Parameter(title: "Date")
    var date: WaitingDateEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Settle \(\.$date)")
    }

    init() {}

    func perform() async throws -> some IntentResult & ProvidesDialog {
        SharedStore().queueDecide(eventKey: date.id, clientId: "shortcut:" + UUID().uuidString.lowercased())
        WidgetCenter.shared.reloadAllTimelines()
        // Applied at once if the app happens to be running.
        WidgetBridgePlugin.announcePendingWrites()
        return .result(dialog: "Done with \(date.title).")
    }
}

@available(iOS 17.0, *)
struct AddThingShortcutIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a thing"
    static let description = IntentDescription("Opens thingGLANCE on a new thing.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        SharedStore().setPendingLink(OutsideLinks.add)
        WidgetBridgePlugin.announcePendingLink()
        return .result()
    }
}

@available(iOS 17.0, *)
struct ShowQueueIntent: AppIntent {
    static let title: LocalizedStringResource = "Show what needs a decision"
    static let description = IntentDescription("Opens thingGLANCE on the dates waiting for a decision.")
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        SharedStore().setPendingLink(OutsideLinks.queue)
        WidgetBridgePlugin.announcePendingLink()
        return .result()
    }
}

// Every phrase has to carry \(.applicationName): iOS drops one that does not,
// without a word.
@available(iOS 17.0, *)
struct ThingGlanceShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: WhatsNextIntent(),
            phrases: [
                "What's next in \(.applicationName)",
                "What needs a decision in \(.applicationName)",
            ],
            shortTitle: "What's next",
            systemImageName: "hourglass"
        )
        AppShortcut(
            intent: SettleDateIntent(),
            phrases: [
                "Settle a date in \(.applicationName)",
                "Mark a date done in \(.applicationName)",
            ],
            shortTitle: "Settle a date",
            systemImageName: "checkmark.circle"
        )
        AppShortcut(
            intent: AddThingShortcutIntent(),
            phrases: [
                "Add a thing in \(.applicationName)",
                "New thing in \(.applicationName)",
            ],
            shortTitle: "Add a thing",
            systemImageName: "plus.circle"
        )
        AppShortcut(
            intent: ShowQueueIntent(),
            phrases: [
                "Show what needs a decision in \(.applicationName)",
                "Open the queue in \(.applicationName)",
            ],
            shortTitle: "Needs a decision",
            systemImageName: "checklist"
        )
    }
}
