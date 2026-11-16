import AppIntents
import GlanceKit
import SwiftUI
import WidgetKit

// The Control Center button: "Add a thing".
//
// This file is in two targets. The widget extension shows the control; the app
// has to hold the intent as well, or a tap on the control does nothing: an
// intent that opens the app is run in the app. So the intent can touch nothing
// only one of them has. It writes the link down in the App Group, and the web
// side takes it as the app comes to the front.
//
// It is not offered in the Shortcuts app. An intent that two targets vend
// shows up there twice, and the app's own "Add a thing" shortcut
// (App/Shortcuts/ThingShortcuts.swift) is the one people should see.
@available(iOS 18.0, *)
struct OpenAddThingIntent: AppIntent {
    static let title: LocalizedStringResource = "Add a thing"
    static let isDiscoverable = false
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult {
        SharedStore().setPendingLink(OutsideLinks.add)
        return .result()
    }
}

@available(iOS 18.0, *)
struct AddThingControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.thingglance.app.control.add") {
            ControlWidgetButton(action: OpenAddThingIntent()) {
                Label("Add a thing", systemImage: "plus.circle")
            }
        }
        .displayName("Add a thing")
        .description("Opens thingGLANCE on a new thing.")
    }
}
