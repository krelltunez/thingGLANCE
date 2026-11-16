import XCTest
@testable import GlanceKit

final class CountdownTests: XCTestCase {
    private let labels = WidgetLabels()

    func testADayIsCountedFrom1970() {
        XCTAssertEqual(Countdown.dayNumber("1970-01-01"), 0)
        XCTAssertEqual(Countdown.dayNumber("1970-01-02"), 1)
        XCTAssertEqual(Countdown.dayNumber("2026-11-15"), 20772)
        XCTAssertEqual(Countdown.dayNumber("2028-02-29"), Countdown.dayNumber("2028-02-28")! + 1)
    }

    func testWhatIsNotADayIsNil() {
        for bad in ["", "2026-11", "2026-13-01", "2026-02-30", "2026-00-10", "2026-11-00", "1969-12-31", "nope", "2026-1x-01"] {
            XCTAssertNil(Countdown.dayNumber(bad), bad)
        }
    }

    func testTodayIsTheLocalDay() {
        var tokyo = Calendar(identifier: .gregorian)
        tokyo.timeZone = TimeZone(identifier: "Asia/Tokyo")!
        var denver = Calendar(identifier: .gregorian)
        denver.timeZone = TimeZone(identifier: "America/Denver")!
        // 2026-11-16T05:00Z: the 16th in Tokyo, still the 15th in Denver.
        let now = Date(timeIntervalSince1970: 1_794_805_200)
        XCTAssertEqual(Countdown.todayNumber(now: now, calendar: tokyo), Countdown.dayNumber("2026-11-16"))
        XCTAssertEqual(Countdown.todayNumber(now: now, calendar: denver), Countdown.dayNumber("2026-11-15"))
    }

    func testDaysUntil() {
        let today = Countdown.dayNumber("2026-11-15")!
        XCTAssertEqual(Countdown.daysUntil("2026-11-27", today: today), 12)
        XCTAssertEqual(Countdown.daysUntil("2026-10-27", today: today), -19)
        XCTAssertEqual(Countdown.daysUntil("not a day", today: today), 0)
    }

    func testTMinusReadsAsTheAppDoes() {
        XCTAssertEqual(Countdown.tMinus(0, labels: labels), "T-0")
        XCTAssertEqual(Countdown.tMinus(12, labels: labels), "T-12d")
        XCTAssertEqual(Countdown.tMinus(-19, labels: labels), "T+19d")
        XCTAssertEqual(Countdown.tMinus(59, labels: labels), "T-59d")
        XCTAssertEqual(Countdown.tMinus(60, labels: labels), "T-2mo")
        XCTAssertEqual(Countdown.tMinus(365, labels: labels), "T-12mo")
        XCTAssertEqual(Countdown.tMinus(730, labels: labels), "T-2y")
        XCTAssertEqual(Countdown.tMinus(900, labels: labels), "T-2.5y")
        XCTAssertEqual(Countdown.tMinus(-800, labels: labels), "T+2.2y")
    }

    func testTheUnitsAreTheCatalogs() {
        var german = WidgetLabels()
        german.days = "{{n}} T."
        XCTAssertEqual(Countdown.tMinus(5, labels: german), "T-5 T.")
    }

    func testUrgency() {
        XCTAssertEqual(Countdown.urgency(-1), .past)
        XCTAssertEqual(Countdown.urgency(0), .urgent)
        XCTAssertEqual(Countdown.urgency(14), .urgent)
        XCTAssertEqual(Countdown.urgency(15), .soon)
        XCTAssertEqual(Countdown.urgency(61), .later)
    }

    func testDatesAndMoneyFollowTheAppsLanguage() {
        let en = Locale(identifier: "en-US")
        XCTAssertEqual(Countdown.shortDate("2026-11-21", locale: en), "Nov 21")
        XCTAssertEqual(Countdown.shortDate("junk", locale: en), "junk")
        XCTAssertEqual(Countdown.money(11.99, currency: "USD", locale: en), "$11.99")
        XCTAssertEqual(Countdown.money(184, currency: "USD", locale: en), "$184")
        XCTAssertEqual(Countdown.money(184.5, currency: "USD", locale: en), "$184")
        XCTAssertEqual(Countdown.money(12, currency: "USD", locale: en), "$12")
    }
}
