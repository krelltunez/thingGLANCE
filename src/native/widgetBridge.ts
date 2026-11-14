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

import { registerPlugin } from '@capacitor/core'
import { liveQuery } from 'dexie'
import { tr } from '@/core/text'
import type { GlanceSnapshot } from '@/core/snapshot'
import { db } from '@/db/client'
import i18n from '@/i18n'
import { currentSnapshot } from '@/intents/inbound'
import { subscribeHousehold } from '@/multiuser/settings'
import { subscribeSettings } from '@/state/settings'

export interface WidgetLabels {
  decideTitle: string
  decideEmpty: string
  nextTitle: string
  nextEmpty: string
  today: string
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
}

export const WidgetBridge = registerPlugin<WidgetBridgePlugin>('WidgetBridge')

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
    days: template('time.days'),
    months: template('time.months'),
    years: template('time.years'),
  }
}

export async function widgetPayload(): Promise<WidgetPayload> {
  return { snapshot: await currentSnapshot({ limit: WIDGET_EVENTS }), labels: widgetLabels() }
}

// Everything in the payload except the moment it was made, so an unchanged
// one is not written (and every widget redrawn) again.
const fingerprint = (p: WidgetPayload): string => JSON.stringify({ ...p, snapshot: { ...p.snapshot, generatedAt: '', reminders: [] } })

export function startWidgetBridge(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let last = ''
  const push = async () => {
    timer = null
    try {
      const payload = await widgetPayload()
      const print = fingerprint(payload)
      if (print === last) return
      await WidgetBridge.updateSnapshot({ json: JSON.stringify(payload) })
      last = print
    } catch {
      // Not written this time; the next change tries again.
    }
  }
  const soon = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => void push(), SETTLE_MS) }

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
  // Coming back after midnight, the same data makes a different snapshot.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') soon()
    // On the way to the background there may be no "later": write now.
    else { if (timer) clearTimeout(timer); void push() }
  })
}
