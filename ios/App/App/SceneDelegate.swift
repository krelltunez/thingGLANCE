import UIKit
import Capacitor
import GlanceKit

// The window lives on the scene: the current SDK refuses to launch an app that
// keeps it on the app delegate. Links and activities arrive here too, and go
// on to Capacitor, whose App plugin hands them to the web side as `appUrlOpen`
// (src/native/capacitor.ts passes each one to openLink()).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // What shows around the keyboard's rounded corners while the WebView
        // is shortened to make room for it.
        window?.backgroundColor = .systemBackground
        // Not CAPBridgeViewController: the subclass registers the app's plugins.
        window?.rootViewController = BridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        // A quick action that started the app.
        if let item = connectionOptions.shortcutItem { _ = open(item) }
    }

    // A quick action on the app's icon, with the app already running.
    func windowScene(_ windowScene: UIWindowScene,
                     performActionFor shortcutItem: UIApplicationShortcutItem,
                     completionHandler: @escaping (Bool) -> Void) {
        completionHandler(open(shortcutItem))
    }

    // An item's type is the link it opens (Info.plist). It is written down for
    // the web side to take, like every other link made outside the app.
    private func open(_ item: UIApplicationShortcutItem) -> Bool {
        guard OutsideLinks.isOurs(item.type) else { return false }
        SharedStore().setPendingLink(item.type)
        WidgetBridgePlugin.announcePendingLink()
        return true
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
