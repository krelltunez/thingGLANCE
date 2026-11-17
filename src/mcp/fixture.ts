// A small household in memory, for the MCP tests (the models here, and the
// transport suite in electron/): the read model's input, and write
// collaborators that keep the rules of src/db/queries.ts without a database.
// Outside writes go through the real handleIntent(), with a ledger of its own.

import { handDown, visibleTo } from '@/core/household'
import { buildHorizon } from '@/core/horizon'
import { buildSnapshot } from '@/core/snapshot'
import type { Coverage, DataSet, Decision, Member, Subscription, Thing } from '@/core/types'
import { handleIntent } from '@/intents/handleIntent'
import type { OwnerChangeOptions } from '@/db/queries'
import type { HandledWrite } from '@/intents/ledger'
import type { ReadData } from './readModel'
import type { WriteDeps } from './writeModel'

export const TODAY = '2026-11-16'
export const NOW = Date.parse('2026-11-16T15:00:00Z')
// Midday, so the day it falls on is the same wherever the tests run.
const stamp = '2026-01-01T12:00:00.000Z'

export const thingRow = (p: Partial<Thing> & { id: string; name: string }): Thing => ({
  kind: 'thing', category: 'laptop', status: 'active', ownerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p,
})
const coverage = (p: Partial<Coverage> & { id: string; thingId: string }): Coverage => ({ kind: 'coverage', type: 'warranty', name: 'Manufacturer warranty', endDate: '2026-11-25', createdAt: stamp, updatedAt: stamp, ...p })
export const planRow = (p: Partial<Subscription> & { id: string; name: string }): Subscription => ({
  kind: 'subscription', amount: 10, cycle: 'monthly', anchorDate: '2026-11-01', autoRenew: true, status: 'active', review: false,
  coversThingIds: [], coversMemberIds: [], payerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p,
})

export const MEMBERS: Member[] = [
  { id: 'ann', name: 'Ann', updatedAt: stamp },
  { id: 'ben', name: 'Ben', updatedAt: stamp },
  { id: 'kid', name: 'Kit', updatedAt: stamp },
]

export interface Household { things: Thing[]; coverages: Coverage[]; subscriptions: Subscription[]; decisions: Decision[]; members: Member[] }

// Ann's computer. Ben's diary is private to Ben, so it is not Ann's to see.
export function household(): Household {
  return {
    members: MEMBERS.map((m) => ({ ...m })),
    things: [
      thingRow({ id: 't-laptop', name: 'MacBook Pro', brand: 'Apple', category: 'laptop', purchaseDate: '2024-11-20', price: 2400, lifespanMonths: 60, ownerMemberId: 'ann' }),
      thingRow({ id: 't-phone', name: 'Pixel 9', brand: 'Google', category: 'phone', purchaseDate: '2025-11-25', price: 800, supportEnd: '2031-08-01', supportBasis: 'official', ownerMemberId: 'kid' }),
      thingRow({ id: 't-tv', name: 'Living room TV', category: 'tv', purchaseDate: '2020-01-10', lifespanMonths: 84 }),
      thingRow({ id: 't-old', name: 'Old tablet', category: 'tablet', status: 'retired', retiredAt: '2026-03-01', ownerMemberId: 'ann' }),
      thingRow({ id: 't-diary', name: 'E-reader', category: 'other', ownerMemberId: 'ben', visibility: 'private' }),
    ],
    coverages: [
      coverage({ id: 'c-phone', thingId: 't-phone', endDate: '2026-11-25' }),
      coverage({ id: 'c-laptop', thingId: 't-laptop', name: 'AppleCare+', type: 'extended', endDate: '2027-11-20' }),
    ],
    subscriptions: [
      planRow({ id: 'p-stream', name: 'Streamflix', amount: 15.99, cycle: 'monthly', anchorDate: '2026-11-03' }),
      planRow({ id: 'p-cloud', name: 'Cloud 2 TB', provider: 'Apple', amount: 119, cycle: 'yearly', anchorDate: '2026-12-01', payerMemberId: 'ann' }),
      planRow({ id: 'p-trial', name: 'Photo editor', amount: 11.99, status: 'trial', trialEnd: '2026-11-20', anchorDate: '2026-11-20' }),
      planRow({ id: 'p-gone', name: 'Old gym', amount: 40, status: 'cancelled', endDate: '2026-06-30' }),
    ],
    decisions: [],
  }
}

const ME = 'ann'
const USERS = new Set(['ann', 'ben'])

export function readOf(h: Household): ReadData {
  const all: DataSet = { things: h.things, coverages: h.coverages, subscriptions: h.subscriptions, decisions: h.decisions }
  return {
    all,
    data: visibleTo(all, ME),
    members: h.members,
    meId: ME,
    users: USERS,
    snapshot: buildSnapshot(all, { viewerId: ME, userIds: USERS, currency: 'USD', ref: TODAY, now: NOW }),
    today: TODAY,
  }
}

const clean = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T

// The write collaborators over the same household. `calls` records what the
// model asked for, in order.
export function writeDepsOf(h: Household): { deps: WriteDeps; calls: string[] } {
  const calls: string[] = []
  let ledger: HandledWrite[] = []
  const visible = () => readOf(h).data
  const setThing = (id: string, patch: Partial<Thing>, owner: OwnerChangeOptions = {}) => {
    const owned = (t: Thing) => (owner.history !== undefined
      ? { ownershipHistory: owner.history?.length ? owner.history : undefined }
      : patch.ownerMemberId !== undefined ? handDown(t, patch.ownerMemberId, TODAY, owner.as) : {})
    h.things = h.things.map((t) => (t.id === id ? clean({ ...t, ...patch, ...owned(t), updatedAt: new Date(NOW).toISOString() }) : t))
  }
  const setDecision = (key: string, state: Decision['state'], taskId?: string) => {
    const cur = h.decisions.find((d) => d.eventKey === key)
    const row: Decision = { id: cur?.id ?? `d-${key}`, kind: 'decision', eventKey: key, state, ...(taskId ?? cur?.taskId ? { taskId: taskId ?? cur?.taskId } : {}), createdAt: cur?.createdAt ?? stamp, updatedAt: new Date(NOW).toISOString() }
    h.decisions = [...h.decisions.filter((d) => d.eventKey !== key), row]
    return row
  }
  const deps: WriteDeps = {
    read: async () => readOf(h),
    dispatch: (write) => handleIntent(write, {
      getThing: async (id) => visible().things.find((t) => t.id === id) ?? null,
      entityExists: async (id, kind) => (kind === 'thing' ? h.things : kind === 'coverage' ? h.coverages : h.subscriptions).some((r) => r.id === id),
      members: async () => h.members,
      createThing: async (input, id) => { const row = clean({ ...input, id: id!, kind: 'thing', createdAt: stamp, updatedAt: stamp }) as Thing; h.things = [...h.things, row]; calls.push('createThing'); return row },
      saveCoverage: async (input, id) => { const row = clean({ ...input, id: id!, kind: 'coverage', createdAt: stamp, updatedAt: stamp }) as Coverage; h.coverages = [...h.coverages, row]; calls.push('saveCoverage'); return row },
      savePlan: async (input, id) => { const row = clean({ ...input, id: id!, kind: 'subscription', createdAt: stamp, updatedAt: stamp }) as Subscription; h.subscriptions = [...h.subscriptions, row]; calls.push('savePlan'); return row },
      findEvent: async (key) => buildHorizon(visible(), { ref: TODAY, allThings: h.things }).find((e) => e.key === key) ?? null,
      decide: async (key, state) => { setDecision(key, state); calls.push(`decide:${state}`) },
      undecide: async (key) => { h.decisions = h.decisions.filter((d) => d.eventKey !== key); calls.push('undecide') },
    }, { ledger, persist: (next) => { ledger = next } }),
    updateThing: async (id, patch, owner) => { setThing(id, patch as Partial<Thing>, owner); calls.push('updateThing') },
    retireThing: async (id, resaleValue) => { setThing(id, { status: 'retired', retiredAt: TODAY, resaleValue }); calls.push('retireThing') },
    reviveThing: async (id) => { setThing(id, { status: 'active', retiredAt: undefined, resaleValue: undefined }); calls.push('reviveThing') },
    patchPlan: async (id, patch) => { h.subscriptions = h.subscriptions.map((s) => (s.id === id ? clean({ ...s, ...patch }) as Subscription : s)); calls.push('patchPlan') },
    deleteThing: async (id) => { h.things = h.things.filter((t) => t.id !== id); h.coverages = h.coverages.filter((c) => c.thingId !== id); calls.push('deleteThing') },
    deleteCoverage: async (id) => { h.coverages = h.coverages.filter((c) => c.id !== id); calls.push('deleteCoverage') },
    deletePlan: async (id) => { h.subscriptions = h.subscriptions.filter((s) => s.id !== id); calls.push('deletePlan') },
    decide: async (key, state, taskId) => { calls.push(`decide:${state}`); return setDecision(key, state, taskId) },
    undecide: async (key) => { h.decisions = h.decisions.filter((d) => d.eventKey !== key); calls.push('undecide') },
    decisionFor: async (key) => h.decisions.find((d) => d.eventKey === key) ?? null,
    coverageExists: async (id) => h.coverages.some((c) => c.id === id),
  }
  return { deps, calls }
}
