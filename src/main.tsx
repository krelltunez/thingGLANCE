import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './index.css'
import { i18nReady } from './i18n'
import App from './App'
import { applyTheme, watchSystemTheme } from './state/settings'
import { headlessBridge, headlessShell } from './headless/headlessMode'
import { startCapacitorShell } from './native/capacitor'
import { lockViewportScaleOnIPhone } from './native/viewportZoom'
import { startDesktopShell } from './native/desktopShell'
import { registerShell } from './native/shell'
import { desktopBridge, settleServiceWorker, shell, watchInstallPrompt } from './native/platform'
import { settleKeyStorage } from './sync/keyHooks'
import { hydrateSecrets } from './sync/secrets'

// crypto.randomUUID() only exists in secure contexts (HTTPS / localhost). This
// covers plain-HTTP access over a LAN IP, e.g. a self-hosted Docker install.
if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40
    b[8] = (b[8] & 0x3f) | 0x80
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`
  }
}

// A background refresh: this same bundle, loaded by the Android shell with no
// screen (src/headless/). It is a shell like any other, with its own transport
// and keystore, and it runs its own short list instead of the app.
const headless = headlessBridge()
if (headless) registerShell(headlessShell(headless))

// A native shell hands over its keystore and its network stack before
// anything else looks for them. Does nothing in a browser.
startCapacitorShell()
// An iPhone zooms in on a focused field and, inside the app, cannot zoom back.
lockViewportScaleOnIPhone()
// The desktop app's tray popup is this same bundle in a window of its own
// (?tray=1), showing what the main process holds. It is a widget: no
// database, no sync, no credentials, so none of the shell is started for it.
const desktop = desktopBridge()
const trayMode = desktop !== null && new URLSearchParams(window.location.search).get('tray') === '1'

// The desktop app's main process carries every request, holds the keystore and
// reads the live stream. Does nothing anywhere else.
if (!trayMode) startDesktopShell()

// Shell markers for platform-only styling (same class contract as lastGLANCE).
const where = shell()
if (where === 'native') document.documentElement.classList.add('native')
if (desktop) document.documentElement.classList.add('desktop', `desktop-${desktop.info.platform}`)
if (trayMode) document.documentElement.classList.add('tray')

// Theme before the first paint, so there is no flash.
applyTheme()
watchSystemTheme()
watchInstallPrompt()
settleServiceWorker()

// Two things have to be in memory before the first render. Credentials a shell
// keeps in its keystore: the sync engines read the connection as they mount.
// And the starting language, so nothing paints in English first. On the web,
// in English, both resolve at once.
if (trayMode && desktop) {
  // The app's theme is set in the main window; this window hears of a change
  // through the storage they share.
  window.addEventListener('storage', applyTheme)
  void Promise.all([import('./tray/TrayPopup'), i18nReady]).then(([{ TrayPopup }]) => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <TrayPopup tray={desktop.tray} />
      </StrictMode>,
    )
  })
} else if (headless) {
  void import('./headless/headlessRefresh').then(({ runHeadlessRefresh }) => runHeadlessRefresh({ bridge: headless }))
} else void Promise.allSettled([hydrateSecrets().then(settleKeyStorage), i18nReady]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
