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
import { verdictLabel, type Verdict } from '@/core/health'
import { tr } from '@/core/text'
import type { GlanceSnapshot } from '@/core/snapshot'
import { db } from '@/db/client'
import i18n from '@/i18n'
import { isIntentsEnabled } from '@/intents/config'
import type { ExternalWrite, IntentResult } from '@/intents/handleIntent'
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
  // "Send to dayGLANCE" on a row or a reminder, and the mark of a date
  // already handed over.
  send: string
  sent: string
  // The name Android shows for the reminders' notification channel.
  channel: string
  channelDescription: string
  // The newer widgets: the add tile, plan charges, and a single thing (its
  // picker included, which is drawn natively and so needs its words too).
  addThing: string
  chargesTitle: string
  chargesEmpty: string
  thingTitle: string
  thingPick: string
  thingAuto: string
  thingNone: string
  thingGone: string
  // A verdict's name by its code (`things[].verdict` in the snapshot).
  verdicts: Record<string, string>
  // The Quick Settings tile's second line, for each number of dates that can
  // be waiting: [0] is "Nothing waiting", [2] is "2 waiting". Written out
  // here because a count picks a plural form, which is the catalog's to know;
  // the native side only picks the entry (a tick on a widget lowers the
  // number before the app next runs).
  waiting: string[]
  // "{{n}}d", "{{n}}mo", "{{n}}y": the units of the T-minus countdown.
  days: string
  months: string
  years: string
}

export type WidgetKind = 'decide' | 'next' | 'charges' | 'thing' | 'add'
export type TileKind = 'decide' | 'add'
// What became of asking Android to add a tile: the user said yes, it was
// there already, or the user said no.
export type TileResult = 'added' | 'already' | 'dismissed'

const VERDICT_CODES: Verdict[] = ['prime', 'solid', 'watch', 'replace', 'overdue', 'retired', 'unknown']

export interface WidgetPayload {
  snapshot: GlanceSnapshot
  labels: WidgetLabels
  // True when this device is connected to dayGLANCE. Only then do widgets and
  // reminders offer "Send to dayGLANCE": a button that can only fail is worse
  // than no button.
  canSend: boolean
}

interface WidgetBridgePlugin {
  updateSnapshot(options: { json: string }): Promise<void>
  // Asks the launcher to offer one of the widgets for the home screen.
  pinWidget(options: { kind: WidgetKind }): Promise<{ supported: boolean }>
  // Asks Android to offer one of the Quick Settings tiles (Android 13+).
  addTile(options: { kind: TileKind }): Promise<{ supported: boolean; result?: TileResult }>
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

// No tile needs a phrase for more than this; a longer queue reads as the last.
const MAX_WAITING_PHRASES = 60

export function widgetLabels(waiting = 0): WidgetLabels {
  const phrases = Math.min(Math.max(0, Math.floor(waiting)), MAX_WAITING_PHRASES)
  return {
    decideTitle: tr('widget.decide.title'),
    decideEmpty: tr('widget.decide.empty'),
    nextTitle: tr('widget.next.title'),
    nextEmpty: tr('widget.next.empty'),
    today: tr('widget.today'),
    done: tr('notify.done'),
    send: tr('notify.send'),
    sent: tr('parts.inDayglance'),
    channel: tr('notify.channel'),
    channelDescription: tr('notify.channelDescription'),
    addThing: tr('widget.add'),
    chargesTitle: tr('widget.charges.title'),
    chargesEmpty: tr('widget.charges.empty'),
    thingTitle: tr('widget.thing.title'),
    thingPick: tr('widget.thing.pick'),
    thingAuto: tr('widget.thing.auto'),
    thingNone: tr('widget.thing.none'),
    thingGone: tr('widget.thing.gone'),
    verdicts: Object.fromEntries(VERDICT_CODES.map((v) => [v, verdictLabel(v)])),
    waiting: Array.from({ length: phrases + 1 }, (_, count) => (count === 0 ? tr('widget.tile.none') : tr('widget.tile.waiting', { count }))),
    days: template('time.days'),
    months: template('time.months'),
    years: template('time.years'),
  }
}

export async function widgetPayload(): Promise<WidgetPayload> {
  const snapshot = await currentSnapshot({ limit: WIDGET_EVENTS })
  return { snapshot, labels: widgetLabels(snapshot.counts.attention), canSend: isIntentsEnabled() }
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
// A "send" the vault could not be reached for. Every other refusal is final.
export const isUnsentSend = (write: ExternalWrite, result: IntentResult): boolean =>
  write.action === 'send' && !result.success && result.code === 'failed'

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
        // all three are finished with. Two things are worth another try: an
        // exception, and a send that could not reach the vault, which stays
        // queued so the task is not silently lost.
        const result = await dispatchExternalWrite(write)
        if (result.success && !result.deduped) changed += 1
        if (isUnsentSend(write, result)) continue
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
