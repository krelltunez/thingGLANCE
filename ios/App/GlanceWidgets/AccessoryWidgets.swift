import GlanceKit
import SwiftUI
import WidgetKit

// The Lock Screen's widgets. The system draws them in one colour, so they
// carry no tints: a number, a countdown and a few words.

// How many dates are waiting.
struct WaitingAccessoryView: View {
    let entry: SnapshotEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        let count = entry.data.attentionCount
        return Group {
            switch family {
            case .accessoryInline:
                Label(entry.data.waitingText ?? entry.data.labels.decideTitle, systemImage: count > 0 ? "hourglass" : "checkmark.circle")
            default:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Image(systemName: count > 0 ? "hourglass" : "checkmark")
                            .font(.system(size: 11, weight: .semibold))
                        Text(String(count))
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                            .minimumScaleFactor(0.6)
                    }
                }
            }
        }
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(queueURL)
        .accessibilityLabel(entry.data.waitingText ?? entry.data.labels.decideTitle)
    }
}

struct WaitingAccessoryWidget: Widget {
    let kind = "WaitingAccessoryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            WaitingAccessoryView(entry: entry)
        }
        .configurationDisplayName("Waiting")
        .description("How many dates are waiting for a decision.")
        .supportedFamilies([.accessoryCircular, .accessoryInline])
    }
}

// The next date, counted down.
struct NextDateAccessoryView: View {
    let entry: SnapshotEntry

    var body: some View {
        let event = entry.data.next(today: entry.today)
        return VStack(alignment: .leading, spacing: 1) {
            if let event {
                Text(Countdown.tMinus(entry.days(to: event.date), labels: entry.data.labels))
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .widgetAccentable()
                Text(event.title)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text(event.detail)
                    .font(.system(size: 12))
                    .lineLimit(1)
            } else {
                Text(entry.data.labels.nextTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .widgetAccentable()
                Text(entry.data.labels.nextEmpty)
                    .font(.system(size: 12))
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .containerBackground(for: .widget) { Color.clear }
        .widgetURL(event.map { linkURL($0.link, or: queueURL) } ?? queueURL)
    }
}

struct NextDateAccessoryWidget: Widget {
    let kind = "NextDateAccessoryWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            NextDateAccessoryView(entry: entry)
        }
        .configurationDisplayName("Next up")
        .description("The next date that matters, counted down.")
        .supportedFamilies([.accessoryRectangular])
    }
}
