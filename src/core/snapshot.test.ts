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
    expect(keys(snap())).toEqual(['attention', 'burn', 'counts', 'currency', 'day', 'generatedAt', 'reminders', 'scope', 'things', 'upcoming', 'version'])
  })
  it('has exactly these fields inside', () => {
    const s = snap()
    expect(keys(s.scope)).toEqual(['memberId', 'viewerId'])
    expect(keys(s.counts)).toEqual(['attention', 'subscriptions', 'things', 'urgent'])
    expect(keys(s.burn)).toEqual(['monthly', 'replacementMonthly', 'yearly'])
    expect(keys(s.things[0])).toEqual(['category', 'daysLeft', 'id', 'lifeEnd', 'name', 'ownerMemberId', 'remaining', 'verdict'])
    expect(keys(s.attention[0])).toEqual(['amount', 'date', 'days', 'detail', 'handlerId', 'key', 'link', 'severity', 'subscriptionId', 'thingId', 'title', 'type'])
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
