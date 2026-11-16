import GlanceKit
import SwiftUI
import WidgetKit

// A tile that opens the app on a new thing. It is a link: nothing is made
// until the form is saved.
struct AddThingWidgetView: View {
    let entry: SnapshotEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "plus")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(Tone.accent, in: RoundedRectangle(cornerRadius: 14))
            Spacer(minLength: 0)
            Text(entry.data.labels.addThing)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)
                .lineLimit(2)
            Wordmark(size: 12)
        }
        .widgetSurface(addURL)
    }
}

struct AddThingWidget: Widget {
    let kind = "AddThingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            AddThingWidgetView(entry: entry)
        }
        .configurationDisplayName("Add a thing")
        .description("Opens thingGLANCE on a new thing.")
        .supportedFamilies([.systemSmall])
    }
}
