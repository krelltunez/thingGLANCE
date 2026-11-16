import Foundation
import GlanceKit
import UserNotifications

// Makes the system's pending notifications match the reminder plan.
//
// The plan is decided in src/core/reminders.ts and arrives inside the payload
// the app hands over (WidgetBridgePlugin.updateSnapshot). iOS delivers a
// scheduled notification with the app closed, so this runs only when the app
// does: each run schedules what is new, cancels what is gone and leaves the
// rest alone. The Android twin is reminders/ReminderScheduler.kt.
//
// The system is the only record of what is pending. Each request carries the
// reminder it was made from in its userInfo, signature included, so there is
// no second list to drift from the first.
enum ReminderScheduler {
    // One category with the Done button, one with Send as well.
    static let categoryDone = "tg.date"
    static let categoryDoneSend = "tg.date.send"
    static let actionDone = "tg.done"
    static let actionSend = "tg.send"

    private static let keyLabels = "tg_reminder_labels"
    // One run at a time: two overlapping diffs would each schedule the same one.
    private static let queue = DispatchQueue(label: "com.thingglance.app.reminders")

    // At launch, from the words last handed over: the buttons of a
    // notification delivered while the app was closed need their category.
    static func registerCategories(_ labels: ReminderLabels? = nil) {
        let l = labels ?? storedLabels()
        let done = UNNotificationAction(identifier: actionDone, title: l.done, options: [])
        var categories: Set<UNNotificationCategory> = [
            UNNotificationCategory(identifier: categoryDone, actions: [done], intentIdentifiers: [], options: []),
        ]
        if !l.send.isEmpty {
            let send = UNNotificationAction(identifier: actionSend, title: l.send, options: [])
            categories.insert(UNNotificationCategory(identifier: categoryDoneSend, actions: [done, send], intentIdentifiers: [], options: []))
        }
        UNUserNotificationCenter.current().setNotificationCategories(categories)
    }

    private static func storedLabels() -> ReminderLabels {
        let saved = UserDefaults.standard.dictionary(forKey: keyLabels) as? [String: String]
        guard let done = saved?["done"], !done.isEmpty else { return ReminderLabels.fallback }
        return ReminderLabels(done: done, send: saved?["send"] ?? "")
    }

    static func apply(payload json: String?) {
        guard let order = ReminderPlan.order(fromPayload: json) else { return }
        queue.async {
            if order.labels != storedLabels() {
                UserDefaults.standard.set(["done": order.labels.done, "send": order.labels.send], forKey: keyLabels)
            }
            registerCategories(order.labels)

            let center = UNUserNotificationCenter.current()
            let done = DispatchSemaphore(value: 0)
            center.getNotificationSettings { settings in
                // Without permission a request is refused; asking is the web
                // side's to do (RemindersPlugin), and it applies again after.
                guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else {
                    done.signal()
                    return
                }
                center.getPendingNotificationRequests { requests in
                    var held: [String: String] = [:]
                    for request in requests { held[request.identifier] = (request.content.userInfo["sig"] as? String) ?? "" }
                    let canSend = order.canSend && !order.labels.send.isEmpty
                    let diff = ReminderPlan.diff(wanted: order.reminders, held: held, canSend: canSend, now: Int64(Date().timeIntervalSince1970 * 1000))
                    if !diff.cancel.isEmpty { center.removePendingNotificationRequests(withIdentifiers: diff.cancel) }
                    for reminder in diff.schedule { center.add(request(for: reminder, canSend: canSend)) }
                    done.signal()
                }
            }
            done.wait()
        }
    }

    private static func request(for r: PlannedReminder, canSend: Bool) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = r.title
        content.body = r.body
        content.sound = .default
        content.categoryIdentifier = canSend ? categoryDoneSend : categoryDone
        // Notifications about one date stack together.
        content.threadIdentifier = r.eventKey
        var info = r.json
        info["sig"] = r.signature(canSend: canSend)
        content.userInfo = info
        // By the wall clock: "at nine" stays at nine if the phone changes zone
        // before the app next runs.
        let when = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: Date(timeIntervalSince1970: TimeInterval(r.at) / 1000))
        return UNNotificationRequest(identifier: r.id, content: content, trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: false))
    }

    // A date was settled from a notification: its other reminder, pending or
    // already shown, has nothing left to say.
    static func cancel(eventKey: String) {
        if eventKey.isEmpty { return }
        let center = UNUserNotificationCenter.current()
        center.getPendingNotificationRequests { requests in
            let ids = requests.filter { $0.content.userInfo["eventKey"] as? String == eventKey }.map(\.identifier)
            if !ids.isEmpty { center.removePendingNotificationRequests(withIdentifiers: ids) }
        }
        center.getDeliveredNotifications { shown in
            let ids = shown.filter { $0.request.content.userInfo["eventKey"] as? String == eventKey }.map(\.request.identifier)
            if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
        }
    }

    static func pending(_ completion: @escaping ([PlannedReminder]) -> Void) {
        UNUserNotificationCenter.current().getPendingNotificationRequests { requests in
            completion(ReminderPlan.parse(requests.map { $0.content.userInfo }).sorted { $0.at < $1.at })
        }
    }
}
