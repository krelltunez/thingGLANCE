// Where is this bundle running? Today the answer is always "the browser", but
// every platform fork in the app goes through here so the Capacitor and
// Electron shells have one place to plug in.
//
//   web       browser tab or installed PWA
//   native    Capacitor (Android / iOS): adds html.native, no service worker
//   desktop   Electron: adds html.desktop + html.desktop-<platform>, no service
//             worker, tray popup rendered from the same bundle with ?tray=1

import { tr } from '@/core/text'

export type Shell = 'web' | 'native' | 'desktop'

interface DesktopBridge { info: { platform: string } }

export function desktopBridge(): DesktopBridge | null {
  return (window as unknown as { thingglanceDesktop?: DesktopBridge }).thingglanceDesktop ?? null
}

export function shell(): Shell {
  if (desktopBridge()) return 'desktop'
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  if (cap?.isNativePlatform?.()) return 'native'
  return 'web'
}

// "Chrome on macOS": a short name for this device in the household's device
// list. It only has to tell two of them apart.
export function describeDevice(): string {
  const ua = navigator.userAgent
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const kind = shell()
  if (kind === 'desktop') return os ? tr('device.osApp', { os }) : tr('device.desktopApp')
  if (kind === 'native') return os ? tr('device.osApp', { os }) : tr('device.phoneApp')
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : tr('device.browser')
  return os ? tr('device.browserOn', { browser, os }) : browser
}

export const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true

// The service worker is for the browser only. A native or desktop shell ships
// the bundle inside the app; a worker there would serve the previous build
// after an update (lastGLANCE learned this the hard way, see its
// src/native/serviceWorker.ts), so a shell removes any worker it finds.
export function settleServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  if (shell() === 'web') {
    if (import.meta.env.PROD) {
      window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}) })
    }
    return
  }
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {})
}

// PWA install prompt (Chromium). Captured early; Settings offers the button.
interface InstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let installEvent: InstallPromptEvent | null = null
const installListeners = new Set<() => void>()

export function watchInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    installEvent = e as InstallPromptEvent
    installListeners.forEach((fn) => fn())
  })
  window.addEventListener('appinstalled', () => { installEvent = null; installListeners.forEach((fn) => fn()) })
}
export const canInstall = (): boolean => installEvent !== null
export const subscribeInstall = (fn: () => void): (() => void) => { installListeners.add(fn); return () => installListeners.delete(fn) }
export async function promptInstall(): Promise<void> {
  if (!installEvent) return
  await installEvent.prompt()
  await installEvent.userChoice.catch(() => {})
  installEvent = null
  installListeners.forEach((fn) => fn())
}

// The icon badge: how many things are waiting on a decision.
export function setBadge(count: number): void {
  const nav = navigator as unknown as { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  if (count > 0) nav.setAppBadge?.(count).catch(() => {})
  else nav.clearAppBadge?.().catch(() => {})
}
