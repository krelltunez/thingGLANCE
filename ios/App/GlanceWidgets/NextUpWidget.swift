import GlanceKit
import SwiftUI
import WidgetKit

// "Next up": one date, the most pressing in the queue, or with nothing
// waiting the next one ahead.
struct NextUpWidgetView: View {
    let entry: SnapshotEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        let event = entry.data.next(today: entry.today)
        return Group {
            if !entry.groupAvailable {
                GroupProblem()
            } else if let event {
                if family == .systemSmall { small(event) } else { medium(event) }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    WidgetTitle(text: entry.data.labels.nextTitle)
                    Spacer(minLength: 0)
                    QuietLine(text: entry.data.labels.nextEmpty)
                    Spacer(minLength: 0)
                    Wordmark()
                }
            }
        }
        .widgetSurface(event.map { linkURL($0.link, or: queueURL) } ?? queueURL)
    }

    private func medium(_ event: WidgetEvent) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            WidgetTitle(text: entry.data.labels.nextTitle)
            Spacer(minLength: 0)
            EventRow(event: event, entry: entry, wide: true)
            Spacer(minLength: 0)
            Wordmark()
        }
    }

    // No room for a row: the countdown, large, over the words.
    private func small(_ event: WidgetEvent) -> some View {
        let days = entry.days(to: event.date)
        return VStack(alignment: .leading, spacing: 4) {
            WidgetTitle(text: entry.data.labels.nextTitle)
            Spacer(minLength: 0)
            Text(Countdown.tMinus(days, labels: entry.data.labels))
                .font(.system(size: 26, weight: .bold, design: .monospaced))
                .foregroundStyle(Tone.urgency(days))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(event.title)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
            Text(event.detail)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

struct NextUpWidget: Widget {
    let kind = "NextUpWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            NextUpWidgetView(entry: entry)
        }
        .configurationDisplayName("Next up")
        .description("The next date that matters, counted down.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
