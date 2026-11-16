import XCTest
@testable import GlanceKit

final class PendingWritesTests: XCTestCase {
    private func ids(_ queue: [PendingWrites.Entry]) -> [String] { queue.compactMap { $0["clientId"] as? String } }

    func testADecideIsTheObjectTheAppApplies() throws {
        let queue = PendingWrites.addingDecide([], eventKey: "coverage-end:c1", clientId: "notification:r1:done")
        XCTAssertEqual(queue.count, 1)
        XCTAssertEqual(queue[0]["action"] as? String, "decide")
        XCTAssertEqual(queue[0]["clientId"] as? String, "notification:r1:done")
        let payload = try XCTUnwrap(queue[0]["payload"] as? [String: Any])
        XCTAssertEqual(payload["event_key"] as? String, "coverage-end:c1")
        XCTAssertEqual(payload["state"] as? String, "done")
    }

    func testASecondTickOnTheSameDateAddsNothing() {
        var queue = PendingWrites.addingDecide([], eventKey: "k", clientId: "a")
        queue = PendingWrites.addingDecide(queue, eventKey: "k", clientId: "b")
        XCTAssertEqual(ids(queue), ["a"])
    }

    func testTheSameIdIsQueuedOnce() {
        var queue = PendingWrites.addingDecide([], eventKey: "k1", clientId: "a")
        queue = PendingWrites.addingDecide(queue, eventKey: "k2", clientId: "a")
        XCTAssertEqual(queue.count, 1)
    }

    func testASendIsNotQueuedForADateBeingSettled() {
        var queue = PendingWrites.addingDecide([], eventKey: "k", clientId: "a")
        queue = PendingWrites.addingSend(queue, eventKey: "k", clientId: "b")
        XCTAssertEqual(ids(queue), ["a"])
        queue = PendingWrites.addingSend(queue, eventKey: "other", clientId: "c")
        XCTAssertEqual(ids(queue), ["a", "c"])
        XCTAssertEqual(PendingWrites.keys(in: queue, action: PendingWrites.send), ["other"])
    }

    func testARestoreIsNotATick() {
        let queue: [PendingWrites.Entry] = [["action": "decide", "clientId": "x", "payload": ["event_key": "k", "state": "restore"]]]
        XCTAssertTrue(PendingWrites.keys(in: queue, action: PendingWrites.decide).isEmpty)
    }

    func testAcknowledgingRemovesOnlyWhatWasApplied() {
        var queue = PendingWrites.addingDecide([], eventKey: "k1", clientId: "a")
        queue = PendingWrites.addingDecide(queue, eventKey: "k2", clientId: "b")
        XCTAssertEqual(ids(PendingWrites.acknowledging(queue, clientIds: ["a"])), ["b"])
    }

    func testTheQueueKeepsTheNewest() {
        var queue: [PendingWrites.Entry] = []
        for i in 0..<(PendingWrites.maxPending + 5) { queue = PendingWrites.addingDecide(queue, eventKey: "k\(i)", clientId: "id\(i)") }
        XCTAssertEqual(queue.count, PendingWrites.maxPending)
        XCTAssertEqual(queue.first?["clientId"] as? String, "id5")
    }

    func testItSurvivesTheTripThroughJson() {
        let queue = PendingWrites.addingSend(PendingWrites.addingDecide([], eventKey: "k1", clientId: "a"), eventKey: "k2", clientId: "b")
        XCTAssertEqual(ids(PendingWrites.parse(PendingWrites.encode(queue))), ["a", "b"])
        XCTAssertTrue(PendingWrites.parse("not json").isEmpty)
        XCTAssertTrue(PendingWrites.parse(nil).isEmpty)
        XCTAssertEqual(PendingWrites.encode([]), "[]")
    }
}
