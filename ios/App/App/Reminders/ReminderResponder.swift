import Capacitor
import Foundation
import GlanceKit
import UIKit
import UserNotifications

// What happens when a reminder is shown or answered.
//
// A button never changes data here. "Done with this" and "Send to dayGLANCE"
// queue a write, with an id made from the reminder's own so a second press is
// the same write, and the app applies it the next time it runs (through the
// one door every write from outside uses). A tap on the notification itself is
// a link, handed to Capacitor like one the system opened.
final class ReminderResponder: NSObject, UNUserNotificationCenterDelegate {
    static let shared = ReminderResponder()

    // With the app in front, a reminder is still worth showing.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let id = (info["id"] as? String) ?? response.notification.request.identifier
        let eventKey = (info["eventKey"] as? String) ?? ""

        switch response.actionIdentifier {
        case ReminderScheduler.actionDone:
            settle(eventKey) { SharedStore().queueDecide(eventKey: eventKey, clientId: "notification:\(id):done") }
        case ReminderScheduler.actionSend:
            settle(eventKey) { SharedStore().queueSend(eventKey: eventKey, clientId: "notification:\(id):send") }
        case UNNotificationDefaultActionIdentifier:
            let link = (info["link"] as? String) ?? ""
            if let url = URL(string: link.isEmpty ? "thingglance://queue" : link) {
                DispatchQueue.main.async {
                    // Kept as the launch URL when the app was not running, and
                    // sent as `appUrlOpen` when it was.
                    _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
                }
            }
        default:
            break
        }
        completionHandler()
    }

    private func settle(_ eventKey: String, _ queue: () -> Void) {
        if eventKey.isEmpty { return }
        queue()
        ReminderScheduler.cancel(eventKey: eventKey)
        WidgetBridgePlugin.announcePendingWrites()
    }
}
