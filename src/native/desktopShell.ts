// The Electron shell (macOS, Windows, Linux): everything the main process
// brings, handed to the app through the seams in docs/shells.md, as
// native/capacitor.ts does for a phone. On the web and on a phone this module
// does nothing. The bridge itself is native/desktop.ts; the main process is
// electron/.
//
//   network    the renderer is allowed no request of its own (its CSP says
//              connect-src 'self'), so the main process makes every one. No
//              vault needs a CORS entry for app://thingglance.
//   keystore   Electron's safeStorage, where the OS has one. A Linux machine
//              without a keyring has none, and the app keeps its web storage.
//   live sync  the vault's event stream is read by the main process and
//              passed in, in the same message shapes the Android shell uses
//   theme      reported to main, so the next launch's window opens in the
//              right colour instead of flashing the other one
//   wake       a window that stays up across a sleep never sees
//              `visibilitychange`; main says when the machine woke
//   menu       the Windows and Linux application menu, in the app's language
//   tray       main is handed the same payload Android's widgets get, whenever
//   reminders  it changes: the tray draws it, and the reminder plan inside it
//              is what main schedules. Nothing is scheduled from here.
//   writes     a "Done" in the tray or on a reminder is queued by main and
//              applied here, through the one door every outside write uses
//   links      a thingglance:// link the app was opened with goes to openLink()

import i18n from 'i18next'
import type { GlanceSnapshot } from '@/core/snapshot'
import { tr } from '@/core/text'
import { isIntentsEnabled } from '@/intents/config'
import { currentSnapshot } from '@/intents/inbound'
import { desktopBridge, type DesktopBridge, type DesktopHttp } from './desktop'
import { openLink } from './links'
import { recordOwnershipFromShell } from './ownership'
import { registerShell, type SecureStore, type ShellEventStream } from './shell'
import { LAUNCHER_EVENTS, collectWidgetWrites, watchPayloadInputs, widgetLabels, type NativeSurface, type WidgetLabels } from './widgetBridge'

// Statuses whose Response may not carry a body.
const NULL_BODY = new Set([204, 205, 304])

// A fetch over the main process. String bodies only, as the vault speaks
// JSON; a request that got no response rejects with a TypeError, as fetch
// does. Deadlines are put on it by sync/shellFetch.ts, like any transport.
export function desktopFetch(http: Pick<DesktopHttp, 'request'>): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    const body = init?.body
    if (body != null && typeof body !== 'string') throw new TypeError('desktop fetch: only string bodies')
    const res = await http.request(method, url, headers, body ?? null)
    if ('error' in res) throw new TypeError(res.error)
    return new Response(NULL_BODY.has(res.status) ? null : res.body, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
}

function keystore(bridge: DesktopBridge): SecureStore {
  return {
    get: async (key) => (await bridge.secureStore.get(key)).value ?? null,
    set: (key, value) => bridge.secureStore.set(key, value),
    remove: (key) => bridge.secureStore.delete(key),
  }
}

function eventStream(bridge: DesktopBridge): ShellEventStream {
  return {
    start: (connection) => bridge.vaultSse.start(connection),
    stop: () => bridge.vaultSse.stop(),
    listen: (listener) => bridge.vaultSse.onMessage(listener),
  }
}

// The application menu's words. Main keeps Electron's own menu until a whole
// set arrives, and macOS ignores them: its native menu is localized by the OS.
export function menuLabels(): Record<string, string> {
  return {
    file: tr('menu.file'),
    edit: tr('menu.edit'),
    view: tr('menu.view'),
    window: tr('menu.window'),
    quit: tr('menu.quit'),
    close: tr('menu.close'),
    undo: tr('menu.undo'),
    redo: tr('menu.redo'),
    cut: tr('menu.cut'),
    copy: tr('menu.copy'),
    paste: tr('menu.paste'),
    delete: tr('menu.delete'),
    selectAll: tr('menu.selectAll'),
    reload: tr('menu.reload'),
    forceReload: tr('menu.forceReload'),
    toggleDevTools: tr('menu.toggleDevTools'),
    resetZoom: tr('menu.resetZoom'),
    zoomIn: tr('menu.zoomIn'),
    zoomOut: tr('menu.zoomOut'),
    toggleFullScreen: tr('menu.toggleFullScreen'),
    minimize: tr('menu.minimize'),
    zoom: tr('menu.zoom'),
    // The shell's own words, which ride along: the notice the first time
    // closing hides the window, and the tray and its menu.
    backgroundTitle: tr('desktop.background.title'),
    backgroundBody: tr('desktop.background.body'),
    trayOpen: tr('desktop.tray.open'),
    trayQuit: tr('desktop.tray.quit'),
    trayDone: tr('parts.doneWithThis'),
    trayNothingWaiting: tr('widget.decide.empty'),
    // The slot is filled by main, which knows the number.
    trayWaiting: tr('desktop.tray.waiting', { n: '{{n}}' }),
  }
}

function followLanguage(bridge: DesktopBridge): void {
  const push = () => bridge.shell.setMenuLabels(menuLabels())
  i18n.on('initialized', push)
  i18n.on('languageChanged', push)
  if (i18n.isInitialized) push()
}

function followTheme(bridge: DesktopBridge): void {
  let last: boolean | null = null
  const apply = () => {
    const dark = document.documentElement.classList.contains('dark')
    if (dark === last) return
    last = dark
    bridge.shell.setTheme(dark)
  }
  apply()
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
}

// Sync, the intents poll and the snapshot all kick on `visibilitychange`.
// Replaying it is enough: each still checks visibilityState itself, so a
// hidden window's visible-only work stays quiet.
export function installDesktopWake(bridge: Pick<DesktopBridge, 'shell'>, doc: Pick<Document, 'dispatchEvent'> = document): () => void {
  return bridge.shell.onWake(() => { doc.dispatchEvent(new Event('visibilitychange')) })
}

// Escape leaves fullscreen, which macOS does not do by itself. Only an Escape
// nothing else wanted: components/kit.ts closes the top layer first and marks
// the event handled, and one typed into a field is left alone.
function escapeLeavesFullscreen(bridge: DesktopBridge): void {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    const el = e.target as HTMLElement | null
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
    bridge.shell.exitFullscreen()
  })
}

// ── What the tray shows and the reminders are scheduled from ────────────────

// The payload Android's widgets are handed, less the launcher's share, and
// with the longer lists: the popup scrolls.
export interface DesktopPayload {
  snapshot: GlanceSnapshot
  labels: WidgetLabels
  canSend: boolean
}

export async function desktopPayload(): Promise<DesktopPayload> {
  const snapshot = await currentSnapshot({ limit: LAUNCHER_EVENTS })
  return { snapshot, labels: widgetLabels(snapshot.counts.attention), canSend: isIntentsEnabled() }
}

// Everything but the moment it was made, so an unchanged one is not sent again.
export const payloadPrint = (p: DesktopPayload): string => JSON.stringify({ ...p, snapshot: { ...p.snapshot, generatedAt: '' } })

const SETTLE_MS = 600
// A date comes due with no event to say so, and midnight changes every
// countdown: look again this often even when nothing was touched.
const RELOOK_MS = 15 * 60 * 1000

export function startDesktopFeed(bridge: Pick<DesktopBridge, 'widget' | 'commands'>): void {
  // The queue main keeps, as the collector reads Android's.
  const surface: NativeSurface = {
    updateSnapshot: async (json) => { bridge.widget.updateSnapshot(json) },
    pendingWrites: () => bridge.commands.take(),
    acknowledgeWrites: (clientIds) => bridge.commands.ack(clientIds),
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = ''
  const push = async () => {
    timer = null
    try {
      const payload = await desktopPayload()
      const print = payloadPrint(payload)
      if (print === last) return
      await surface.updateSnapshot(JSON.stringify(payload))
      last = print
    } catch {
      // Not sent this time; the next change tries again.
    }
  }
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void push(), SETTLE_MS) }
  const now = async () => { if (timer) clearTimeout(timer); await push() }
  // A write is acknowledged only after main has a snapshot that reflects it,
  // or the row would flash back in the tray until the next one.
  const collect = () => void collectWidgetWrites(now, surface)

  watchPayloadInputs(soon)
  collect()
  bridge.commands.onQueued(collect)
  setInterval(soon, RELOOK_MS)
  document.addEventListener('visibilitychange', () => { collect(); soon() })
}

// A link the app was started with, a reminder's click, a row in the tray:
// main keeps it until the page asks, so one that arrives before the page has
// loaded is not lost, and a reload does not open it twice.
export function followDesktopLinks(bridge: Pick<DesktopBridge, 'links'>): void {
  const take = () => void bridge.links.consume().then(({ link }) => { if (link) openLink(link) }).catch(() => {})
  bridge.links.onOpen(take)
  take()
}

// Called first thing in main.tsx: the bridge has to be registered before the
// app reads its credentials.
export function startDesktopShell(): void {
  const bridge = desktopBridge()
  if (!bridge) return
  registerShell({
    fetch: desktopFetch(bridge.http),
    secureStore: bridge.info.secureStorage ? keystore(bridge) : undefined,
    eventStream: eventStream(bridge),
  })
  followTheme(bridge)
  followLanguage(bridge)
  installDesktopWake(bridge)
  escapeLeavesFullscreen(bridge)
  followDesktopLinks(bridge)
  startDesktopFeed(bridge)
  // A copy from the Mac App Store says so, once, for the record.
  void recordOwnershipFromShell()
}
