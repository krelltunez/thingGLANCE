import Foundation
import Capacitor
import Security

// The Keychain as the shell's keystore (docs/shells.md): where the vault's
// credentials are kept instead of the WebView's storage. The same three
// methods as Android's SecureStorePlugin, and the same contract, which
// src/sync/secrets.ts depends on:
//
//   nothing stored            resolves { value: null }
//   the Keychain cannot be    rejects. Never "nothing stored": the app would
//   used                      take that as signed out and ask to set up again.
//
// Items are kept ThisDeviceOnly, so they are in no backup that could be
// restored to another phone, and AfterFirstUnlock, so a sync that runs while
// the phone is locked can still read them. The web side leans on the first:
// it keeps the device id here, and a copy of the app's storage whose id this
// Keychain does not know came from another device (src/sync/deviceIdentity.ts).
//
// After lastGLANCE's SecureStorePlugin.swift, which answers null for every
// failure; thingGLANCE's contract tells the two apart.
@objc(SecureStorePlugin)
public class SecureStorePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "SecureStorePlugin"
    public let jsName = "SecureStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "delete", returnType: CAPPluginReturnPromise),
    ]

    private let service = "thingglance_secure_store"
    private static let keyClaimed = "tg_keychain_claimed"

    // The Keychain outlives the app: delete thingGLANCE, install it again, and
    // the old vault connection would still be there, beside an empty database.
    // Deleting the app means signing out here, as it does on Android. The
    // app's own defaults go with the app, so their absence marks a first run.
    override public func load() {
        let defaults = UserDefaults.standard
        if defaults.bool(forKey: SecureStorePlugin.keyClaimed) { return }
        let all: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        let status = SecItemDelete(all as CFDictionary)
        // Marked only once the Keychain answered: before the first unlock
        // after a restart it cannot, and the next start tries again.
        if status == errSecSuccess || status == errSecItemNotFound { defaults.set(true, forKey: SecureStorePlugin.keyClaimed) }
    }

    private func baseQuery(for key: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("missing key")
            return
        }
        var query = baseQuery(for: key)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            // An absent value travels as JSON null, not as a missing field.
            call.resolve(["value": NSNull()])
        } else if status == errSecSuccess, let data = result as? Data, let value = String(data: data, encoding: .utf8) {
            call.resolve(["value": value])
        } else {
            call.reject("the keychain is unavailable (\(status))")
        }
    }

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty, let value = call.getString("value") else {
            call.reject("missing key or value")
            return
        }
        let data = Data(value.utf8)

        // SecItemUpdate cannot create and SecItemAdd cannot replace.
        var status = SecItemUpdate(baseQuery(for: key) as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = baseQuery(for: key)
            add[kSecValueData as String] = data
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            status = SecItemAdd(add as CFDictionary, nil)
        }
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("the keychain is unavailable (\(status))")
        }
    }

    @objc func delete(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("missing key")
            return
        }
        let status = SecItemDelete(baseQuery(for: key) as CFDictionary)
        if status == errSecSuccess || status == errSecItemNotFound {
            call.resolve()
        } else {
            call.reject("the keychain is unavailable (\(status))")
        }
    }
}
