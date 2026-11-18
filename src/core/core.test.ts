import { describe, expect, it } from 'vitest'
import type { Coverage, DataSet, Decision, Subscription, Thing } from './types'
import { chargesWithin, countedFrom, forecast, isBilling, isOver, leftOnTerm, monthlyCost, nextRenewal, paidToDate, planStart, renewalsBetween, startStatus, termEnd } from './money'
import { lifecycle, replacementFund } from './health'
import { TERM_END_LEAD, attentionQueue, buildHorizon, eventKey, nextEventFor } from './horizon'
import { buildSnapshot } from './snapshot'
import { dayOf, packRows, tMinus } from './dates'
import { CATEGORIES, category, guessCategory } from './categories'

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

// A desktop leased on 2026-09-22 for three years, paid monthly on the 19th,
// with a protection plan billed monthly on the 22nd.
describe('a plan with a beginning and an end', () => {
  const entered = '2026-11-13T18:00:00.000Z'
  const lease = sub({ id: 'lease', name: 'Apple Lease', amount: 75.17, anchorDate: '2026-11-19', startDate: '2026-09-22', endDate: '2029-09-22', createdAt: entered })
  const care = sub({ id: 'care', name: 'AppleCare+', amount: 6.49, anchorDate: '2026-11-22', startDate: '2026-09-22', createdAt: entered })
  const TODAY = '2026-11-16'

  it('renews from the day it began and stops before the day it ends', () => {
    const all = renewalsBetween(lease, '2020-01-01', '2035-01-01')
    expect(all[0]).toBe('2026-10-19')
    expect(all[all.length - 1]).toBe('2029-09-19')
    expect(all).toHaveLength(36)
    // The last day of a term is the day it ends, not one more payment.
    expect(renewalsBetween({ ...lease, anchorDate: '2026-11-22' }, '2029-08-01', '2030-01-01')).toEqual(['2029-08-22'])
    expect(nextRenewal(lease, '2029-09-20')).toBeNull()
    // Nothing renewed before there was a plan.
    expect(renewalsBetween(care, '2025-10-01', TODAY)).toEqual(['2026-09-22', '2026-10-22'])
  })
  it('counts a plan whose start is unknown from the last payment before it was entered', () => {
    // Billed on the 22nd and entered on the 13th, already running: October's
    // payment was made, or there would have been no plan to enter. Nothing
    // before it is known.
    const { startDate: _none, ...unanswered } = care
    const running: Subscription = { ...unanswered, startUnknown: true }
    expect(countedFrom(running)).toEqual({ day: '2026-10-22', basis: 'anchor' })
    expect(planStart(running)).toBe('2026-10-22')
    expect(renewalsBetween(running, '2025-10-01', TODAY)).toEqual(['2026-10-22'])
    expect(paidToDate(running, TODAY)).toEqual({ basis: 'anchor', since: '2026-10-22', payments: 1, total: 6.49, last: '2026-10-22' })
    // Whatever the cycle, it is the one payment before entry and no more.
    expect(countedFrom({ ...running, cycle: 'weekly', anchorDate: '2026-11-19' })).toEqual({ day: '2026-11-12', basis: 'anchor' })
    expect(countedFrom({ ...running, cycle: 'quarterly', anchorDate: '2026-12-01' })).toEqual({ day: '2026-09-01', basis: 'anchor' })
    expect(countedFrom({ ...running, anchorDate: '2026-01-31' })).toEqual({ day: '2026-10-31', basis: 'anchor' })
    // A start on record is where it counts from, as before.
    expect(countedFrom(care)).toEqual({ day: '2026-09-22', basis: 'start_date' })
    expect(paidToDate({ ...care, startDate: '2026-11-10' }, TODAY)).toMatchObject({ basis: 'start_date', since: '2026-11-10', payments: 0 })
    // With nothing to bound it, the cycle alone answers, as it always did.
    expect(renewalsBetween({ anchorDate: '2026-11-22', cycle: 'monthly' }, '2026-09-01', '2026-10-31')).toEqual(['2026-09-22', '2026-10-22'])
  })
  it('does not guess a payment for a plan nobody has given a start', () => {
    const { startDate: _none, ...unanswered } = care
    const day = dayOf(entered)
    expect(['2026-11-13', '2026-11-14']).toContain(day)
    // Its renewal date is still ahead of the day it was entered: it may be
    // new, and nothing before that day is counted.
    expect(countedFrom(unanswered)).toEqual({ day, basis: 'entry_date' })
    expect(renewalsBetween(unanswered, '2025-10-01', TODAY)).toEqual([])
    expect(paidToDate(unanswered, TODAY)).toEqual({ basis: 'entry_date', since: day, payments: 0, total: 0, last: null })
    expect(paidToDate(unanswered, '2027-01-10')).toEqual({ basis: 'entry_date', since: day, payments: 2, total: 12.98, last: '2026-12-22' })
    // Its renewal date is on or before that day: someone entered a payment
    // that had been made, and it counts. So does the latest one on the cycle
    // when the date entered is an older one.
    expect(countedFrom({ ...unanswered, anchorDate: '2026-11-03' })).toEqual({ day: '2026-11-03', basis: 'anchor' })
    expect(paidToDate({ ...unanswered, anchorDate: '2026-11-03' }, TODAY)).toEqual({ basis: 'anchor', since: '2026-11-03', payments: 1, total: 6.49, last: '2026-11-03' })
    expect(countedFrom({ ...unanswered, anchorDate: '2026-01-03' })).toEqual({ day: '2026-11-03', basis: 'anchor' })
    // A renewal on the very day it was entered: that day is where it begins.
    const sameDay = { ...unanswered, anchorDate: day }
    expect(countedFrom(sameDay)).toEqual({ day, basis: 'entry_date' })
    expect(paidToDate(sameDay, TODAY)).toEqual({ basis: 'entry_date', since: day, payments: 1, total: 6.49, last: day })
  })
  it('counts the payment a prepaid year began with, entered ten days later', () => {
    // Paid for the year on the 3rd, entered on the 13th, start unknown.
    const audible = sub({ id: 'audible', name: 'Audible Premium Plus', amount: 149.5, cycle: 'yearly', anchorDate: '2026-11-03', endDate: '2027-11-03', autoRenew: false, startUnknown: true, createdAt: entered })
    const paid = { basis: 'anchor', since: '2026-11-03', payments: 1, total: 149.5, last: '2026-11-03' }
    expect(paidToDate(audible, TODAY)).toEqual(paid)
    // The same with the question never answered.
    const { startUnknown: _unanswered, ...notSet } = audible
    expect(paidToDate(notSet, TODAY)).toEqual(paid)
    // And only that one: the year before is not known to have been paid.
    expect(renewalsBetween(audible, '2020-01-01', TODAY)).toEqual(['2026-11-03'])
  })
  it('tells a start that is unknown from one nobody has given', () => {
    const { startDate: _none, ...notSet } = care
    const unknown: Subscription = { ...notSet, startUnknown: true }
    expect([startStatus(care), startStatus(unknown), startStatus(notSet)]).toEqual(['recorded', 'unknown', 'not_set'])
    // A date settles it, whatever else a row says.
    expect(startStatus({ startDate: '2026-09-22', startUnknown: true })).toBe('recorded')
    // Entered mid-cycle. Unknown: October's payment, then November's and
    // December's. Unanswered: only the two since it was entered.
    const later = '2027-01-10'
    expect(paidToDate(unknown, later)).toEqual({ basis: 'anchor', since: '2026-10-22', payments: 3, total: 19.47, last: '2026-12-22' })
    expect(paidToDate(notSet, later)).toMatchObject({ basis: 'entry_date', payments: 2, total: 12.98, last: '2026-12-22' })
    expect(paidToDate(care, later)).toMatchObject({ basis: 'start_date', since: '2026-09-22', payments: 4 })
  })
  it('adds up what has been paid, and what is left on a term', () => {
    expect(paidToDate(care, TODAY)).toEqual({ basis: 'start_date', since: '2026-09-22', payments: 2, total: 12.98, last: '2026-10-22' })
    expect(paidToDate(lease, TODAY)).toEqual({ basis: 'start_date', since: '2026-09-22', payments: 1, total: 75.17, last: '2026-10-19' })
    expect(leftOnTerm(lease, TODAY)).toEqual({ ends: '2029-09-22', payments: 35, total: 2630.95 })
    expect(leftOnTerm(care, TODAY)).toBeNull()
    // A trial has taken nothing until it converts.
    expect(paidToDate(sub({ status: 'trial', trialEnd: '2026-12-01', anchorDate: '2026-12-01', startDate: '2026-09-01' }), TODAY).payments).toBe(0)
  })
  it('costs what it costs until the term is over, and nothing after', () => {
    expect(termEnd(lease)).toBe('2029-09-22')
    expect(isBilling(lease, TODAY)).toBe(true)
    expect(monthlyCost(lease, TODAY)).toBeCloseTo(75.17, 2)
    expect(monthlyCost(lease, '2029-09-22')).toBe(0)
    expect(isOver(lease, '2029-09-22')).toBe(false)
    expect(isOver(lease, '2029-09-23')).toBe(true)
    // Paid up front and not renewing is a different thing: no term, no cost.
    const prepaid = sub({ autoRenew: false, endDate: '2027-06-01' })
    expect(termEnd(prepaid)).toBeNull()
    expect(monthlyCost(prepaid, TODAY)).toBe(0)
    expect(isOver(prepaid, '2028-01-01')).toBe(false)
    expect(isOver(sub({ status: 'cancelled' }), TODAY)).toBe(true)
  })
  it('stops charging and forecasting at the end of the term', () => {
    expect(chargesWithin([lease], '2029-09-01', 60).map((c) => c.date)).toEqual(['2029-09-19'])
    const months = forecast([lease], 3, '2029-08-20')
    expect(months.map((m) => m.total)).toEqual([0, 75.17, 0])
  })
  it('puts the end of the term on the horizon, and no renewal past it', () => {
    const events = buildHorizon(data({ subscriptions: [lease] }), { ref: TODAY, from: '2026-01-01', to: '2031-01-01' }).filter((e) => e.subscriptionId === 'lease')
    const end = events.find((e) => e.type === 'sub-end')!
    expect(end).toMatchObject({ date: '2029-09-22', title: 'Apple Lease term ends', lead: TERM_END_LEAD })
    const renewals = events.filter((e) => e.type === 'renewal').map((e) => e.date)
    expect(renewals[0]).toBe('2026-10-19')
    expect(renewals[renewals.length - 1]).toBe('2029-09-19')
    // It asks for a decision once it is close, like any other date.
    const near = buildHorizon(data({ subscriptions: [lease] }), { ref: '2029-08-01' }).find((e) => e.type === 'sub-end')!
    expect(near.attention).toBe(true)
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
    expect(snap.counts).toEqual({ things: 1, subscriptions: 1, attention: 1, urgent: 1, covered: 1 })
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

describe('kinds', () => {
  it('files doorbells and security cameras apart from cameras and smart home', () => {
    expect(guessCategory('Ring Video Doorbell Pro 2')).toBe('security')
    expect(guessCategory('Arlo Pro 5 security camera')).toBe('security')
    expect(guessCategory('Sony a7 IV mirrorless camera')).toBe('camera')
    expect(guessCategory('Nest Learning Thermostat')).toBe('smarthome')
  })
  it('reads a kind it does not know as Other, so a newer build cannot break an older one', () => {
    expect(category('hovercraft' as never).id).toBe('other')
  })
  it('fills the kind picker with no gap at either width (6 or 9 across)', () => {
    expect(CATEGORIES.length % 6).toBe(0)
    expect(CATEGORIES.length % 9).toBe(0)
  })
})

describe('packing spans into rows', () => {
  const span = (x: { from: string; to: string }): [string, string] => [x.from, x.to]
  it('gives overlapping spans a row each, longest first', () => {
    const warranty = { id: 'w', from: '2026-01-01', to: '2027-01-01' }
    const care = { id: 'c', from: '2026-01-01', to: '2029-01-01' }
    expect(packRows([warranty, care], span).map((r) => r.map((x) => x.id))).toEqual([['c'], ['w']])
  })
  it('reuses a row once the span in it has ended', () => {
    const first = { id: 'a', from: '2026-01-01', to: '2026-12-31' }
    const next = { id: 'b', from: '2027-01-01', to: '2027-12-31' }
    const across = { id: 'x', from: '2026-06-01', to: '2027-06-01' }
    expect(packRows([next, across, first], span).map((r) => r.map((x) => x.id))).toEqual([['a', 'b'], ['x']])
  })
  it('answers no rows for nothing', () => {
    expect(packRows([], span)).toEqual([])
  })
})
