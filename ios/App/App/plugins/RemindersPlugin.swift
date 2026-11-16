import Foundation
import Capacitor
import GlanceKit
import UserNotifications

// The part of reminders that needs the app on screen: the system's permission
// prompt, and a look at what is pending (src/native/notifications.ts). The
// scheduling is ReminderScheduler's, fed by the snapshot.
@objc(RemindersPlugin)
public class RemindersPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "RemindersPlugin"
    public let jsName = "Reminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "permission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pending", returnType: CAPPluginReturnPromise),
    ]

    @objc func permission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            call.resolve(["state": RemindersPlugin.state(settings.authorizationStatus)])
        }
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            // Nothing could be scheduled until now: do it from what the app
            // last handed over, without waiting for the next change.
            if granted { ReminderScheduler.apply(payload: SharedStore().readPayload()) }
            center.getNotificationSettings { settings in
                call.resolve(["state": RemindersPlugin.state(settings.authorizationStatus)])
            }
        }
    }

    // What the system has been asked to deliver: a JSON array of reminders.
    @objc func pending(_ call: CAPPluginCall) {
        ReminderScheduler.pending { reminders in
            let data = try? JSONSerialization.data(withJSONObject: reminders.map(\.json), options: [.sortedKeys])
            call.resolve(["reminders": data.flatMap { String(data: $0, encoding: .utf8) } ?? "[]"])
        }
    }

    private static func state(_ status: UNAuthorizationStatus) -> String {
        switch status {
        case .authorized, .provisional, .ephemeral: return "granted"
        case .denied: return "denied"
        default: return "prompt"
        }
    }
}
