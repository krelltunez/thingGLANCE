import UIKit
import Capacitor

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
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
