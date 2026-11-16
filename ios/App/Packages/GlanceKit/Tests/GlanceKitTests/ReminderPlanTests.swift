import XCTest
@testable import GlanceKit

final class ReminderPlanTests: XCTestCase {
    private func reminder(_ id: String, at: Int64, title: String = "t") -> PlannedReminder {
        PlannedReminder(id: id, eventKey: "key-\(id)", at: at, title: title, body: "b", link: "thingglance://queue")
    }

    func testThePayloadIsReadAsTheAppWritesIt() throws {
        let json = """
        {"snapshot":{"reminders":[
          {"id":"coverage-end:c1:heads-up","eventKey":"coverage-end:c1","at":1800000000000,"title":"Warranty ends","body":"In 30 days","link":"thingglance://thing/t1"},
          {"id":"","at":5},
          {"id":"x","at":0},
          {"id":"renewal:s1:last-call","eventKey":"renewal:s1","at":1800000500000.0,"title":"Renews","body":"In 3 days"}
        ]},"labels":{"done":"Done with this","send":"Send to dayGLANCE"},"canSend":true}
        """
        let order = try XCTUnwrap(ReminderPlan.order(fromPayload: json))
        XCTAssertEqual(order.reminders.map(\.id), ["coverage-end:c1:heads-up", "renewal:s1:last-call"])
        XCTAssertEqual(order.reminders[0].at, 1_800_000_000_000)
        XCTAssertEqual(order.reminders[0].link, "thingglance://thing/t1")
        // No link: the queue.
        XCTAssertEqual(order.reminders[1].link, "thingglance://queue")
        XCTAssertEqual(order.labels, ReminderLabels(done: "Done with this", send: "Send to dayGLANCE"))
        XCTAssertTrue(order.canSend)
    }

    func testAPayloadWithoutLabelsStillHasAButton() throws {
        let order = try XCTUnwrap(ReminderPlan.order(fromPayload: "{\"snapshot\":{}}"))
        XCTAssertTrue(order.reminders.isEmpty)
        XCTAssertEqual(order.labels.done, ReminderLabels.fallback.done)
        XCTAssertFalse(order.canSend)
        XCTAssertNil(ReminderPlan.order(fromPayload: "nope"))
        XCTAssertNil(ReminderPlan.order(fromPayload: nil))
    }

    func testNewOnesAreScheduledAndGoneOnesCancelled() {
        let a = reminder("a", at: 2000), b = reminder("b", at: 3000)
        let held = ["a": a.signature(canSend: false), "old": "whatever"]
        let diff = ReminderPlan.diff(wanted: [b, a], held: held, canSend: false, now: 1000)
        XCTAssertEqual(diff.schedule, [b])
        XCTAssertEqual(diff.keep, [a])
        XCTAssertEqual(diff.cancel, ["old"])
    }

    func testAChangedOneIsScheduledAgain() {
        let before = reminder("a", at: 2000), after = reminder("a", at: 2000, title: "new words")
        let diff = ReminderPlan.diff(wanted: [after], held: ["a": before.signature(canSend: false)], canSend: false, now: 1000)
        XCTAssertEqual(diff.schedule, [after])
        XCTAssertTrue(diff.cancel.isEmpty)
    }

    func testGainingTheSendButtonSchedulesAgain() {
        let a = reminder("a", at: 2000)
        let diff = ReminderPlan.diff(wanted: [a], held: ["a": a.signature(canSend: false)], canSend: true, now: 1000)
        XCTAssertEqual(diff.schedule, [a])
    }

    func testWhatIsPastIsNotWantedAndIsCancelledIfHeld() {
        let past = reminder("p", at: 500)
        let diff = ReminderPlan.diff(wanted: [past], held: ["p": past.signature(canSend: false)], canSend: false, now: 1000)
        XCTAssertTrue(diff.schedule.isEmpty)
        XCTAssertEqual(diff.cancel, ["p"])
    }

    func testOnlyTheSoonestFitUnderTheLimit() {
        let many = (1...70).map { reminder("r\($0)", at: Int64(1000 + $0)) }
        let diff = ReminderPlan.diff(wanted: many.reversed(), held: [:], canSend: false, now: 0)
        XCTAssertEqual(diff.schedule.count, ReminderPlan.limit)
        XCTAssertEqual(diff.schedule.first?.id, "r1")
        XCTAssertEqual(diff.schedule.last?.id, "r56")
        // One that no longer fits is cancelled if it was pending.
        let late = many[69]
        let again = ReminderPlan.diff(wanted: many, held: [late.id: late.signature(canSend: false)], canSend: false, now: 0)
        XCTAssertEqual(again.cancel, [late.id])
    }

    func testTheSameIdTwiceIsOneReminder() {
        let diff = ReminderPlan.diff(wanted: [reminder("a", at: 3000), reminder("a", at: 2000)], held: [:], canSend: false, now: 0)
        XCTAssertEqual(diff.schedule.map(\.at), [2000])
    }
}
