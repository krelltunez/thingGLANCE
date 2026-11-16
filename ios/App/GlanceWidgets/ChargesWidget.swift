import GlanceKit
import SwiftUI
import WidgetKit

// "Plans, next 30 days": what will be charged, and what it adds up to.
struct ChargesWidgetView: View {
    let entry: SnapshotEntry

    @Environment(\.widgetFamily) private var family

    private var data: WidgetData { entry.data }

    private func money(_ amount: Double) -> String {
        Countdown.money(amount, currency: data.currency, locale: data.locale)
    }

    var body: some View {
        Group {
            if !entry.groupAvailable {
                GroupProblem()
            } else if family == .systemSmall {
                small
            } else if data.charges.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    WidgetTitle(text: data.labels.chargesTitle)
                    Spacer(minLength: 0)
                    QuietLine(text: data.loaded ? data.labels.chargesEmpty : data.labels.nextEmpty)
                    Spacer(minLength: 0)
                    Wordmark()
                }
            } else {
                ViewThatFits(in: .vertical) {
                    ForEach([8, 7, 6, 5, 4, 3, 2, 1], id: \.self) { count in
                        candidate(count)
                    }
                }
            }
        }
        .widgetSurface(plansURL)
    }

    // The total, and how many charges make it.
    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            WidgetTitle(text: data.labels.chargesTitle)
            Spacer(minLength: 0)
            if data.chargesCount > 0 {
                Text(money(data.chargesTotal))
                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                if let first = data.charges.first {
                    Text("\(Countdown.shortDate(first.date, locale: data.locale)) · \(first.name)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            } else {
                QuietLine(text: data.loaded ? data.labels.chargesEmpty : data.labels.nextEmpty)
            }
            Spacer(minLength: 0)
            Wordmark(size: 12)
        }
    }

    private func candidate(_ count: Int) -> some View {
        let shown = Array(data.charges.prefix(count))
        let more = data.chargesCount - shown.count
        return VStack(alignment: .leading, spacing: 0) {
            HStack {
                WidgetTitle(text: data.labels.chargesTitle)
                Spacer(minLength: 8)
                Text(money(data.chargesTotal))
                    .font(.system(size: 13, weight: .bold, design: .monospaced))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
            }
            .padding(.bottom, 4)
            ForEach(Array(shown.enumerated()), id: \.offset) { _, charge in
                Link(destination: linkURL(charge.link, or: plansURL)) {
                    HStack(spacing: 8) {
                        Text(Countdown.shortDate(charge.date, locale: data.locale))
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .frame(width: 52, alignment: .leading)
                        Text(charge.name)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        Text(money(charge.amount))
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                    }
                }
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

struct ChargesWidget: Widget {
    let kind = "ChargesWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SnapshotProvider()) { entry in
            ChargesWidgetView(entry: entry)
        }
        .configurationDisplayName("Plans, next 30 days")
        .description("What your plans will charge in the next 30 days.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}
