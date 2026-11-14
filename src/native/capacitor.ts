// The Capacitor shell (Android today, iOS later): everything the native side
// brings, handed to the app through the seams in docs/shells.md. On the web
// this module does nothing.
//
//   keystore   SecureStorePlugin (Android Keystore) as the shell's secureStore
//   network    CapacitorHttp patches window.fetch onto the native HTTP stack,
//              so the vault needs no CORS entry for https://localhost. It is
//              registered as the shell's transport, which also puts the app's
//              deadlines on it (it ignores AbortSignal by itself).
//   links      thingglance:// URLs the system hands the app go to openLink()
//   back       the hardware back button closes what is on top, then leaves
//   status bar follows the app's theme

import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { goBack } from './backStack'
import { openLink } from './links'
import { registerShell, type SecureStore } from './shell'

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

// The launch URL stays attached to the activity, so a reload (every connection
// change ends in one) would open it again. Remembered for the life of the
// WebView session only.
const LAUNCH_SEEN = 'tg_launch_url_seen'

function followLinks(): void {
  void CapacitorApp.addListener('appUrlOpen', ({ url }) => { if (url) openLink(url) })
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
  })
  followLinks()
  handleBackButton()
  followTheme()
}
