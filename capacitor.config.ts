import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'

// One id on every store (docs/ROADMAP.md: "Decide these before anything
// ships"). lastGLANCE's Android and iOS ids never matched, and it cost them.
const config: CapacitorConfig = {
  appId: 'com.thingglance.app',
  appName: 'thingGLANCE',
  // Vite emits the production build here; `cap sync` copies it into the native
  // project's web assets.
  webDir: 'dist',
  android: {
    // WebView remote debugging (chrome://inspect). Off unless asked for: an
    // inspectable WebView lets anyone with a cable read the app's storage. Set
    // CAP_WEBVIEW_DEBUG=1 at `cap sync` for a throwaway test build; never ship
    // one. (scripts/android-check.mjs needs it to drive the app.)
    webContentsDebuggingEnabled: process.env.CAP_WEBVIEW_DEBUG === '1',
    // Named, so that a plugin added for iOS (the keyboard's) is not built
    // into the Android app as well, where it has nothing to do and would put
    // its own listener on the window's insets.
    includePlugins: ['@capacitor/app', '@capacitor/status-bar'],
  },
  ios: {
    // Reminders are the app's own (ios: Reminders/ReminderResponder.swift,
    // set as the notification delegate in AppDelegate). Left on, Capacitor
    // makes itself the delegate when its bridge starts, and with no plugin
    // behind it every reminder is hidden while the app is open and every
    // button and tap is dropped.
    handleApplicationNotifications: false,
  },
  plugins: {
    // Requests go out on the native HTTP stack, so the vault needs no CORS
    // entry for the app's origin (https://localhost). src/native/capacitor.ts
    // hands this fetch to the app as the shell's transport.
    CapacitorHttp: { enabled: true },
    // The app's own background paints behind a transparent bar; the layout
    // keeps clear of it with env(safe-area-inset-top). The style is set to
    // match the theme at runtime (src/native/capacitor.ts).
    StatusBar: { style: 'DARK', overlaysWebView: true },
    // iOS only. The WebView itself shrinks when the keyboard comes up, which
    // is what `interactive-widget=resizes-content` in index.html does on
    // Android and iOS has no word for: a bottom sheet stays above the keys
    // instead of behind them.
    Keyboard: { resize: KeyboardResize.Native },
  },
}

export default config
