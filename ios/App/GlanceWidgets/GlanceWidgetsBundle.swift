import SwiftUI
import WidgetKit

// The widgets: the five the Android app has (docs/android.md, "Widgets") and
// the Lock Screen's. Every one draws from the payload the app wrote to the App
// Group, read through GlanceKit, and none can run the app: a tick queues a
// write the app applies when it next runs.
@main
struct GlanceWidgetsBundle: WidgetBundle {
    var body: some Widget {
        DecideWidget()
        NextUpWidget()
        ChargesWidget()
        ThingWidget()
        AddThingWidget()
        WaitingAccessoryWidget()
        NextDateAccessoryWidget()
        // Control Center controls came with iOS 18; the rest of the bundle
        // stays on the extension's 17.
        if #available(iOSApplicationExtension 18.0, *) {
            AddThingControl()
        }
    }
}
