import XCTest
@testable import GlanceKit

final class SharedStoreTests: XCTestCase {
    private var suite = ""
    private var store = SharedStore(defaults: nil)

    override func setUp() {
        suite = "glancekit-tests-\(UUID().uuidString)"
        store = SharedStore(defaults: UserDefaults(suiteName: suite))
    }

    override func tearDown() {
        UserDefaults().removePersistentDomain(forName: suite)
    }

    func testThePayloadIsKeptAsWritten() {
        XCTAssertNil(store.readPayload())
        XCTAssertNil(store.checkedAt())
        store.writePayload("{\"snapshot\":{}}", now: Date(timeIntervalSince1970: 100))
        XCTAssertEqual(store.readPayload(), "{\"snapshot\":{}}")
        XCTAssertEqual(store.checkedAt(), Date(timeIntervalSince1970: 100))
    }

    func testAHeartbeatMovesTheClockAndKeepsTheLastSync() {
        store.touchHeartbeat(syncedAt: "2026-11-15T10:00:00.000Z", now: Date(timeIntervalSince1970: 200))
        store.touchHeartbeat(syncedAt: nil, now: Date(timeIntervalSince1970: 300))
        XCTAssertEqual(store.checkedAt(), Date(timeIntervalSince1970: 300))
        XCTAssertEqual(store.syncedAt(), "2026-11-15T10:00:00.000Z")
    }

    func testWritesStayQueuedUntilAcknowledged() {
        store.queueDecide(eventKey: "k1", clientId: "a")
        store.queueSend(eventKey: "k2", clientId: "b")
        XCTAssertEqual(store.pendingDecideKeys(), ["k1"])
        XCTAssertEqual(store.pendingSendKeys(), ["k2"])
        XCTAssertEqual(PendingWrites.parse(store.pendingWrites()).count, 2)
        store.acknowledge(clientIds: ["a"])
        XCTAssertTrue(store.pendingDecideKeys().isEmpty)
        XCTAssertEqual(store.pendingSendKeys(), ["k2"])
    }

    func testAnIdIsMintedWhenNoneIsGiven() {
        store.queueDecide(eventKey: "k1")
        let id = PendingWrites.parse(store.pendingWrites()).first?["clientId"] as? String
        XCTAssertTrue(id?.hasPrefix("widget:") ?? false)
    }

    func testWithNoGroupNothingIsKeptAndNothingCrashes() {
        let none = SharedStore(defaults: nil)
        none.writePayload("{}")
        none.queueDecide(eventKey: "k")
        XCTAssertNil(none.readPayload())
        XCTAssertEqual(none.pendingWrites(), "[]")
    }
}
