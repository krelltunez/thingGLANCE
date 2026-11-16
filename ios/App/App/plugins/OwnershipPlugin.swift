import Foundation
import Capacitor
import StoreKit

// "Owned since": the record that this copy of the app was bought, as the App
// Store knows it (docs/release.md, src/native/ownership.ts). The Android twin
// is ownership/OwnershipPlugin.kt.
//
// It is a record and never a check: nothing reads it to allow or refuse
// anything. Only a copy the App Store installed answers. A build from Xcode, a
// simulator and a TestFlight build have nothing to report, and are not asked:
// asking the store there can put up a sign-in sheet.
@objc(OwnershipPlugin)
public class OwnershipPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "OwnershipPlugin"
    public let jsName = "Ownership"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
    ]

    // { since, store, version } when the App Store installed the app, or {}.
    @objc func get(_ call: CAPPluginCall) {
        guard OwnershipPlugin.isAppStoreInstall, #available(iOS 16.0, *) else {
            call.resolve([:])
            return
        }
        Task {
            guard case .verified(let app)? = try? await AppTransaction.shared, app.environment == .production else {
                call.resolve([:])
                return
            }
            call.resolve([
                // When the user first got the app, on any of their devices.
                "since": Int64(app.originalPurchaseDate.timeIntervalSince1970 * 1000),
                "store": "appstore",
                "version": (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "",
            ])
        }
    }

    // The App Store's copy carries a receipt named "receipt" and no
    // provisioning profile. TestFlight's is "sandboxReceipt"; a development or
    // ad hoc build carries its profile.
    private static var isAppStoreInstall: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        if Bundle.main.path(forResource: "embedded", ofType: "mobileprovision") != nil { return false }
        return Bundle.main.appStoreReceiptURL?.lastPathComponent == "receipt"
        #endif
    }
}
