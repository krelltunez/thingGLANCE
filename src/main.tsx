import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import '@fontsource-variable/inter/wght-italic.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import './index.css'
import { i18nReady } from './i18n'
import App from './App'
import { applyTheme, watchSystemTheme } from './state/settings'
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

// Shell markers for platform-only styling (same class contract as lastGLANCE).
const where = shell()
if (where === 'native') document.documentElement.classList.add('native')
const desktop = desktopBridge()
if (desktop) document.documentElement.classList.add('desktop', `desktop-${desktop.info.platform}`)

// Theme before the first paint, so there is no flash.
applyTheme()
watchSystemTheme()
watchInstallPrompt()
settleServiceWorker()

// Two things have to be in memory before the first render. Credentials a shell
// keeps in its keystore: the sync engines read the connection as they mount.
// And the starting language, so nothing paints in English first. On the web,
// in English, both resolve at once.
void Promise.allSettled([hydrateSecrets().then(settleKeyStorage), i18nReady]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
