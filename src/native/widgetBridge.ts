// Hands the home screen what it shows.
//
// Widgets cannot run the app, so the app writes down what they need each time
// it changes: the snapshot (docs/snapshot.md, the same object every other
// surface reads) and the few words a widget adds of its own, already in the
// app's language. The native side stores it and redraws.
//
// Countdowns are not baked in. A widget is drawn hours after the app last
// ran, so it works out "T-12d" itself from each date; the unit templates it
// needs for that travel with the labels.

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import { liveQuery } from 'dexie'
import { tr } from '@/core/text'
import type { GlanceSnapshot } from '@/core/snapshot'
import { db } from '@/db/client'
import i18n from '@/i18n'
import type { ExternalWrite } from '@/intents/handleIntent'
import { currentSnapshot, dispatchExternalWrite } from '@/intents/inbound'
import { subscribeHousehold } from '@/multiuser/settings'
import { subscribeSettings } from '@/state/settings'
import { syncNow } from '@/sync/manager'

export interface WidgetLabels {
  decideTitle: string
  decideEmpty: string
  nextTitle: string
  nextEmpty: string
  today: string
  // What the tick on a row is called, for screen readers, and the button on
  // a reminder.
  done: string
  // The name Android shows for the reminders' notification channel.
  channel: string
  channelDescription: string
  // "{{n}}d", "{{n}}mo", "{{n}}y": the units of the T-minus countdown.
  days: string
  months: string
  years: string
}

export interface WidgetPayload {
  snapshot: GlanceSnapshot
  labels: WidgetLabels
}

interface WidgetBridgePlugin {
  updateSnapshot(options: { json: string }): Promise<void>
  // Asks the launcher to offer one of the widgets for the home screen.
  pinWidget(options: { kind: 'decide' | 'next' }): Promise<{ supported: boolean }>
  // Writes made on the home screen and not yet applied: a JSON array of
  // { action, payload, clientId }. They stay queued until acknowledged.
  pendingWrites(): Promise<{ writes: string }>
  acknowledgeWrites(options: { clientIds: string[] }): Promise<void>
  addListener(eventName: 'pendingWrites' | 'refreshRequested', listener: () => void): Promise<PluginListenerHandle>
  // The last few background refreshes, newest last: a JSON array.
  refreshLog(): Promise<{ log: string }>
}

export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

// The native side as this module needs it. The app reaches it through the
// plugin above; a background refresh, which has no Capacitor, reaches the
// same native code through its own bridge (headless/headlessRefresh.ts).
export interface NativeSurface {
  updateSnapshot(json: string): Promise<void>
  pendingWrites(): Promise<string>
  acknowledgeWrites(clientIds: string[]): Promise<void>
}

const pluginSurface: NativeSurface = {
  updateSnapshot: (json) => WidgetBridge.updateSnapshot({ json }),
  pendingWrites: async () => (await WidgetBridge.pendingWrites()).writes,
  acknowledgeWrites: (clientIds) => WidgetBridge.acknowledgeWrites({ clientIds }),
}

// Builds the payload and hands it over, once, now.
export async function pushPayloadNow(surface: NativeSurface = pluginSurface): Promise<void> {
  await surface.updateSnapshot(JSON.stringify(await widgetPayload()))
}

// More dates than the app's own lists show: a tall widget scrolls.
const WIDGET_EVENTS = 12
const SETTLE_MS = 600

// The catalog's templates as they are, slots and all: the native side fills
// in the number.
const template = (key: 'time.days' | 'time.months' | 'time.years'): string => tr(key, { n: '{{n}}' })

export function widgetLabels(): WidgetLabels {
  return {
    decideTitle: tr('widget.decide.title'),
    decideEmpty: tr('widget.decide.empty'),
    nextTitle: tr('widget.next.title'),
    nextEmpty: tr('widget.next.empty'),
    today: tr('widget.today'),
    done: tr('notify.done'),
    channel: tr('notify.channel'),
    channelDescription: tr('notify.channelDescription'),
    days: template('time.days'),
    months: template('time.months'),
    years: template('time.years'),
  }
}

export async function widgetPayload(): Promise<WidgetPayload> {
  return { snapshot: await currentSnapshot({ limit: WIDGET_EVENTS }), labels: widgetLabels() }
}

// Everything in the payload except the moment it was made, so an unchanged
// one is not written again. The reminder plan counts: the native side
// schedules from it, and it moves when the reminder time or a date does.
const fingerprint = (p: WidgetPayload): string => JSON.stringify({ ...p, snapshot: { ...p.snapshot, generatedAt: '' } })

// ── Writes made on the home screen ───────────────────────────────────────────

// A tick on a widget row cannot run the app, so the native side queues the
// write and this applies it: through the one door every write from outside
// uses, with the id the widget minted, so applying it twice changes nothing.
//
// The order matters. A write is acknowledged (and so removed from the queue)
// only after the widgets have been handed a snapshot that already reflects it.
// Acknowledge first, and the row would flash back until the next snapshot.
let collecting: Promise<number> = Promise.resolve(0)

// Resolves with how many of the writes changed something.
export function collectWidgetWrites(afterApplying: () => Promise<void>, surface: NativeSurface = pluginSurface): Promise<number> {
  collecting = collecting.then(async () => {
    let writes: ExternalWrite[] = []
    try {
      const parsed: unknown = JSON.parse(await surface.pendingWrites())
      if (Array.isArray(parsed)) writes = parsed.filter((w): w is ExternalWrite => !!w && typeof w === 'object' && typeof (w as ExternalWrite).clientId === 'string')
    } catch {
      return 0
    }
    if (!writes.length) return 0
    const settled: string[] = []
    let changed = 0
    for (const write of writes) {
      try {
        // Applied, already applied, or refused for good (the date is gone):
        // all three are finished with. Only an exception is worth another try.
        const result = await dispatchExternalWrite(write)
        if (result.success && !result.deduped) changed += 1
        settled.push(write.clientId!)
      } catch { /* left queued for the next collection */ }
    }
    if (!settled.length) return 0
    await afterApplying().catch(() => {})
    await surface.acknowledgeWrites(settled).catch(() => {})
    return changed
  }).catch(() => 0)
  return collecting
}

// `onSnapshot` is handed every snapshot as it is made, changed or not.
export function startWidgetBridge(onSnapshot?: (snapshot: GlanceSnapshot) => void): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = ''
  const push = async () => {
    timer = null
    try {
      const payload = await widgetPayload()
      try { onSnapshot?.(payload.snapshot) } catch { /* a listener must not stop the widgets */ }
      const print = fingerprint(payload)
      if (print === last) return
      await pluginSurface.updateSnapshot(JSON.stringify(payload))
      last = print
    } catch {
      // Not written this time; the next change tries again.
    }
  }
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void push(), SETTLE_MS) }
  const now = async () => { if (timer) clearTimeout(timer); await push() }
  const collect = () => void collectWidgetWrites(now)

  // Any write to the data, made here or pulled from the vault.
  liveQuery(async () => {
    await Promise.all([db.things.toArray(), db.coverages.toArray(), db.subscriptions.toArray(), db.decisions.toArray(), db.members.toArray(), db.devices.toArray()])
    return Date.now()
  }).subscribe({ next: soon, error: () => { /* the next trigger tries again */ } })
  // What the snapshot is built with: who this device is, the currency, the
  // reminder hour, the language.
  subscribeHousehold(soon)
  subscribeSettings(soon)
  i18n.on('languageChanged', soon)
  // Ticks made on the home screen: collected at start, whenever the native
  // side says there is one (the app is running), and on coming to the front.
  collect()
  void WidgetBridge.addListener('pendingWrites', collect)
  // The routine background refresh came due while the app is alive but not
  // on screen. A second page must never work on the same storage, so the
  // native side asks this one to do the same work: sync, collect, hand over.
  void WidgetBridge.addListener('refreshRequested', () => { void syncNow().finally(() => { collect(); soon() }) })
  // Coming back after midnight, the same data makes a different snapshot.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { collect(); soon() }
    // On the way to the background there may be no "later": write now.
    else { if (timer) clearTimeout(timer); void push() }
  })
}
