import XCTest
@testable import GlanceKit

final class WidgetDataTests: XCTestCase {
    private let payload = """
    {"snapshot":{"version":1,"locale":"en","currency":"EUR",
      "counts":{"attention":5},
      "attention":[
        {"key":"support-end:t9:2026-10-27","type":"support-end","date":"2026-10-27","title":"Security updates end","detail":"Pixel 6","state":"open","link":"thingglance://event/a"},
        {"key":"trial-end:s27:2026-11-21","type":"trial-end","date":"2026-11-21","title":"Trial converts","detail":"Adobe","state":"sent"},
        {"key":"","date":"2026-11-21"},
        {"key":"bad-date","date":"2026-13-40"}
      ],
      "upcoming":[
        {"key":"renewal:s1:2026-12-26","type":"renewal","date":"2026-12-26","title":"Renews","detail":"1Password","state":"done"},
        {"key":"renewal:s2:2027-01-05","type":"renewal","date":"2027-01-05","title":"Renews","detail":"C2","state":"open"}
      ],
      "charges":{"total":184.4,"count":6,"items":[
        {"subscriptionId":"s1","name":"1Password","date":"2026-12-26","amount":59.88,"link":"thingglance://plan/s1"},
        {"subscriptionId":"","name":"x","date":"2026-12-26","amount":1}
      ]},
      "things":[
        {"id":"t1","name":"MacBook","verdict":"solid","remaining":0.62,"lifeEnd":"2029-03-01"},
        {"id":"t9","name":"Pixel 6","verdict":"overdue","remaining":0,"lifeEnd":"2026-10-27"},
        {"id":"t3","name":"Lamp","verdict":"unknown","remaining":null,"lifeEnd":null},
        {"name":"no id"}
      ]},
     "labels":{"decideTitle":"Entscheiden","verdicts":{"solid":"Solide"},"waiting":["Nichts","1 wartet","2 warten"],"days":"{{n}} T."},
     "canSend":true}
    """

    func testThePayloadIsReadAsTheAppWritesIt() {
        let data = WidgetData.parse(payload)
        XCTAssertTrue(data.loaded)
        XCTAssertTrue(data.canSend)
        XCTAssertEqual(data.currency, "EUR")
        XCTAssertEqual(data.attention.map(\.key), ["support-end:t9:2026-10-27", "trial-end:s27:2026-11-21"])
        XCTAssertEqual(data.attention[0].link, "thingglance://event/a")
        // No link: the queue.
        XCTAssertEqual(data.attention[1].link, "thingglance://queue")
        // The count is the whole queue's, not the few rows that travelled.
        XCTAssertEqual(data.attentionCount, 5)
        XCTAssertEqual(data.upcoming.count, 2)
        XCTAssertEqual(data.chargesCount, 6)
        XCTAssertEqual(data.chargesTotal, 184.4, accuracy: 0.001)
        XCTAssertEqual(data.charges.map(\.subscriptionId), ["s1"])
        XCTAssertEqual(data.things.map(\.id), ["t1", "t9", "t3"])
        XCTAssertNil(data.things[2].remaining)
        XCTAssertNil(data.things[2].lifeEnd)
    }

    func testLabelsComeFromTheAppAndFallBackOneByOne() {
        let labels = WidgetData.parse(payload).labels
        XCTAssertEqual(labels.decideTitle, "Entscheiden")
        XCTAssertEqual(labels.nextTitle, "Next up")
        XCTAssertEqual(labels.verdicts["solid"], "Solide")
        XCTAssertEqual(labels.days, "{{n}} T.")
        // Loaded, so an empty list is known to be empty.
        XCTAssertEqual(labels.decideEmpty, "Nothing needs a decision")
    }

    func testWithNoPayloadItSaysToOpenTheApp() {
        for nothing in [nil, "", "not json", "{\"labels\":{}}"] as [String?] {
            let data = WidgetData.parse(nothing)
            XCTAssertFalse(data.loaded)
            XCTAssertEqual(data.labels.decideEmpty, "Open thingGLANCE to load your dates")
            XCTAssertNil(data.next())
        }
    }

    func testTheWaitingLineIsPickedByCount() {
        var data = WidgetData.parse(payload)
        // Five waiting, three phrases: the last one stands for the rest.
        XCTAssertEqual(data.waitingText, "2 warten")
        data.attentionCount = 1
        XCTAssertEqual(data.waitingText, "1 wartet")
        XCTAssertNil(WidgetData().waitingText)
    }

    func testATickedDateIsGoneAtOnce() {
        let data = WidgetData.parse(payload).without(["support-end:t9:2026-10-27"])
        XCTAssertEqual(data.attention.map(\.key), ["trial-end:s27:2026-11-21"])
        XCTAssertEqual(data.attentionCount, 4)
        XCTAssertEqual(WidgetData.parse(payload).without([]), WidgetData.parse(payload))
    }

    func testADateBeingSentIsMarked() {
        let data = WidgetData.parse(payload).sending(["support-end:t9:2026-10-27", "renewal:s1:2026-12-26"])
        XCTAssertEqual(data.attention[0].state, "sent")
        // Only an open date changes: a done one stays done.
        XCTAssertEqual(data.upcoming[0].state, "done")
    }

    func testOnlyAnOpenDateInTheQueueCanBeSent() {
        let data = WidgetData.parse(payload)
        XCTAssertTrue(data.canSend(data.attention[0]))
        XCTAssertFalse(data.canSend(data.attention[1]))
        XCTAssertFalse(data.canSend(data.upcoming[1]))
        var offline = data
        offline.canSend = false
        XCTAssertFalse(offline.canSend(data.attention[0]))
    }

    func testNextIsTheQueueFirstThenWhatIsAhead() {
        let today = Countdown.dayNumber("2026-11-15")!
        var data = WidgetData.parse(payload)
        XCTAssertEqual(data.next(today: today)?.key, "support-end:t9:2026-10-27")
        data.attention = []
        // The settled renewal is passed over.
        XCTAssertEqual(data.next(today: today)?.key, "renewal:s2:2027-01-05")
        XCTAssertNil(data.next(today: Countdown.dayNumber("2027-02-01")!))
    }

    func testTheThingShownIsTheChosenOneOrTheOneClosestToItsEnd() {
        let data = WidgetData.parse(payload)
        XCTAssertEqual(data.thing(chosenId: "t1")?.name, "MacBook")
        XCTAssertEqual(data.thing(chosenId: nil)?.name, "Pixel 6")
        XCTAssertNil(data.thing(chosenId: "gone"))
        XCTAssertNil(WidgetData().thing(chosenId: nil))
    }

    func testTheStoreAppliesWhatWasDoneOutsideTheApp() {
        let suite = "glancekit-tests-\(UUID().uuidString)"
        defer { UserDefaults().removePersistentDomain(forName: suite) }
        let store = SharedStore(defaults: UserDefaults(suiteName: suite))
        XCTAssertFalse(store.widgetData().loaded)
        store.writePayload(payload)
        store.queueDecide(eventKey: "trial-end:s27:2026-11-21", clientId: "a")
        store.queueSend(eventKey: "support-end:t9:2026-10-27", clientId: "b")
        let data = store.widgetData()
        XCTAssertEqual(data.attention.map(\.key), ["support-end:t9:2026-10-27"])
        XCTAssertEqual(data.attention[0].state, "sent")
    }
}
