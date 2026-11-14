import { describe, expect, it } from 'vitest'
import type { DataSet, DeviceLink, Member, Subscription, Thing } from './types'
import { normalizeSubscription, normalizeThing } from './shape'
import {
  canSeePlan, canSeeThing, concernsPlan, concernsThing, describeTies, fundByOwner, handDown, handlerOfEvent, isTied, memberOfDevice, memberTies,
  handlerOfPlan, handlerOfThing, needsSomeone, planCostByPayer, privateHeld, reassignPlan, reassignThing, responsibleFor, userIds, visibleTo,
} from './household'
import { ownership } from './health'
import { buildHorizon } from './horizon'
import { buildSnapshot } from './snapshot'

const REF = '2026-11-12'
const stamp = '2026-01-01T00:00:00.000Z'

const thing = (p: Partial<Thing>): Thing => ({ id: 't1', kind: 'thing', name: 'Phone', category: 'phone', status: 'active', ownerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p })
const sub = (p: Partial<Subscription>): Subscription => ({ id: 's1', kind: 'subscription', name: 'Plan', amount: 120, cycle: 'yearly', anchorDate: '2026-12-01', autoRenew: true, status: 'active', review: false, coversThingIds: [], coversMemberIds: [], payerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p })
const data = (p: Partial<DataSet>): DataSet => ({ things: [], coverages: [], subscriptions: [], decisions: [], ...p })
const member = (id: string, name = id): Member => ({ id, name, updatedAt: stamp })
const link = (id: string, memberId: string): DeviceLink => ({ id, kind: 'device', memberId, createdAt: stamp, updatedAt: stamp })

describe('reading v0.1 rows', () => {
  it('maps one owner across and treats none or several as the household', () => {
    const base = { id: 't1', kind: 'thing', name: 'Phone', category: 'phone', status: 'active', createdAt: stamp, updatedAt: stamp }
    expect(normalizeThing({ ...base, ownerIds: ['emma'] }).ownerMemberId).toBe('emma')
    expect(normalizeThing({ ...base, ownerIds: [] }).ownerMemberId).toBeNull()
    expect(normalizeThing({ ...base, ownerIds: ['emma', 'sam'] }).ownerMemberId).toBeNull()
    const t = normalizeThing({ ...base, ownerIds: ['emma'] })
    expect(t).toMatchObject({ responsibleMemberId: null, visibility: 'shared' })
    expect('ownerIds' in t).toBe(false)
  })
  it('turns a plan with one thing and a payer into the list shape', () => {
    const s = normalizeSubscription({ id: 's1', kind: 'subscription', name: 'Plan', thingId: 't1', payerId: 'sam' })
    expect(s).toMatchObject({ coversThingIds: ['t1'], coversMemberIds: [], payerMemberId: 'sam', responsibleMemberId: null, visibility: 'shared' })
    expect('thingId' in s || 'payerId' in s).toBe(false)
    expect(normalizeSubscription({ id: 's2', kind: 'subscription', thingId: null }).coversThingIds).toEqual([])
  })
  it('leaves a current row alone, and keeps fields it does not know', () => {
    const t = thing({ ownerMemberId: 'emma', visibility: 'private', ownershipHistory: [{ memberId: null, to: '2026-01-01' }] })
    expect(normalizeThing(t)).toEqual(t)
    expect(normalizeThing({ ...t, fromTheFuture: 1 })).toMatchObject({ fromTheFuture: 1 })
    const s = sub({ coversThingIds: ['a', 'b'], coversMemberIds: ['emma'], payerMemberId: 'sam' })
    expect(normalizeSubscription(s)).toEqual(s)
  })
  it('never leaves something private to nobody', () => {
    expect(normalizeThing(thing({ ownerMemberId: null, visibility: 'private' })).visibility).toBe('shared')
    expect(normalizeSubscription(sub({ payerMemberId: null, visibility: 'private' })).visibility).toBe('shared')
  })
})

describe('members and users', () => {
  const members = [member('emma'), member('sam'), member('gran')]
  it('a member is a user once a device says so', () => {
    const links = [link('d1', 'sam'), link('d2', 'sam'), link('d3', 'gone')]
    expect(userIds(links, members)).toEqual(new Set(['sam']))
    expect(memberOfDevice(links, 'd2', members)).toBe('sam')
    expect(memberOfDevice(links, 'd9', members)).toBeNull()
    // A link to someone who has left the roster belongs to nobody.
    expect(memberOfDevice(links, 'd3', members)).toBeNull()
  })
  it('only a user can be the one who is asked', () => {
    const users = new Set(['sam'])
    expect(responsibleFor(thing({ responsibleMemberId: 'sam' }), users)).toBe('sam')
    expect(responsibleFor(thing({ responsibleMemberId: 'gran' }), users)).toBeNull()
    expect(responsibleFor(thing({}), users)).toBeNull()
  })
})

describe('private', () => {
  const secret = thing({ id: 'gift', ownerMemberId: 'sam', visibility: 'private' })
  it('shows only to the owner, or the payer for a plan', () => {
    expect(canSeeThing(secret, 'sam')).toBe(true)
    expect(canSeeThing(secret, 'emma')).toBe(false)
    expect(canSeeThing(secret, null)).toBe(false)
    expect(canSeePlan(sub({ payerMemberId: 'sam', visibility: 'private' }), 'emma')).toBe(false)
    expect(canSeePlan(sub({ payerMemberId: 'sam', visibility: 'private' }), 'sam')).toBe(true)
  })
  it('takes its coverage with it and never reaches a snapshot', () => {
    const all = data({
      things: [secret, thing({ id: 'tv', purchaseDate: '2024-01-01', lifespanMonths: 60 })],
      coverages: [{ id: 'c1', kind: 'coverage', thingId: 'gift', type: 'warranty', name: 'Warranty', endDate: '2026-11-24', createdAt: stamp, updatedAt: stamp }],
      subscriptions: [sub({ id: 'care', coversThingIds: ['gift'] })],
    })
    const seen = visibleTo(all, 'emma')
    expect(seen.things.map((t) => t.id)).toEqual(['tv'])
    expect(seen.coverages).toEqual([])
    // The shared plan stays, but can no longer name the hidden thing.
    expect(buildHorizon(seen, { ref: REF }).filter((e) => e.subscriptionId === 'care').every((e) => e.thingId === undefined && e.detail === 'Subscription')).toBe(true)
    expect(JSON.stringify(buildSnapshot(all, { ref: REF, viewerId: 'emma' }))).not.toContain('gift')
    expect(buildSnapshot(all, { ref: REF, viewerId: 'sam' }).things.map((t) => t.id)).toContain('gift')
    expect(visibleTo(all, 'sam')).toBe(all)
  })
})

describe('the member filter', () => {
  it('covers what they own, what they handle and what is the household\'s', () => {
    expect(concernsThing(thing({ ownerMemberId: 'emma' }), 'emma')).toBe(true)
    expect(concernsThing(thing({ ownerMemberId: 'emma', responsibleMemberId: 'sam' }), 'sam')).toBe(true)
    expect(concernsThing(thing({ ownerMemberId: null }), 'sam')).toBe(true)
    expect(concernsThing(thing({ ownerMemberId: 'emma' }), 'sam')).toBe(false)
  })
  it('follows a plan to its payer, the people it covers and the things it is attached to', () => {
    const things = new Map([['ipad', thing({ id: 'ipad', ownerMemberId: 'emma' })]])
    expect(concernsPlan(sub({ payerMemberId: 'sam' }), 'sam', things)).toBe(true)
    expect(concernsPlan(sub({ payerMemberId: 'sam' }), 'emma', things)).toBe(false)
    expect(concernsPlan(sub({ payerMemberId: 'sam', coversMemberIds: ['emma'] }), 'emma', things)).toBe(true)
    expect(concernsPlan(sub({ coversThingIds: ['ipad'] }), 'emma', things)).toBe(true)
    expect(concernsPlan(sub({ coversThingIds: ['ipad'] }), 'sam', things)).toBe(false)
    expect(concernsPlan(sub({}), 'gran', things)).toBe(true)
  })
})

describe('plans across several things', () => {
  const phones = [thing({ id: 'a', name: 'Pixel' }), thing({ id: 'b', name: 'iPhone' }), thing({ id: 'c', name: 'Old phone', status: 'retired' })]
  const plan = sub({ coversThingIds: ['a', 'b', 'c'] })
  it('names the first active one and counts the rest', () => {
    const e = buildHorizon(data({ things: phones, subscriptions: [plan] }), { ref: REF }).find((x) => x.type === 'renewal')!
    expect(e.thingId).toBe('a')
    expect(e.detail).toBe('Pixel + 1 more')
  })
  it('goes quiet only when everything it is attached to is retired', () => {
    const retired = phones.map((t) => ({ ...t, status: 'retired' as const }))
    expect(buildHorizon(data({ things: retired, subscriptions: [plan] }), { ref: REF })).toEqual([])
  })
  it('splits its cost between them', () => {
    expect(ownership(phones[0], [], [plan], REF).subscriptionsPerYear).toBe(40)
  })
})

describe('hand-me-downs', () => {
  const ipad = thing({ ownerMemberId: 'sam', purchaseDate: '2023-03-01' })
  it('remembers who had it before', () => {
    expect(handDown(ipad, 'emma', '2026-11-12')).toEqual({ ownerMemberId: 'emma', ownershipHistory: [{ memberId: 'sam', from: '2023-03-01', to: '2026-11-12' }] })
  })
  it('chains from the last hand-over', () => {
    const second = handDown({ ...ipad, ...handDown(ipad, 'emma', '2025-06-01') }, null, '2026-11-12')
    expect(second.ownershipHistory).toEqual([{ memberId: 'sam', from: '2023-03-01', to: '2025-06-01' }, { memberId: 'emma', from: '2025-06-01', to: '2026-11-12' }])
    expect(second.ownerMemberId).toBeNull()
  })
  it('treats a same-day change of mind as a correction', () => {
    const once = { ...ipad, ...handDown(ipad, 'emma', '2026-11-12') }
    // Straight back: the hand-over is undone.
    expect(handDown(once, 'sam', '2026-11-12')).toEqual({ ownerMemberId: 'sam', ownershipHistory: undefined })
    // On to someone else: Emma never really had it.
    expect(handDown(once, 'gran', '2026-11-12').ownershipHistory).toEqual([{ memberId: 'sam', from: '2023-03-01', to: '2026-11-12' }])
  })
  it('does nothing when the owner has not changed', () => {
    expect(handDown(ipad, 'sam', '2026-11-12')).toEqual({ ownerMemberId: 'sam', ownershipHistory: undefined })
  })
})

describe('removing a member', () => {
  it('is blocked while anything still points at them', () => {
    const d = data({ things: [thing({ ownerMemberId: 'emma' }), thing({ id: 't2', responsibleMemberId: 'emma' })], subscriptions: [sub({ payerMemberId: 'emma' })] })
    const ties = memberTies('emma', d)
    expect(ties).toEqual({ owns: 1, pays: 1, responsible: 1 })
    expect(isTied(ties)).toBe(true)
    expect(describeTies(ties)).toBe('owns 1 thing, pays for 1 plan and is responsible for 1 item')
    expect(isTied(memberTies('gran', d))).toBe(false)
  })
})

describe('who deals with a date', () => {
  const users = new Set(['ann', 'ben'])
  const phone = thing({ id: 'phone', responsibleMemberId: 'ann' })
  const things = new Map([[phone.id, phone]])

  it('gives a thing to whoever was picked, else to its owner if they use the app', () => {
    expect(handlerOfThing(thing({ ownerMemberId: 'ben', responsibleMemberId: 'ann' }), users)).toBe('ann')
    expect(handlerOfThing(thing({ ownerMemberId: 'ben' }), users)).toBe('ben')
    expect(handlerOfThing(thing({ ownerMemberId: 'kid' }), users)).toBeNull()
    expect(handlerOfThing(thing({}), users)).toBeNull()
  })
  it('gives a plan to whoever was picked, else its payer, else whoever handles what it is attached to', () => {
    expect(handlerOfPlan(sub({ responsibleMemberId: 'ben', payerMemberId: 'ann', coversThingIds: ['phone'] }), things, users)).toBe('ben')
    expect(handlerOfPlan(sub({ payerMemberId: 'ben', coversThingIds: ['phone'] }), things, users)).toBe('ben')
    expect(handlerOfPlan(sub({ coversThingIds: ['phone'] }), things, users)).toBe('ann')
    expect(handlerOfPlan(sub({}), things, users)).toBeNull()
  })
  it('reads a plan date from the plan and any other date from the thing', () => {
    const plan = sub({ id: 'care', responsibleMemberId: 'ben', coversThingIds: ['phone'] })
    const subs = new Map([[plan.id, plan]])
    expect(handlerOfEvent({ thingId: 'phone', subscriptionId: 'care' }, things, subs, users)).toBe('ben')
    expect(handlerOfEvent({ thingId: 'phone' }, things, subs, users)).toBe('ann')
    expect(handlerOfEvent({ thingId: 'gone' }, things, subs, users)).toBeNull()
  })
  it('only says an item needs someone when there is more than one user to leave it to', () => {
    expect(needsSomeone(null, users)).toBe(true)
    expect(needsSomeone('ann', users)).toBe(false)
    expect(needsSomeone(null, new Set(['ann']))).toBe(false)
    expect(needsSomeone(null, new Set())).toBe(false)
  })
  it('treats someone who lost their last device as nobody', () => {
    expect(handlerOfEvent({ thingId: 'phone' }, things, new Map(), new Set(['ben', 'cat']))).toBeNull()
  })
})

describe('handing a member\'s things on', () => {
  const users = new Set(['ben'])
  it('moves ownership and responsibility, and leaves unrelated items alone', () => {
    expect(reassignThing(thing({ ownerMemberId: 'ann', responsibleMemberId: 'ann' }), 'ann', 'ben', users)).toEqual({ ownerMemberId: 'ben', responsibleMemberId: 'ben' })
    expect(reassignThing(thing({ ownerMemberId: 'ben' }), 'ann', 'ben', users)).toBeNull()
  })
  it('does not make someone without a device responsible', () => {
    expect(reassignThing(thing({ responsibleMemberId: 'ann' }), 'ann', 'cat', users)).toEqual({ responsibleMemberId: null })
    expect(reassignPlan(sub({ responsibleMemberId: 'ann' }), 'ann', null, users)).toEqual({ responsibleMemberId: null })
  })
  it('keeps a private item private only when it goes to a user', () => {
    const secret = thing({ ownerMemberId: 'ann', visibility: 'private' })
    expect(reassignThing(secret, 'ann', 'ben', users)).toEqual({ ownerMemberId: 'ben' })
    expect(reassignThing(secret, 'ann', null, users)).toEqual({ ownerMemberId: null, visibility: 'shared' })
    expect(reassignThing(secret, 'ann', 'cat', users)).toEqual({ ownerMemberId: 'cat', visibility: 'shared' })
    expect(reassignPlan(sub({ payerMemberId: 'ann', visibility: 'private' }), 'ann', null, users)).toEqual({ payerMemberId: null, visibility: 'shared' })
  })
  it('leaves nothing tied once every item has been handed on', () => {
    const before = data({
      things: [thing({ id: 'a', ownerMemberId: 'ann' }), thing({ id: 'b', responsibleMemberId: 'ann' })],
      subscriptions: [sub({ id: 'p', payerMemberId: 'ann', responsibleMemberId: 'ann' })],
    })
    const after = data({
      things: before.things.map((t) => ({ ...t, ...reassignThing(t, 'ann', 'ben', users) })),
      subscriptions: before.subscriptions.map((x) => ({ ...x, ...reassignPlan(x, 'ann', 'ben', users) })),
    })
    expect(isTied(memberTies('ann', before))).toBe(true)
    expect(isTied(memberTies('ann', after))).toBe(false)
  })
  it('counts what is private to a member, which nobody else can see', () => {
    expect(privateHeld('ann', data({
      things: [thing({ id: 'a', ownerMemberId: 'ann', visibility: 'private' }), thing({ id: 'b', ownerMemberId: 'ann' })],
      subscriptions: [sub({ payerMemberId: 'ann', visibility: 'private' }), sub({ id: 's2', payerMemberId: 'ben', visibility: 'private' })],
    }))).toBe(2)
  })
})

describe('totals by member', () => {
  it('adds up what each payer\'s plans come to a month, the household under null', () => {
    const split = planCostByPayer([
      sub({ id: 'a', payerMemberId: 'ann', amount: 120, cycle: 'yearly' }),
      sub({ id: 'b', payerMemberId: 'ann', amount: 5, cycle: 'monthly' }),
      sub({ id: 'c', payerMemberId: null, amount: 20, cycle: 'monthly' }),
      sub({ id: 'd', payerMemberId: 'ben', amount: 9, cycle: 'monthly', status: 'cancelled' }),
    ])
    expect(split.get('ann')).toBeCloseTo(15)
    expect(split.get(null)).toBeCloseTo(20)
    expect(split.has('ben')).toBe(false)
  })
  it('splits the upgrade fund by owner and leaves out what is already due', () => {
    const split = fundByOwner([
      { thing: thing({ id: 'a', ownerMemberId: 'ann' }), monthly: 30, monthsLeft: 10 },
      { thing: thing({ id: 'b', ownerMemberId: 'ann' }), monthly: 10, monthsLeft: 4 },
      { thing: thing({ id: 'c', ownerMemberId: null }), monthly: 25, monthsLeft: 6 },
      { thing: thing({ id: 'd', ownerMemberId: 'ben' }), monthly: 599, monthsLeft: 0 },
    ])
    expect(split.get('ann')).toBe(40)
    expect(split.get(null)).toBe(25)
    expect(split.has('ben')).toBe(false)
  })
})
