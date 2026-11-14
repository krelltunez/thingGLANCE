import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import type { Coverage, DataSet, Subscription, Thing } from './types'
import { SNAPSHOT_VERSION, buildSnapshot } from './snapshot'

const REF = '2026-11-12'
const NOW = dayjs('2026-11-12T08:00').valueOf()
const stamp = '2026-01-01T00:00:00.000Z'
const thing = (p: Partial<Thing>): Thing => ({ id: 't1', kind: 'thing', name: 'Laptop', category: 'laptop', status: 'active', ownerMemberId: null, responsibleMemberId: null, visibility: 'shared', purchaseDate: '2025-11-24', lifespanMonths: 48, price: 800, createdAt: stamp, updatedAt: stamp, ...p })
const cov = (p: Partial<Coverage>): Coverage => ({ id: 'c1', kind: 'coverage', thingId: 't1', type: 'warranty', name: 'Warranty', endDate: '2026-11-24', createdAt: stamp, updatedAt: stamp, ...p })
const sub = (p: Partial<Subscription>): Subscription => ({ id: 's1', kind: 'subscription', name: 'Plan', amount: 120, cycle: 'yearly', anchorDate: '2026-12-01', autoRenew: true, status: 'active', review: false, coversThingIds: ['t1'], coversMemberIds: [], payerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p })
const all: DataSet = { things: [thing({ ownerMemberId: 'ann' })], coverages: [cov({})], subscriptions: [sub({})], decisions: [] }
const snap = () => buildSnapshot(all, { viewerId: 'ann', userIds: ['ann', 'ben'], currency: 'CAD', ref: REF, now: NOW })
const keys = (o: object) => Object.keys(o).sort()

// The snapshot is read by programs that are not this app (widgets, the tray,
// the launcher, MCP tools). These lists are its contract. If a test here
// fails, the shape changed: decide whether that is additive (update the list)
// or breaking (bump SNAPSHOT_VERSION too), and update docs/snapshot.md.
describe('the snapshot contract', () => {
  it('is version 1', () => {
    expect(SNAPSHOT_VERSION).toBe(1)
    expect(snap().version).toBe(1)
  })
  it('has exactly these top-level fields', () => {
    expect(keys(snap())).toEqual(['attention', 'burn', 'counts', 'currency', 'day', 'generatedAt', 'locale', 'reminders', 'scope', 'things', 'upcoming', 'version'])
  })
  it('has exactly these fields inside', () => {
    const s = snap()
    expect(keys(s.scope)).toEqual(['memberId', 'viewerId'])
    expect(keys(s.counts)).toEqual(['attention', 'subscriptions', 'things', 'urgent'])
    expect(keys(s.burn)).toEqual(['monthly', 'replacementMonthly', 'yearly'])
    expect(keys(s.things[0])).toEqual(['category', 'daysLeft', 'id', 'lifeEnd', 'name', 'ownerMemberId', 'remaining', 'verdict'])
    expect(keys(s.attention[0])).toEqual(['amount', 'date', 'days', 'detail', 'handlerId', 'key', 'link', 'severity', 'state', 'subscriptionId', 'thingId', 'title', 'type'])
    expect(keys(s.reminders[0])).toEqual(['amount', 'at', 'body', 'day', 'daysBefore', 'eventDate', 'eventKey', 'id', 'link', 'stage', 'subscriptionId', 'thingId', 'title', 'type'])
  })
  it('survives being stored and read back', () => {
    const s = snap()
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})

describe('what the snapshot says', () => {
  it('carries the currency and whose device it was built for', () => {
    const s = snap()
    expect(s.currency).toBe('CAD')
    expect(s.scope).toEqual({ viewerId: 'ann', memberId: null })
    expect(s.generatedAt).toBe(new Date(NOW).toISOString())
    expect(s.day).toBe(REF)
  })
  it('names who each date falls to', () => {
    expect(snap().attention.map((e) => e.handlerId)).toEqual(['ann', 'ann'])
    expect(buildSnapshot(all, { viewerId: null, ref: REF, now: NOW }).attention[0].handlerId).toBeNull()
  })
  it('lists the reminders this device should have pending, and no one else\'s', () => {
    // The yearly plan's renewal after next is inside the planning window too.
    expect(snap().reminders.map((r) => r.id)).toEqual([
      'coverage-end:c1:2026-11-24@last-call', 'renewal:s1:2026-12-01@last-call',
      'renewal:s1:2027-12-01@heads-up', 'renewal:s1:2027-12-01@last-call',
    ])
    expect(buildSnapshot(all, { viewerId: 'ben', userIds: ['ann', 'ben'], ref: REF, now: NOW }).reminders).toEqual([])
  })
  it('gives every date and reminder a link a tap can open', () => {
    const s = snap()
    expect(s.attention[0].link).toBe('thingglance://event/' + encodeURIComponent(s.attention[0].key))
    expect(s.reminders[0].link).toBe('thingglance://event/' + encodeURIComponent(s.reminders[0].eventKey))
  })
  it('caps the reminders when asked', () => {
    expect(buildSnapshot(all, { viewerId: 'ann', userIds: ['ann'], ref: REF, now: NOW, maxReminders: 1 }).reminders).toHaveLength(1)
  })
  it('leaves routine monthly renewals out of what is coming', () => {
    const monthly: DataSet = { ...all, subscriptions: [sub({ cycle: 'monthly', anchorDate: '2026-11-20', coversThingIds: [] })] }
    expect(buildSnapshot(monthly, { viewerId: null, ref: REF, now: NOW }).upcoming.some((e) => e.type === 'renewal')).toBe(false)
  })
})

describe('what a widget needs to tell dates apart', () => {
  const decided = (state: 'sent' | 'done' | 'dismissed', key: string) => ({ id: key, kind: 'decision' as const, eventKey: key, state, createdAt: stamp, updatedAt: stamp })

  it('says where each date\'s decision stands', () => {
    const open = snap()
    const warranty = open.attention.find((e) => e.type === 'coverage-end')!
    expect(warranty.state).toBe('open')
    const sent = buildSnapshot({ ...all, decisions: [decided('sent', warranty.key)] as DataSet['decisions'] }, { viewerId: 'ann', userIds: ['ann', 'ben'], ref: REF, now: NOW })
    // Still in view, as it is in the app, and marked.
    expect(sent.attention.find((e) => e.key === warranty.key)?.state).toBe('sent')
    const done = buildSnapshot({ ...all, decisions: [decided('done', warranty.key)] as DataSet['decisions'] }, { viewerId: 'ann', userIds: ['ann', 'ben'], ref: REF, now: NOW })
    expect(done.attention.some((e) => e.key === warranty.key)).toBe(false)
    expect(done.upcoming.find((e) => e.key === warranty.key)?.state).toBe('done')
  })
})

describe('the same answer on every device', () => {
  // A shared plan with no payer, attached to Ann's private phone.
  const phone = thing({ id: 'phone', ownerMemberId: 'ann', visibility: 'private' })
  const plan = sub({ coversThingIds: ['phone'] })
  const home: DataSet = { things: [phone], coverages: [], subscriptions: [plan], decisions: [] }
  const on = (viewerId: string | null, data: DataSet = home) => buildSnapshot(data, { viewerId, userIds: ['ann', 'ben'], ref: REF, now: NOW })

  it('names one handler for a shared plan on a private thing, and tells only them', () => {
    const [ann, ben, unclaimed] = [on('ann'), on('ben'), on(null)]
    for (const s of [ann, ben, unclaimed]) expect(s.upcoming.find((e) => e.subscriptionId === 's1')?.handlerId).toBe('ann')
    expect(ann.reminders.length).toBeGreaterThan(0)
    expect(ben.reminders).toEqual([])
    expect(unclaimed.reminders).toEqual([])
  })
  it('shows nothing of the private thing where it may not be seen', () => {
    const ben = on('ben')
    expect(ben.things).toEqual([])
    const renewal = ben.upcoming.find((e) => e.subscriptionId === 's1')!
    expect(renewal.thingId).toBeUndefined()
    expect(JSON.stringify(ben)).not.toContain('Laptop')
  })
  it('stops a plan asking everywhere once the thing it was for is retired', () => {
    const retired: DataSet = { ...home, things: [{ ...phone, status: 'retired' }] }
    for (const viewer of ['ann', 'ben', null]) {
      const s = on(viewer, retired)
      expect(s.upcoming.some((e) => e.subscriptionId === 's1'), String(viewer)).toBe(false)
      expect(s.reminders, String(viewer)).toEqual([])
    }
  })
})

describe('a row with a figure that makes no sense', () => {
  it('never puts NaN, Infinity or an invalid date into the snapshot', () => {
    const odd: DataSet = { things: [thing({ lifespanMonths: 1e9 }), thing({ id: 't2', lifespanMonths: -4 }), thing({ id: 't3', lifespanMonths: Number.NaN })], coverages: [], subscriptions: [], decisions: [] }
    const s = buildSnapshot(odd, { viewerId: null, ref: REF, now: NOW })
    for (const t of s.things) {
      expect(t.lifeEnd, t.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isFinite(t.daysLeft), t.id).toBe(true)
    }
    expect(Number.isFinite(s.burn.replacementMonthly)).toBe(true)
    expect(JSON.parse(JSON.stringify(s))).toEqual(s)
  })
})
