import Foundation
import Capacitor
import GlanceKit
import WidgetKit

// Hands the rest of the phone what it shows, and hands the app back what was
// done there. The web side is src/native/widgetBridge.ts, and the plugin's
// surface is the Android one's (WidgetBridgePlugin.kt), so that file needs no
// branch for the platform.
//
//   updateSnapshot     the payload is stored in the App Group, the widgets are
//                      redrawn, and the pending notifications are made to match
//                      the reminder plan inside it
//   pendingWrites      what was ticked outside the app and is not applied yet
//   acknowledgeWrites  applied: taken off the queue
//
// What only Android has (pinning a widget from Settings, Quick Settings tiles,
// GLANCElauncher's refresh, the background refresh's log) answers "not here".
@objc(WidgetBridgePlugin)
public class WidgetBridgePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "WidgetBridgePlugin"
    public let jsName = "WidgetBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "updateSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingWrites", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "acknowledgeWrites", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "heartbeat", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pinWidget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addTile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordLauncherRefresh", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "refreshLog", returnType: CAPPluginReturnPromise),
    ]

    private static weak var live: WidgetBridgePlugin?

    override public func load() {
        WidgetBridgePlugin.live = self
    }

    // A write was queued while the app is running (a notification's button):
    // the web side collects it now instead of on the next visit.
    static func announcePendingWrites() {
        live?.notifyListeners("pendingWrites", data: [:])
    }

    @objc func updateSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json") else {
            call.reject("missing json")
            return
        }
        // The one failure worth saying out loud: without the group everything
        // else here reads as "no data yet", which is what a new install looks
        // like. The web side ignores the rejection; it is for the native log.
        guard SharedStore.isAvailable else {
            call.reject("app group \(SharedStore.suiteName) unavailable")
            return
        }
        SharedStore().writePayload(json)
        WidgetCenter.shared.reloadAllTimelines()
        ReminderScheduler.apply(payload: json)
        call.resolve()
    }

    @objc func pendingWrites(_ call: CAPPluginCall) {
        call.resolve(["writes": SharedStore().pendingWrites()])
    }

    @objc func acknowledgeWrites(_ call: CAPPluginCall) {
        let ids = Set((call.getArray("clientIds") ?? []).compactMap { $0 as? String })
        SharedStore().acknowledge(clientIds: ids)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func heartbeat(_ call: CAPPluginCall) {
        SharedStore().touchHeartbeat(syncedAt: call.getString("syncedAt"))
        call.resolve()
    }

    // iOS has no way for an app to offer its widget: the user adds one from
    // the home screen. Settings does not show the buttons here.
    @objc func pinWidget(_ call: CAPPluginCall) {
        call.resolve(["supported": false])
    }

    @objc func addTile(_ call: CAPPluginCall) {
        call.resolve(["supported": false])
    }

    @objc func recordLauncherRefresh(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func refreshLog(_ call: CAPPluginCall) {
        call.resolve(["log": "[]"])
    }
}
