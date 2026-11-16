import Foundation

// Days, and how a surface says them.
//
// Nothing is baked into the payload: a widget is drawn hours after the app
// last ran, so it counts from each date itself. A date is a local day,
// `YYYY-MM-DD`; a day number is that day's count since 1970, with no time zone
// in it. The Android twin is glance/WidgetData.kt.
public enum Countdown {
    private static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }

    public static func dayNumber(_ day: String) -> Int? {
        let parts = day.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]),
              (1970...2200).contains(y), (1...12).contains(m), d >= 1 else { return nil }
        guard let date = utc.date(from: DateComponents(year: y, month: m, day: d)) else { return nil }
        // "February 30" is no day: the calendar would roll it into March.
        let back = utc.dateComponents([.month, .day], from: date)
        guard back.month == m, back.day == d else { return nil }
        return Int((date.timeIntervalSince1970 / 86_400).rounded())
    }

    // Today, as the person holding the phone counts it.
    public static func todayNumber(now: Date = Date(), calendar: Calendar = .current) -> Int {
        let c = calendar.dateComponents([.year, .month, .day], from: now)
        guard let date = utc.date(from: DateComponents(year: c.year, month: c.month, day: c.day)) else { return 0 }
        return Int((date.timeIntervalSince1970 / 86_400).rounded())
    }

    public static func daysUntil(_ day: String, today: Int = todayNumber()) -> Int {
        (dayNumber(day) ?? today) - today
    }

    // "T-12d" before a date, "T+19d" after it, "T-0" on the day. The units are
    // the catalog's templates ("{{n}}d"), handed over with the labels.
    public static func tMinus(_ days: Int, labels: WidgetLabels) -> String {
        if days == 0 { return "T-0" }
        let distance = abs(days)
        let sign = days > 0 ? "-" : "+"
        let unit: String
        if distance < 60 {
            unit = labels.days.replacingOccurrences(of: "{{n}}", with: String(distance))
        } else if distance < 730 {
            unit = labels.months.replacingOccurrences(of: "{{n}}", with: String(Int((Double(distance) / 30.44).rounded())))
        } else {
            let years = (Double(distance) / 365.25 * 10).rounded() / 10
            let shown = years == years.rounded() ? String(Int(years)) : String(years)
            unit = labels.years.replacingOccurrences(of: "{{n}}", with: shown)
        }
        return "T\(sign)\(unit)"
    }

    public enum Urgency: Equatable { case past, urgent, soon, later }

    public static func urgency(_ days: Int) -> Urgency {
        if days < 0 { return .past }
        if days <= 14 { return .urgent }
        if days <= 60 { return .soon }
        return .later
    }

    // "Nov 21", in the app's language.
    public static func shortDate(_ day: String, locale: Locale) -> String {
        guard let number = dayNumber(day) else { return day }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.setLocalizedDateFormatFromTemplate("MMMd")
        return formatter.string(from: Date(timeIntervalSince1970: TimeInterval(number) * 86_400))
    }

    // Cents only on a small amount that has them: "$11.99", "$184".
    public static func money(_ amount: Double, currency: String, locale: Locale) -> String {
        let cents = abs(amount) < 100 && amount.truncatingRemainder(dividingBy: 1) != 0
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.locale = locale
        formatter.currencyCode = currency
        formatter.minimumFractionDigits = cents ? 2 : 0
        formatter.maximumFractionDigits = cents ? 2 : 0
        return formatter.string(from: NSNumber(value: amount)) ?? "\(currency) \(amount)"
    }
}
