import GlanceKit
import SwiftUI
import WidgetKit

// "Needs a decision": the queue, most pressing first, each date with its tick.
//
// A WidgetKit list does not scroll, so the number of rows is measured, not
// guessed: ViewThatFits takes the longest list that fits this size on this
// device, and a last line says how many more are waiting.
struct DecideWidgetView: View {
    let entry: SnapshotEntry

    var body: some View {
        Group {
            if !entry.groupAvailable {
                GroupProblem()
            } else if entry.data.attention.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    WidgetTitle(text: entry.data.labels.decideTitle)
                    Spacer(minLength: 0)
                    QuietLine(text: entry.data.labels.decideEmpty)
                    Spacer(minLength: 0)
                    Wordmark()
                }
            } else {
                // Longest first. A candidate holds nothing flexible: a Spacer
                // always "fits", and the measuring would mean nothing.
                ViewThatFits(in: .vertical) {
                    ForEach([8, 7, 6, 5, 4, 3, 2, 1], id: \.self) { count in
                        candidate(count)
                    }
                }
            }
        }
        .widgetSurface(queueURL)
    }

    private func candidate(_ count: Int) -> some View {
        let shown = Array(entry.data.attention.prefix(count))
        let more = entry.data.attentionCount - shown.count
        return VStack(alignment: .leading, spacing: 0) {
            WidgetTitle(text: entry.data.labels.decideTitle)
                .padding(.bottom, 4)
            ForEach(shown) { event in
                EventRow(event: event, entry: entry)
                    .padding(.vertical, 3)
            }
            if more > 0 {
                Text("+\(more)")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .padding(.top, 2)
            }
        }
    }
}

struct DecideWidget: Widget {
    let kind = "DecideWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            DecideWidgetView(entry: entry)
        }
        .configurationDisplayName("Needs a decision")
        .description("The dates waiting for you, each with a tick to settle it.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
