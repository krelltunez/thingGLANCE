import { describe, expect, it } from 'vitest'
import type { Coverage, DataSet, Decision, Subscription, Thing } from './types'
import { forecast, monthlyCost, nextRenewal, renewalsBetween } from './money'
import { lifecycle, replacementFund } from './health'
import { attentionQueue, buildHorizon, eventKey, nextEventFor } from './horizon'
import { buildSnapshot } from './snapshot'
import { tMinus } from './dates'

const REF = '2026-11-12'
const stamp = '2026-01-01T00:00:00.000Z'

const thing = (p: Partial<Thing>): Thing => ({ id: 't1', kind: 'thing', name: 'Phone', category: 'phone', status: 'active', ownerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p })
const sub = (p: Partial<Subscription>): Subscription => ({ id: 's1', kind: 'subscription', name: 'Plan', amount: 10, cycle: 'monthly', anchorDate: '2026-01-15', autoRenew: true, status: 'active', review: false, coversThingIds: [], coversMemberIds: [], payerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p })
const cov = (p: Partial<Coverage>): Coverage => ({ id: 'c1', kind: 'coverage', thingId: 't1', type: 'warranty', name: 'Warranty', endDate: '2026-11-24', createdAt: stamp, updatedAt: stamp, ...p })
const data = (p: Partial<DataSet>): DataSet => ({ things: [], coverages: [], subscriptions: [], decisions: [], ...p })

describe('renewals', () => {
  it('rolls a monthly plan forward from its anchor', () => {
    expect(nextRenewal(sub({}), REF)).toBe('2026-11-15')
    expect(renewalsBetween(sub({}), '2026-11-01', '2027-01-31')).toEqual(['2026-11-15', '2026-12-15', '2027-01-15'])
  })
  it('does not drift when anchored on the 31st', () => {
    expect(renewalsBetween(sub({ anchorDate: '2026-01-31' }), '2026-02-01', '2026-04-30')).toEqual(['2026-02-28', '2026-03-31', '2026-04-30'])
  })
  it('works from an anchor in the future', () => {
    expect(nextRenewal(sub({ cycle: 'yearly', anchorDate: '2027-03-01' }), REF)).toBe('2027-03-01')
    expect(nextRenewal(sub({ cycle: 'yearly', anchorDate: '2030-03-01' }), REF)).toBe('2027-03-01')
  })
  it('normalises cost and ignores plans that no longer bill', () => {
    expect(monthlyCost(sub({ cycle: 'yearly', amount: 120 }))).toBe(10)
    expect(monthlyCost(sub({ status: 'cancelled' }))).toBe(0)
    expect(monthlyCost(sub({ autoRenew: false }))).toBe(0)
  })
  it('forecasts charges by calendar month, skipping a trial until it converts', () => {
    const f = forecast([sub({}), sub({ id: 's2', status: 'trial', trialEnd: '2026-12-20', anchorDate: '2026-12-20', amount: 5 })], 3, REF)
    expect(f.map((m) => m.total)).toEqual([10, 15, 15])
  })
})

describe('lifecycle', () => {
  it('ends the window at whichever comes first, support or plan', () => {
    const a = lifecycle(thing({ purchaseDate: '2024-11-12', lifespanMonths: 48, supportEnd: '2030-01-01' }), [], REF)
    expect(a.lifeEnd).toBe('2028-11-12')
    expect(a.lifeEndReason).toBe('plan')
    expect(a.remaining).toBeCloseTo(0.5, 2)
    const b = lifecycle(thing({ purchaseDate: '2024-11-12', lifespanMonths: 48, supportEnd: '2027-01-01' }), [], REF)
    expect(b.lifeEndReason).toBe('support')
    expect(b.verdict).toBe('replace')
  })
  it('grades the verdict', () => {
    expect(lifecycle(thing({}), [], REF).verdict).toBe('unknown')
    expect(lifecycle(thing({ purchaseDate: '2020-01-01', lifespanMonths: 48 }), [], REF).verdict).toBe('overdue')
    expect(lifecycle(thing({ purchaseDate: '2026-06-01', lifespanMonths: 48 }), [cov({ endDate: '2027-06-01' })], REF).verdict).toBe('prime')
    expect(lifecycle(thing({ purchaseDate: '2026-06-01', lifespanMonths: 48 }), [], REF).verdict).toBe('solid')
    expect(lifecycle(thing({ status: 'retired', purchaseDate: '2020-01-01' }), [], REF).verdict).toBe('retired')
  })
  it('spreads a replacement over the months left', () => {
    const f = replacementFund([thing({ purchaseDate: '2024-11-12', lifespanMonths: 48, price: 1200 })], [], REF)
    expect(f.monthly).toBeCloseTo(50, 0)
  })
})

describe('horizon', () => {
  const base = data({
    things: [thing({ purchaseDate: '2025-11-24', lifespanMonths: 48 })],
    coverages: [cov({})],
    subscriptions: [sub({ id: 'monthly' }), sub({ id: 'yearly', cycle: 'yearly', anchorDate: '2026-12-01', amount: 99 }), sub({ id: 'watched', review: true, anchorDate: '2026-11-16' })],
  })

  it('queues what is inside its lead window and nothing else', () => {
    const q = attentionQueue(buildHorizon(base, { ref: REF }))
    expect(q.map((e) => e.key)).toEqual([
      eventKey('renewal', 'watched', '2026-11-16'),
      eventKey('coverage-end', 'c1', '2026-11-24'),
      eventKey('renewal', 'yearly', '2026-12-01'),
    ])
  })
  it('marks routine monthly renewals quiet and later occurrences as repeats', () => {
    const events = buildHorizon(base, { ref: REF })
    const monthly = events.filter((e) => e.subscriptionId === 'monthly' && e.days >= 0)
    expect(monthly.every((e) => e.quiet)).toBe(true)
    const watched = events.filter((e) => e.subscriptionId === 'watched' && e.days >= 0)
    expect(watched[0].repeat).toBe(false)
    expect(watched[1].repeat).toBe(true)
    expect(nextEventFor(events, { subscriptionId: 'monthly' })).toBeNull()
  })
  it('a decision clears the item, and only that occurrence', () => {
    const key = eventKey('coverage-end', 'c1', '2026-11-24')
    const decision: Decision = { id: 'd1', kind: 'decision', eventKey: key, state: 'dismissed', createdAt: stamp, updatedAt: stamp }
    const q = attentionQueue(buildHorizon({ ...base, decisions: [decision] }, { ref: REF }))
    expect(q.some((e) => e.key === key)).toBe(false)
    expect(q).toHaveLength(2)
  })
  it('keeps an out-of-support device in the queue until it is dealt with', () => {
    const d = data({ things: [thing({ purchaseDate: '2021-01-01', lifespanMonths: 96, supportEnd: '2025-10-01', supportBasis: 'official' })] })
    const q = attentionQueue(buildHorizon(d, { ref: REF }))
    expect(q[0].type).toBe('support-end')
    expect(q[0].severity).toBe('past')
  })
  it('filters by household member', () => {
    const d = data({ things: [thing({ id: 'a', ownerMemberId: 'u1', purchaseDate: '2023-01-01', lifespanMonths: 48 }), thing({ id: 'b', ownerMemberId: 'u2', purchaseDate: '2023-01-01', lifespanMonths: 48 })] })
    expect(new Set(buildHorizon(d, { ref: REF, memberId: 'u1' }).map((e) => e.thingId))).toEqual(new Set(['a']))
  })
  it('ignores retired things and their plans', () => {
    const d = data({ things: [thing({ status: 'retired', purchaseDate: '2023-01-01' })], subscriptions: [sub({ coversThingIds: ['t1'], cycle: 'yearly' })] })
    expect(buildHorizon(d, { ref: REF })).toEqual([])
  })
})

describe('snapshot', () => {
  it('is plain JSON a widget can render without the app', () => {
    const snap = buildSnapshot(data({ things: [thing({ purchaseDate: '2025-11-24', lifespanMonths: 48, price: 800 })], coverages: [cov({})], subscriptions: [sub({})] }), { ref: REF, viewerId: null })
    expect(snap.counts).toEqual({ things: 1, subscriptions: 1, attention: 1, urgent: 1 })
    expect(snap.burn.monthly).toBe(10)
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
})

describe('countdown', () => {
  it('counts down before and up after', () => {
    expect(tMinus(12)).toBe('T-12d')
    expect(tMinus(-19)).toBe('T+19d')
    expect(tMinus(0)).toBe('T-0')
    expect(tMinus(365)).toBe('T-12mo')
    expect(tMinus(1096)).toBe('T-3y')
  })
})
