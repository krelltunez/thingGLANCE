// The live side of the outside-write handler: handleIntent() with every
// collaborator wired to the real thing. A shell's bridge (a widget action, a
// notification button, the launcher's queue, the tray, an MCP tool) calls
// dispatchExternalWrite() and nothing else.
//
// It needs no screen: a headless run with no window open can call it.
//
// Two rules it keeps for every caller:
//   - Writes go through src/db/queries.ts, the same functions the forms use,
//     so they are stamped, marked for sync and promote sample rows.
//   - Reads go through visibleTo() first. An outside caller acts as this
//     device's member and can no more see or clear another member's private
//     item than the screen can.

import type { DataSet } from '@/core/types'
import { buildHorizon } from '@/core/horizon'
import { memberOfDevice, userIds, visibleTo } from '@/core/household'
import { formatLink } from '@/core/links'
import { buildSnapshot, type GlanceSnapshot } from '@/core/snapshot'
import { db } from '@/db/client'
import { createThing, decide, saveCoverage, saveSubscription, undecide } from '@/db/queries'
import { openLink } from '@/native/links'
import { getSettings } from '@/state/settings'
import { getDeviceId } from '@/sync/deviceId'
import { sendEventToDayglance } from './emit'
import { INTENT_ACTIONS, handleIntent, type ExternalWrite, type IntentContext, type IntentResult } from './handleIntent'

// Fired after an outside write changed something, so a shell can push a fresh
// snapshot to whatever is showing the old one.
export const EXTERNAL_WRITE_EVENT = 'tg:external-write'

// Everything as this device may see it, read fresh for each request.
async function view() {
  const [things, coverages, subscriptions, decisions, members, devices] = await Promise.all([
    db.things.toArray(), db.coverages.toArray(), db.subscriptions.toArray(), db.decisions.toArray(), db.members.toArray(), db.devices.toArray(),
  ])
  const all: DataSet = { things, coverages, subscriptions, decisions }
  const meId = memberOfDevice(devices, getDeviceId(), members)
  return { all, data: visibleTo(all, meId), members, devices, meId }
}

// The snapshot as this device may see it, right now. What `query` answers,
// and what a shell hands to widgets and notifications.
export async function currentSnapshot(opts: { limit?: number } = {}): Promise<GlanceSnapshot> {
  const v = await view()
  const settings = getSettings()
  return buildSnapshot(v.all, { viewerId: v.meId, userIds: userIds(v.devices, v.members), currency: settings.currency, reminderPrefs: settings.reminders, ...opts })
}

export function liveContext(): IntentContext {
  return {
    getThing: async (id) => (await view()).data.things.find((t) => t.id === id) ?? null,
    entityExists: async (id, kind) => !!(await (kind === 'thing' ? db.things : kind === 'coverage' ? db.coverages : db.subscriptions).get(id)),
    members: () => db.members.toArray(),
    createThing: (input, id) => createThing(input, id),
    saveCoverage: (input, id) => saveCoverage(input, id),
    savePlan: (input, id) => saveSubscription(input, id),
    findEvent: async (key) => { const v = await view(); return buildHorizon(v.data, { allThings: v.all.things }).find((e) => e.key === key) ?? null },
    decide: async (key, state) => { await decide(key, state) },
    undecide: (key) => undecide(key),
    send: async (event) => {
      const { data } = await view()
      await sendEventToDayglance(event, event.thingId ? data.things.find((t) => t.id === event.thingId) : null)
    },
    navigate: (target) => openLink(formatLink(target)),
    snapshot: () => currentSnapshot(),
  }
}

export async function dispatchExternalWrite(write: ExternalWrite): Promise<IntentResult> {
  const result = await handleIntent(write, liveContext())
  const changed = result.success && !result.deduped && write.action !== INTENT_ACTIONS.OPEN && write.action !== INTENT_ACTIONS.QUERY
  if (changed && typeof window !== 'undefined') window.dispatchEvent(new Event(EXTERNAL_WRITE_EVENT))
  return result
}
