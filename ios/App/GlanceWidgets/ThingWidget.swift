import AppIntents
import GlanceKit
import SwiftUI
import WidgetKit

// "A single thing": one thing's life-left ring, its verdict and how long it
// has. Long-press, Edit Widget, and pick which; left alone it shows the thing
// closest to the end of its window.

struct ThingEntity: AppEntity {
    static let typeDisplayRepresentation: TypeDisplayRepresentation = "Thing"
    static let defaultQuery = ThingQuery()

    let id: String
    let name: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(name)")
    }
}

struct ThingQuery: EntityQuery {
    // A thing that is gone still answers, without a name: the widget keeps
    // its choice and says the thing is no longer tracked, where dropping the
    // choice would quietly show a different thing.
    func entities(for identifiers: [String]) async throws -> [ThingEntity] {
        let things = SharedStore().widgetData().things
        return identifiers.map { id in ThingEntity(id: id, name: things.first { $0.id == id }?.name ?? "") }
    }

    func suggestedEntities() async throws -> [ThingEntity] {
        SharedStore().widgetData().things.map { ThingEntity(id: $0.id, name: $0.name) }
    }
}

struct PickThingIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "A single thing"
    static let description = IntentDescription("Which thing the widget shows. Left empty, the one closest to the end of its window.")

    @Parameter(title: "Thing")
    var thing: ThingEntity?

    init() {}
}

struct ThingEntry: TimelineEntry {
    let date: Date
    let snapshot: SnapshotEntry
    let chosenId: String?
}

struct ThingProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ThingEntry {
        ThingEntry(date: Date(), snapshot: SnapshotProvider().placeholder(in: context), chosenId: nil)
    }

    func snapshot(for configuration: PickThingIntent, in context: Context) async -> ThingEntry {
        ThingEntry(date: Date(), snapshot: .read(), chosenId: configuration.thing?.id)
    }

    func timeline(for configuration: PickThingIntent, in context: Context) async -> Timeline<ThingEntry> {
        Timeline(entries: [ThingEntry(date: Date(), snapshot: .read(), chosenId: configuration.thing?.id)], policy: .after(nextMidnight()))
    }
}

struct LifeRing: View {
    let thing: WidgetThing
    var size: Double = 46

    var body: some View {
        ZStack {
            Circle().stroke(Color.primary.opacity(0.14), lineWidth: 5)
            if let share = thing.remaining, share > 0 {
                Circle()
                    .trim(from: 0, to: max(0.012, share))
                    .stroke(Tone.verdict(thing.verdict), style: StrokeStyle(lineWidth: 5, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
            if let share = thing.remaining {
                Text(String(Int((share * 100).rounded())))
                    .font(.system(size: size * 0.28, weight: .bold, design: .monospaced))
                    .foregroundStyle(.primary)
            }
        }
        .frame(width: size, height: size)
    }
}

struct ThingWidgetView: View {
    let entry: ThingEntry

    @Environment(\.widgetFamily) private var family

    private var data: WidgetData { entry.snapshot.data }

    var body: some View {
        let thing = data.thing(chosenId: entry.chosenId)
        return Group {
            if !entry.snapshot.groupAvailable {
                GroupProblem()
            } else if let thing {
                if family == .systemSmall { small(thing) } else { medium(thing) }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Spacer(minLength: 0)
                    QuietLine(text: !data.loaded ? data.labels.nextEmpty : entry.chosenId != nil ? data.labels.thingGone : data.labels.thingNone)
                    Spacer(minLength: 0)
                    Wordmark()
                }
            }
        }
        .widgetSurface(thing.flatMap { URL(string: "thingglance://thing/\($0.id)") } ?? thingsURL)
    }

    private func line(_ thing: WidgetThing) -> String {
        let verdict = data.labels.verdicts[thing.verdict] ?? thing.verdict
        guard let end = thing.lifeEnd else { return verdict }
        return "\(verdict) · \(Countdown.tMinus(entry.snapshot.days(to: end), labels: data.labels))"
    }

    private func small(_ thing: WidgetThing) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            LifeRing(thing: thing, size: 54)
            Spacer(minLength: 0)
            Text(thing.name)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
            Text(line(thing))
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    private func medium(_ thing: WidgetThing) -> some View {
        HStack(spacing: 14) {
            LifeRing(thing: thing, size: 72)
            VStack(alignment: .leading, spacing: 3) {
                Text(thing.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(2)
                Text(line(thing))
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Wordmark(size: 12)
            }
            Spacer(minLength: 0)
        }
    }
}

struct ThingWidget: Widget {
    let kind = "ThingWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: kind, intent: PickThingIntent.self, provider: ThingProvider()) { entry in
            ThingWidgetView(entry: entry)
        }
        .configurationDisplayName("A single thing")
        .description("One thing: how much of its life is left, and where it stands.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
