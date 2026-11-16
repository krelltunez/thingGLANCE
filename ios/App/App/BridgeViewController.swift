import Capacitor
import UIKit

// The app's own Capacitor plugins. On iOS they are not found by themselves
// (Android's are registered in MainActivity): each one is registered here,
// once the bridge exists and before the WebView loads the app. SceneDelegate
// puts this controller in the window; with a plain CAPBridgeViewController
// there, every plugin below is undefined on the web side.
class BridgeViewController: CAPBridgeViewController {

    override open func capacitorDidLoad() {
        // Capacitor lets a page raise the keyboard by focusing a field. The
        // forms focus their first field as they open, which is right on a
        // desktop and, here, throws the keyboard over a form that was only
        // opened to be read. The system's own rule (a tap raises it) is what
        // Android's WebView does too.
        webView?.capacitor.setKeyboardShouldRequireUserInteraction(nil)

        bridge?.registerPluginInstance(SecureStorePlugin())
        bridge?.registerPluginInstance(VaultSsePlugin())
        bridge?.registerPluginInstance(WidgetBridgePlugin())
        bridge?.registerPluginInstance(RemindersPlugin())
        bridge?.registerPluginInstance(OwnershipPlugin())
    }
}
