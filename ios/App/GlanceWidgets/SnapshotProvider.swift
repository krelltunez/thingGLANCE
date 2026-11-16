import GlanceKit
import SwiftUI
import WidgetKit

// One reading of the store, and the day it was read on.
struct SnapshotEntry: TimelineEntry {
    let date: Date
    let data: WidgetData
    let today: Int
    // False when the App Group is missing from the entitlements or the
    // profile: said out loud, because otherwise it looks like a new install.
    let groupAvailable: Bool

    static func read(at date: Date = Date()) -> SnapshotEntry {
        SnapshotEntry(date: date, data: SharedStore().widgetData(), today: Countdown.todayNumber(now: date), groupAvailable: SharedStore.isAvailable)
    }

    func days(to day: String) -> Int { Countdown.daysUntil(day, today: today) }
}

// The provider every widget shares. Two things change what a widget should
// show: the app handing over a new payload (it reloads the timelines itself),
// and the day turning, which moves every countdown by one. Only the second
// needs asking for, so each timeline is one entry and a refresh at midnight.
struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry {
        SnapshotEntry(date: Date(), data: WidgetData(), today: Countdown.todayNumber(), groupAvailable: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(.read())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        completion(Timeline(entries: [.read()], policy: .after(nextMidnight())))
    }
}

func nextMidnight(after now: Date = Date()) -> Date {
    let calendar = Calendar.current
    let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now.addingTimeInterval(3600)
    // A refresh has to be ahead, or WidgetKit has nothing to schedule.
    return midnight > now ? midnight : now.addingTimeInterval(3600)
}
