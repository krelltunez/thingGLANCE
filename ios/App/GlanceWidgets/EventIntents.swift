import AppIntents
import GlanceKit
import WidgetKit

// The buttons on a row. Each runs here, in the extension, with no app and no
// WebView: it queues a write in the App Group and the app applies it when it
// next runs, through the one door every write from outside uses. Until then
// the widgets leave the date out (or mark it sent) by reading the queue.
//
// Neither is offered in the Shortcuts app: they are a row's buttons, not
// actions with a meaning of their own.

struct DecideEventIntent: AppIntent {
    static let title: LocalizedStringResource = "Done with this"
    static let isDiscoverable = false

    @Parameter(title: "Date")
    var eventKey: String

    init() {}

    init(eventKey: String) {
        self.eventKey = eventKey
    }

    func perform() async throws -> some IntentResult {
        SharedStore().queueDecide(eventKey: eventKey)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

struct SendEventIntent: AppIntent {
    static let title: LocalizedStringResource = "Send to dayGLANCE"
    static let isDiscoverable = false

    @Parameter(title: "Date")
    var eventKey: String

    init() {}

    init(eventKey: String) {
        self.eventKey = eventKey
    }

    func perform() async throws -> some IntentResult {
        SharedStore().queueSend(eventKey: eventKey)
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}
