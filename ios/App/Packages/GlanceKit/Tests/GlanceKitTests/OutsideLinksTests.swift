import XCTest
@testable import GlanceKit

final class OutsideLinksTests: XCTestCase {
    private var suite = ""
    private var store = SharedStore(defaults: nil)

    override func setUp() {
        suite = "glancekit-tests-\(UUID().uuidString)"
        store = SharedStore(defaults: UserDefaults(suiteName: suite))
    }

    override func tearDown() {
        UserDefaults().removePersistentDomain(forName: suite)
    }

    func testAnAddLinkCarriesTheNameEncoded() {
        XCTAssertEqual(OutsideLinks.addLink(name: nil), "thingglance://action/add")
        XCTAssertEqual(OutsideLinks.addLink(name: ""), "thingglance://action/add")
        XCTAssertEqual(OutsideLinks.addLink(name: "Pixel 9"), "thingglance://action/add?name=Pixel%209")
        XCTAssertEqual(OutsideLinks.addLink(name: "A&B=C?#/"), "thingglance://action/add?name=A%26B%3DC%3F%23%2F")
        XCTAssertEqual(OutsideLinks.addLink(name: "Küche"), "thingglance://action/add?name=K%C3%BCche")
    }

    func testAShareIsNamedByItsTitleThenItsTextWithoutLinks() {
        XCTAssertEqual(OutsideLinks.sharedName(subject: "Sony WH-1000XM5", text: "https://example.com/p/1"), "Sony WH-1000XM5")
        XCTAssertEqual(OutsideLinks.sharedName(subject: nil, text: "Look at this  Pixel 9\nhttps://example.com/x"), "Look at this Pixel 9")
        XCTAssertEqual(OutsideLinks.sharedName(subject: "   ", text: "Dishwasher"), "Dishwasher")
    }

    func testABareAddressNamesNothing() {
        XCTAssertNil(OutsideLinks.sharedName(subject: nil, text: "https://example.com/p/1"))
        XCTAssertNil(OutsideLinks.sharedName(subject: "", text: "  HTTP://EXAMPLE.COM  "))
        XCTAssertNil(OutsideLinks.sharedName(subject: nil, text: nil))
    }

    func testALongNameIsCut() {
        let name = OutsideLinks.sharedName(subject: String(repeating: "word ", count: 80), text: nil)
        XCTAssertEqual(name?.count, 199)
    }

    func testOnlyTheAppsOwnSchemeIsHandedOn() {
        store.setPendingLink("https://example.com/")
        XCTAssertNil(store.takeLink())
        store.setPendingLink("javascript:alert(1)")
        XCTAssertNil(store.takeLink())
        store.setPendingLink("ThingGlance://queue")
        XCTAssertEqual(store.takeLink(), "ThingGlance://queue")
    }

    func testAPlaceToOpenIsTakenOnceAndTheNewestWins() {
        store.setPendingLink(OutsideLinks.add)
        store.setPendingLink(OutsideLinks.queue)
        XCTAssertEqual(store.takeLink(), "thingglance://queue")
        XCTAssertNil(store.takeLink())
    }

    func testSharesQueueAndComeOutOldestFirstOneAtATime() {
        store.queueShare(name: "First")
        store.queueShare(name: nil)
        store.queueShare(name: "Third thing")
        XCTAssertEqual(store.takeLink(), "thingglance://action/add?name=First")
        XCTAssertEqual(store.takeLink(), "thingglance://action/add")
        XCTAssertEqual(store.takeLink(), "thingglance://action/add?name=Third%20thing")
        XCTAssertNil(store.takeLink())
    }

    func testAPlaceToOpenComesBeforeAShare() {
        store.queueShare(name: "Shared")
        store.setPendingLink(OutsideLinks.queue)
        XCTAssertEqual(store.takeLink(), "thingglance://queue")
        XCTAssertEqual(store.takeLink(), "thingglance://action/add?name=Shared")
    }

    func testWithNoGroupNothingIsKept() {
        let none = SharedStore(defaults: nil)
        none.setPendingLink(OutsideLinks.add)
        none.queueShare(name: "x")
        XCTAssertNil(none.takeLink())
    }
}
