// The Capacitor shell (Android and iOS): everything the native side brings,
// handed to the app through the seams in docs/shells.md. On the web this
// module does nothing.
//
//   keystore   SecureStorePlugin (the Android Keystore, the iOS Keychain) as
//              the shell's secureStore
//   network    CapacitorHttp patches window.fetch onto the native HTTP stack,
//              so the vault needs no CORS entry for the app's origin. It is
//              registered as the shell's transport, which also puts the app's
//              deadlines on it (it ignores AbortSignal by itself).
//   live sync  the vault's event stream is read natively and passed in
//              (native/vaultSse.ts)
//   links      thingglance:// URLs the system hands the app go to openLink().
//              On iOS a link made outside the app (a quick action, a
//              shortcut, a share) is written down natively and taken here
//   back       Android's back button closes what is on top, then leaves
//   status bar follows the app's theme
//   reminders  scheduled natively from the reminder plan in the snapshot
//              (android: reminders/, ios: Reminders/); only the permission
//              prompt is here
//   widgets    the snapshot is written to the native side whenever it changes
//              (native/widgetBridge.ts)

import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { goBack } from './backStack'
import { openLink } from './links'
import { askOnceIfNeeded } from './notifications'
import { registerShell, type SecureStore } from './shell'
import { nativeEventStream } from './vaultSse'
import { recordOwnershipFromShell } from './ownership'
import { startWidgetBridge, WidgetBridge } from './widgetBridge'

interface SecureStorePlugin {
  // Resolves null when nothing is stored; rejects when the keystore could not
  // be used. The app treats those differently (src/sync/secrets.ts).
  get(options: { key: string }): Promise<{ value: string | null }>
  set(options: { key: string; value: string }): Promise<void>
  delete(options: { key: string }): Promise<void>
}

const Keystore = registerPlugin<SecureStorePlugin>('SecureStore')

const keystore: SecureStore = {
  get: async (key) => (await Keystore.get({ key })).value ?? null,
  set: (key, value) => Keystore.set({ key, value }),
  remove: (key) => Keystore.delete({ key }),
}

// The launch URL stays attached to the activity (on iOS, to the app), so a reload (every connection
// change ends in one) would open it again. Remembered for the life of the
// WebView session only.
const LAUNCH_SEEN = 'tg_launch_url_seen'

function followLinks(): void {
  void CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    if (!url) return
    // iOS keeps the newest link as the launch URL too: seen here, it is not
    // opened a second time after the next reload.
    try { sessionStorage.setItem(LAUNCH_SEEN, url) } catch { /* opened again after a reload, at worst */ }
    openLink(url)
  })
  void CapacitorApp.getLaunchUrl().then((launch) => {
    const url = launch?.url
    if (!url) return
    try {
      if (sessionStorage.getItem(LAUNCH_SEEN) === url) return
      sessionStorage.setItem(LAUNCH_SEEN, url)
    } catch { /* no session storage: open it */ }
    openLink(url)
  }).catch(() => {})
}

// iOS cannot hand a running page a link from an extension or an intent, so the
// native side writes it down (ios: GlanceKit's OutsideLinks) and this takes
// it: at the start, when told one is waiting, and each time the app comes to
// the front. One link per visit, so one form opens at a time. A link only
// navigates, like any other.
function followQueuedLinks(): void {
  if (Capacitor.getPlatform() !== 'ios') return
  const take = () => { void WidgetBridge.takeLink().then(({ link }) => { if (link) openLink(link) }).catch(() => {}) }
  take()
  void WidgetBridge.addListener('pendingLink', take)
  void CapacitorApp.addListener('appStateChange', ({ isActive }) => { if (isActive) take() })
}

// Adding @capacitor/app takes over the back button and, with no listener, does
// nothing at all with it. This puts back what the system did, after first
// giving the app the chance to close whatever is open.
function handleBackButton(): void {
  if (Capacitor.getPlatform() !== 'android') return
  void CapacitorApp.addListener('backButton', () => {
    if (goBack()) return
    CapacitorApp.minimizeApp().catch(() => {})
  })
}

// Light icons on the dark theme, dark icons on the light one. The bar itself
// is transparent (capacitor.config.ts), so the app's background shows through.
function followTheme(): void {
  const apply = () => {
    const dark = document.documentElement.classList.contains('dark')
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  }
  apply()
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}

// Called first thing in main.tsx: the bridge has to be registered before the
// app reads its credentials.
export function startCapacitorShell(): void {
  if (!Capacitor.isNativePlatform()) return
  registerShell({
    // Looked up on each call: CapacitorHttp replaces window.fetch at startup.
    fetch: (input, init) => window.fetch(input, init),
    secureStore: keystore,
    eventStream: nativeEventStream() ?? undefined,
  })
  followLinks()
  followQueuedLinks()
  handleBackButton()
  followTheme()
  // One snapshot feeds both: what the widgets show, and the reminder plan the
  // native side schedules from. All that is left to do here is ask for
  // permission the first time there is something to remind about.
  startWidgetBridge((snapshot) => void askOnceIfNeeded(snapshot.reminders))
  // A copy installed by a store (Google Play, the App Store) says so, once,
  // for the record.
  void recordOwnershipFromShell()
}
