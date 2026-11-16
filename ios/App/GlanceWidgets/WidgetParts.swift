import GlanceKit
import SwiftUI
import WidgetKit

// What the widgets are drawn with. The colours are the app's own (the same
// pairs Android's widgets use, glance/WidgetParts.kt), light and dark.

private func tone(_ light: UInt32, _ dark: UInt32) -> Color {
    func color(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
    return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? color(dark) : color(light) })
}

enum Tone {
    static let accent = tone(0x0284C7, 0x38BDF8)
    static let warn = tone(0xB45309, 0xFBBF24)
    static let bad = tone(0xB91C1C, 0xF87171)
    static let ok = tone(0x059669, 0x34D399)
    static let quiet = tone(0x64748B, 0x94A3B8)

    static func urgency(_ days: Int) -> Color {
        switch Countdown.urgency(days) {
        case .past: return bad
        case .urgent: return warn
        default: return accent
        }
    }

    static func verdict(_ verdict: String) -> Color {
        switch verdict {
        case "prime": return ok
        case "solid": return accent
        case "watch": return warn
        case "replace", "overdue": return bad
        default: return quiet
        }
    }
}

let queueURL = URL(string: "thingglance://queue")!
let plansURL = URL(string: "thingglance://view/plans")!
let thingsURL = URL(string: "thingglance://view/things")!
let addURL = URL(string: "thingglance://action/add")!

func linkURL(_ link: String, or fallback: URL) -> URL { URL(string: link) ?? fallback }

// "T-12d" on its tinted ground.
struct CountdownBadge: View {
    let days: Int
    let labels: WidgetLabels
    var wide = false

    var body: some View {
        Text(Countdown.tMinus(days, labels: labels))
            .font(.system(size: wide ? 14 : 12, weight: .bold, design: .monospaced))
            .foregroundStyle(Tone.urgency(days))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .frame(width: wide ? 64 : 56)
            .padding(.vertical, 4)
            .background(Tone.urgency(days).opacity(0.14), in: RoundedRectangle(cornerRadius: 8))
    }
}

struct WidgetTitle: View {
    let text: String

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .bold))
            .foregroundStyle(.secondary)
            .lineLimit(1)
    }
}

// A line in place of a list: nothing to show, or nothing read yet.
struct QuietLine: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 14))
            .foregroundStyle(.primary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct Wordmark: View {
    var size: Double = 14

    var body: some View {
        HStack(spacing: 0) {
            Text("thing").font(.system(size: size, weight: .bold)).foregroundStyle(.primary)
            Text("GLANCE").font(.system(size: size, weight: .bold)).italic().foregroundStyle(Tone.accent)
        }
    }
}

// The row's buttons: a tick for a date that is waiting, and the hand-off to
// dayGLANCE where this device can make one. A date already handed over shows
// the mark instead.
struct RowActions: View {
    let event: WidgetEvent
    let data: WidgetData

    var body: some View {
        HStack(spacing: 2) {
            if event.state == "sent" {
                Image(systemName: "paperplane.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(Tone.accent)
                    .frame(width: 30, height: 30)
                    .accessibilityLabel(data.labels.sent)
            } else if data.canSend(event) {
                Button(intent: SendEventIntent(eventKey: event.key)) {
                    Image(systemName: "paperplane")
                        .font(.system(size: 14))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(data.labels.send)
            }
            if data.needsDecision(event) {
                Button(intent: DecideEventIntent(eventKey: event.key)) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 18))
                        .foregroundStyle(.secondary)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(data.labels.done)
            }
        }
    }
}

// One date: the countdown, what it is, and its buttons. The words open the
// date in the app; the buttons stay outside that link so their taps are theirs.
struct EventRow: View {
    let event: WidgetEvent
    let entry: SnapshotEntry
    var wide = false

    var body: some View {
        HStack(spacing: 8) {
            Link(destination: linkURL(event.link, or: queueURL)) {
                HStack(spacing: 10) {
                    CountdownBadge(days: entry.days(to: event.date), labels: entry.data.labels, wide: wide)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(event.title)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(.primary)
                            .lineLimit(1)
                        Text("\(event.detail) · \(Countdown.shortDate(event.date, locale: entry.data.locale))")
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    Spacer(minLength: 0)
                }
            }
            RowActions(event: event, data: entry.data)
        }
    }
}

// Shown in place of everything when the App Group cannot be read.
struct GroupProblem: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Wordmark()
            Text("The app's shared storage is unavailable.")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

extension View {
    // The widget's ground, and what a tap outside any row opens.
    func widgetSurface(_ url: URL) -> some View {
        self
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .containerBackground(for: .widget) { Color(uiColor: .systemBackground) }
            .widgetURL(url)
    }
}
