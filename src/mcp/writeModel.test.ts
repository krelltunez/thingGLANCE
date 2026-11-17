import { describe, expect, it } from 'vitest'
import { TODAY, household, readOf, writeDepsOf, type Household } from './fixture'
import { handleRead } from './readModel'
import { handleWrite, undoWrites, type UndoOp, type WriteAnswer } from './writeModel'

type Row = Record<string, unknown>
const ID = '6f1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4b'
const ID2 = '7a1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4c'

function setup() {
  const h = household()
  const { deps, calls } = writeDepsOf(h)
  const write = (method: string, params: Row) => handleWrite(method, params, deps)
  return { h, deps, calls, write }
}
const done = (a: WriteAnswer | null) => { if (!a?.ok) throw new Error(`refused: ${JSON.stringify(a)}`); return a }
const refusal = (a: WriteAnswer | null) => (a && !a.ok ? a.error.code : 'none')
const thing = (h: Household, id: string) => h.things.find((t) => t.id === id)!
const plan = (h: Household, id: string) => h.subscriptions.find((s) => s.id === id)!
const queue = (h: Household): Row[] => {
  const a = handleRead(readOf(h), 'list_queue')
  return a?.ok ? a.data.items as Row[] : []
}
const coverageKey = (h: Household) => queue(h).find((e) => e.type === 'coverage-end')!.event_key as string

describe('adding', () => {
  it('adds a thing with the id it was given, through the door every outside write uses', async () => {
    const { h, write, calls } = setup()
    const a = done(await write('create_thing', { name: 'Kindle', category: 'other', purchase_date: '2026-11-01', price: 129, owner_member_id: 'ann', new_id: ID }))
    expect(thing(h, ID)).toMatchObject({ name: 'Kindle', price: 129, ownerMemberId: 'ann', visibility: 'shared' })
    expect(a.data).toMatchObject({ created: true, thing: { thing_id: ID, name: 'Kindle', owner_name: 'Ann' } })
    expect(a.undo).toEqual({ summary: 'Added "Kindle"', op: { kind: 'remove_created_thing', thingId: ID } })
    expect(calls).toEqual(['createThing'])
  })

  it('answers a retried create with the same thing, and nothing new to undo', async () => {
    const { h, write } = setup()
    await write('create_thing', { name: 'Kindle', new_id: ID })
    const again = done(await write('create_thing', { name: 'Kindle', new_id: ID }))
    expect(h.things.filter((t) => t.name === 'Kindle')).toHaveLength(1)
    expect(again.data.created).toBe(false)
    expect(again.undo).toBeUndefined()
  })

  it('refuses what the app would refuse, with the reason', async () => {
    const { write } = setup()
    expect(refusal(await write('create_thing', { new_id: ID }))).toBe('validation')
    expect(refusal(await write('create_thing', { name: 'Kindle', purchase_date: 'last week', new_id: ID }))).toBe('validation')
    expect(refusal(await write('create_thing', { name: 'Kindle', owner_member_id: 'stranger', new_id: ID }))).toBe('not_found')
    expect(refusal(await write('create_thing', { name: 'Kindle' }))).toBe('validation')
  })

  it('adds coverage to a thing, and a plan', async () => {
    const { h, write } = setup()
    const c = done(await write('add_coverage', { thing_id: 't-tv', name: 'Store warranty', end_date: '2027-01-10', new_id: ID }))
    expect(h.coverages.find((x) => x.id === ID)).toMatchObject({ thingId: 't-tv', endDate: '2027-01-10', type: 'warranty' })
    expect(c.undo?.op).toEqual({ kind: 'remove_created_coverage', thingId: 't-tv', coverageId: ID })
    const p = done(await write('create_plan', { name: 'Music', amount: 10.99, thing_ids: ['t-phone'], new_id: ID2 }))
    expect(plan(h, ID2)).toMatchObject({ name: 'Music', amount: 10.99, cycle: 'monthly', coversThingIds: ['t-phone'] })
    expect(p.data).toMatchObject({ created: true, plan: { plan_id: ID2, monthly_cost: 10.99 } })
  })

  it('cannot add coverage to a thing this member cannot see', async () => {
    const { write } = setup()
    expect(refusal(await write('add_coverage', { thing_id: 't-diary', name: 'Warranty', end_date: '2027-01-10', new_id: ID }))).toBe('not_found')
  })
})

describe('editing a thing', () => {
  it('changes only the fields named, and remembers what they were', async () => {
    const { h, write, calls } = setup()
    const a = done(await write('update_thing', { thing_id: 't-laptop', price: 2200, notes: 'Bought refurbished' }))
    expect(thing(h, 't-laptop')).toMatchObject({ name: 'MacBook Pro', price: 2200, notes: 'Bought refurbished', brand: 'Apple' })
    expect(a.data.changed).toEqual(['notes', 'price'])
    expect(a.undo?.op).toEqual({ kind: 'restore_thing_fields', thingId: 't-laptop', before: { price: 2400, notes: null } })
    expect(calls).toEqual(['updateThing'])
  })

  it('clears a field with null, and writes nothing when nothing would change', async () => {
    const { h, write, calls } = setup()
    done(await write('update_thing', { thing_id: 't-laptop', brand: null }))
    expect(thing(h, 't-laptop').brand).toBeUndefined()
    const same = done(await write('update_thing', { thing_id: 't-laptop', price: 2400 }))
    expect(same.data.changed).toEqual([])
    expect(same.undo).toBeUndefined()
    expect(calls).toEqual(['updateThing'])
  })

  it('marks a typed support date as the user\'s own', async () => {
    const { h, write } = setup()
    done(await write('update_thing', { thing_id: 't-phone', support_end: '2032-01-01' }))
    expect(thing(h, 't-phone')).toMatchObject({ supportEnd: '2032-01-01', supportBasis: 'manual' })
  })

  it('retires and brings back, with the resale value', async () => {
    const { h, write, calls } = setup()
    const a = done(await write('update_thing', { thing_id: 't-tv', retired: true, resale_value: 150 }))
    expect(thing(h, 't-tv')).toMatchObject({ status: 'retired', retiredAt: TODAY, resaleValue: 150 })
    expect(a.undo?.op).toMatchObject({ kind: 'restore_thing_fields', before: { status: 'active', retiredAt: null, resaleValue: null } })
    done(await write('update_thing', { thing_id: 't-tv', retired: false }))
    expect(thing(h, 't-tv')).toMatchObject({ status: 'active' })
    expect(thing(h, 't-tv').retiredAt).toBeUndefined()
    expect(calls).toEqual(['retireThing', 'reviveThing'])
  })

  it('keeps the form\'s rules', async () => {
    const { write } = setup()
    expect(refusal(await write('update_thing', { thing_id: 't-tv', visibility: 'private' }))).toBe('validation')
    expect(refusal(await write('update_thing', { thing_id: 't-tv', name: null }))).toBe('validation')
    expect(refusal(await write('update_thing', { thing_id: 't-tv', category: 'spaceship' }))).toBe('validation')
    expect(refusal(await write('update_thing', { thing_id: 't-tv', lifespan_months: 0 }))).toBe('validation')
    expect(refusal(await write('update_thing', { thing_id: 't-tv', resale_value: 50 }))).toBe('validation')
    expect(refusal(await write('update_thing', { thing_id: 't-diary', name: 'Mine now' }))).toBe('not_found')
  })
})

describe('reassigning', () => {
  it('hands a thing on, keeping who had it before', async () => {
    const { h, write } = setup()
    const a = done(await write('reassign_thing', { thing_id: 't-laptop', owner_member_id: 'kid', responsible_member_id: 'ben' }))
    expect(thing(h, 't-laptop')).toMatchObject({ ownerMemberId: 'kid', responsibleMemberId: 'ben' })
    expect(thing(h, 't-laptop').ownershipHistory).toEqual([expect.objectContaining({ memberId: 'ann', to: TODAY })])
    expect(a.undo?.op).toEqual({ kind: 'restore_thing_fields', thingId: 't-laptop', before: { ownerMemberId: 'ann', responsibleMemberId: null, ownershipHistory: null } })
    expect(a.data.thing).toMatchObject({ owner_name: 'Kit', owned_since: TODAY })
  })
  it('corrects an owner without a hand-over, and takes either back exactly', async () => {
    const { h, deps, write } = setup()
    // The TV was entered as the household's. It was Ann's all along.
    const fixed = done(await write('reassign_thing', { thing_id: 't-tv', owner_member_id: 'ann', correction: true }))
    expect(thing(h, 't-tv')).toMatchObject({ ownerMemberId: 'ann' })
    expect(thing(h, 't-tv').ownershipHistory).toBeUndefined()
    expect(fixed.data.thing).toMatchObject({ owner: 'member', owner_name: 'Ann', owned_since: '2020-01-10', ownership_history: [] })
    // Then it really does change hands.
    const handed = done(await write('reassign_thing', { thing_id: 't-tv', owner_member_id: 'ben' }))
    expect(thing(h, 't-tv').ownershipHistory).toEqual([{ memberId: 'ann', from: '2020-01-10', to: TODAY }])
    // Undone newest first: the hand-over leaves no trace, and neither does the correction.
    expect(await undoWrites([handed.undo!.op, fixed.undo!.op], deps)).toEqual({ undone: 2, skipped: [] })
    expect(thing(h, 't-tv').ownerMemberId).toBeNull()
    expect(thing(h, 't-tv').ownershipHistory).toBeUndefined()
    expect(refusal(await write('reassign_thing', { thing_id: 't-tv', responsible_member_id: 'ann', correction: true }))).toBe('validation')
  })
  it('gives a thing added with an owner one period, from the day it was bought', async () => {
    const { write } = setup()
    const a = done(await write('create_thing', { name: 'Kindle', purchase_date: '2025-01-01', owner_member_id: 'ann', new_id: ID }))
    expect(a.data.thing).toMatchObject({ owner: 'member', owner_name: 'Ann', owned_since: '2025-01-01', ownership_history: [] })
  })
  it('needs something to change, and a member who exists', async () => {
    const { write } = setup()
    expect(refusal(await write('reassign_thing', { thing_id: 't-laptop' }))).toBe('validation')
    expect(refusal(await write('reassign_thing', { thing_id: 't-laptop', owner_member_id: 'stranger' }))).toBe('not_found')
  })
})

describe('editing a plan', () => {
  it('records a cancellation', async () => {
    const { h, write } = setup()
    const a = done(await write('update_plan', { plan_id: 'p-stream', status: 'cancelled', end_date: '2026-12-03' }))
    expect(plan(h, 'p-stream')).toMatchObject({ status: 'cancelled', endDate: '2026-12-03' })
    expect(a.undo?.op).toEqual({ kind: 'restore_plan_fields', planId: 'p-stream', before: { status: 'active', endDate: null } })
    expect(a.data.plan).toMatchObject({ status: 'cancelled', next_renewal: null, monthly_cost: 0 })
  })
  it('starts a plan on a thing the day the thing was bought, unless told otherwise', async () => {
    const { h, write } = setup()
    done(await write('create_plan', { name: 'Phone care', amount: 5, thing_ids: ['t-phone'], new_id: ID }))
    expect(plan(h, ID).startDate).toBe('2025-11-25')
    done(await write('create_plan', { name: 'Music', amount: 10.99, new_id: ID2 }))
    // One on its own has no start until someone gives it one.
    expect(plan(h, ID2).startDate).toBeUndefined()
    const a = done(await write('create_plan', { name: 'Lease', amount: 75.17, anchor_date: '2026-11-19', start_date: '2026-09-22', end_date: '2029-09-22', thing_ids: ['t-phone'], new_id: '8a1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4d' }))
    expect(a.data.plan).toMatchObject({ start_date: '2026-09-22', start_date_status: 'recorded', end_date: '2029-09-22', monthly_cost: 75.17, left_on_term: { ends: '2029-09-22', payments: 35 } })
    expect(refusal(await write('create_plan', { name: 'Backwards', amount: 1, start_date: '2027-01-01', end_date: '2026-01-01', new_id: '9a1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4e' }))).toBe('validation')
  })
  it('sets and clears a start date, and turns a plan into a fixed term', async () => {
    const { h, write } = setup()
    const a = done(await write('update_plan', { plan_id: 'p-stream', start_date: '2026-08-03' }))
    expect(plan(h, 'p-stream').startDate).toBe('2026-08-03')
    // Aug 3, Sep 3, Oct 3, Nov 3: four payments behind it on the 16th.
    expect(a.data.plan).toMatchObject({ start_date: '2026-08-03', start_date_status: 'recorded', paid_to_date: { basis: 'start_date', payments: 4, total: 63.96 } })
    expect(a.undo?.op).toEqual({ kind: 'restore_plan_fields', planId: 'p-stream', before: { startDate: null } })
    // Paid each month until it ends: December, January and February are left.
    const term = done(await write('update_plan', { plan_id: 'p-stream', end_date: '2027-03-03' }))
    expect(term.data.plan).toMatchObject({ auto_renew: true, monthly_cost: 15.99, left_on_term: { ends: '2027-03-03', payments: 3, total: 47.97 } })
    // Paid up front and not renewing: nothing more to pay, and no term.
    const prepaid = done(await write('update_plan', { plan_id: 'p-stream', auto_renew: false }))
    expect(prepaid.data.plan).toMatchObject({ monthly_cost: 0, next_renewal: null, left_on_term: null })
    done(await write('update_plan', { plan_id: 'p-stream', start_date: null }))
    expect(plan(h, 'p-stream').startDate).toBeUndefined()
    expect(refusal(await write('update_plan', { plan_id: 'p-stream', start_date: '2027-06-01' }))).toBe('validation')
  })
  it('takes "started before I tracked it" as an answer, and never beside a date', async () => {
    const { h, deps, write } = setup()
    const made = done(await write('create_plan', { name: 'Old gym', amount: 30, anchor_date: '2025-12-20', start_date_status: 'unknown', thing_ids: ['t-phone'], new_id: ID }))
    // Unknown is said in place of a date: the phone's purchase date is not borrowed.
    expect(plan(h, ID).startDate).toBeUndefined()
    expect(plan(h, ID).startUnknown).toBe(true)
    expect(made.data.plan).toMatchObject({ start_date: null, start_date_status: 'unknown', paid_to_date: { basis: 'anchor', since: '2025-12-20' } })
    expect(refusal(await write('create_plan', { name: 'Both', amount: 1, start_date: '2026-01-01', start_date_status: 'unknown', new_id: ID2 }))).toBe('validation')

    // On a plan that has a date: unknown clears it, and undo brings it back.
    done(await write('update_plan', { plan_id: 'p-stream', start_date: '2026-08-03' }))
    const cleared = done(await write('update_plan', { plan_id: 'p-stream', start_date_status: 'unknown' }))
    expect(plan(h, 'p-stream')).toMatchObject({ startUnknown: true })
    expect(plan(h, 'p-stream').startDate).toBeUndefined()
    expect(cleared.data).toMatchObject({ changed: ['startDate', 'startUnknown'], plan: { start_date: null, start_date_status: 'unknown' } })
    expect(await undoWrites([cleared.undo!.op], deps)).toEqual({ undone: 1, skipped: [] })
    expect(plan(h, 'p-stream').startDate).toBe('2026-08-03')
    expect(plan(h, 'p-stream').startUnknown).toBeUndefined()

    // A date given later is the answer, and "not_set" takes either back.
    done(await write('update_plan', { plan_id: 'p-stream', start_date_status: 'unknown' }))
    const dated = done(await write('update_plan', { plan_id: 'p-stream', start_date: '2026-09-03' }))
    expect(plan(h, 'p-stream').startUnknown).toBeUndefined()
    expect(dated.data.plan).toMatchObject({ start_date: '2026-09-03', start_date_status: 'recorded' })
    expect(done(await write('update_plan', { plan_id: 'p-stream', start_date_status: 'not_set' })).data.plan).toMatchObject({ start_date: null, start_date_status: 'not_set' })

    expect(refusal(await write('update_plan', { plan_id: 'p-stream', start_date: '2026-09-03', start_date_status: 'unknown' }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-stream', start_date: '2026-09-03', start_date_status: 'not_set' }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-stream', start_date_status: 'recorded' }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-stream', start_date_status: 'sometime' }))).toBe('validation')
    expect(done(await write('update_plan', { plan_id: 'p-stream', start_date: '2026-09-03', start_date_status: 'recorded' })).data.plan).toMatchObject({ start_date_status: 'recorded' })
  })
  it('takes the household by name for who pays, who deals with it and who uses it', async () => {
    const { h, deps, write } = setup()
    // Ann pays for the cloud plan. Hand all three to the household, in words.
    const a = done(await write('update_plan', { plan_id: 'p-cloud', payer_member_id: 'household', responsible_member_id: 'household', used_by: 'household' }))
    expect(plan(h, 'p-cloud')).toMatchObject({ payerMemberId: null, responsibleMemberId: null, coversMemberIds: [], coversHousehold: true })
    expect(a.data).toMatchObject({ changed: ['coversHousehold', 'payerMemberId'], plan: { payer: 'household', responsible: 'household', used_by: 'household', member_names: ['Household'] } })
    // Naming people takes the household's place.
    const named = done(await write('update_plan', { plan_id: 'p-cloud', member_ids: ['ann', 'kid'] }))
    expect(plan(h, 'p-cloud').coversMemberIds).toEqual(['ann', 'kid'])
    expect(plan(h, 'p-cloud').coversHousehold).toBeUndefined()
    expect(named.data.plan).toMatchObject({ used_by: 'members', member_names: ['Ann', 'Kit'] })
    // "not_set" takes the answer back altogether.
    expect(done(await write('update_plan', { plan_id: 'p-cloud', used_by: 'not_set' })).data.plan).toMatchObject({ used_by: 'not_set', member_ids: [] })
    // Undo, newest first, puts back who was named and then the household.
    expect(await undoWrites([named.undo!.op], deps)).toEqual({ undone: 1, skipped: [] })
    expect(plan(h, 'p-cloud')).toMatchObject({ coversMemberIds: [], coversHousehold: true })

    expect(refusal(await write('update_plan', { plan_id: 'p-cloud', member_ids: ['ann'], used_by: 'household' }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-cloud', used_by: 'members' }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-cloud', used_by: 'everyone' }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-cloud', member_ids: ['stranger'] }))).toBe('not_found')

    // A new plan takes the same words.
    const made = done(await write('create_plan', { name: 'Family films', amount: 20, payer_member_id: 'household', used_by: 'household', new_id: ID }))
    expect(plan(h, ID)).toMatchObject({ payerMemberId: null, coversMemberIds: [], coversHousehold: true })
    expect(made.data.plan).toMatchObject({ payer: 'household', used_by: 'household' })
    done(await write('create_plan', { name: 'Kit\'s games', amount: 5, member_ids: ['kid'], new_id: ID2 }))
    expect(plan(h, ID2)).toMatchObject({ coversMemberIds: ['kid'] })
    expect(plan(h, ID2).coversHousehold).toBeUndefined()
    expect(refusal(await write('create_plan', { name: 'Both', amount: 1, member_ids: ['kid'], used_by: 'household', new_id: '8a1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4d' }))).toBe('validation')
  })
  it('keeps the form\'s rules', async () => {
    const { write } = setup()
    expect(refusal(await write('update_plan', { plan_id: 'p-stream', status: 'trial' }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-stream', visibility: 'private' }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-stream', amount: -1 }))).toBe('validation')
    expect(refusal(await write('update_plan', { plan_id: 'p-stream', thing_ids: ['t-diary'] }))).toBe('not_found')
    expect(refusal(await write('update_plan', { plan_id: 'nope', amount: 5 }))).toBe('not_found')
  })
})

describe('settling a date', () => {
  it('marks it done, takes it out of the queue, and can put it back', async () => {
    const { h, write } = setup()
    const key = coverageKey(h)
    const a = done(await write('decide_event', { event_key: key, new_id: ID }))
    expect(a.data).toEqual({ event_key: key, state: 'done', changed: true })
    expect(a.undo?.op).toEqual({ kind: 'restore_decision', eventKey: key, before: null })
    expect(queue(h).some((e) => e.event_key === key)).toBe(false)
    const back = done(await write('decide_event', { event_key: key, state: 'restore', new_id: ID2 }))
    expect(back.data.state).toBe('open')
    expect(back.undo?.op).toEqual({ kind: 'restore_decision', eventKey: key, before: 'done' })
  })
  it('refuses a date that is not there, and a state it does not know', async () => {
    const { h, write } = setup()
    expect(refusal(await write('decide_event', { event_key: 'renewal:nope:2026-01-01', new_id: ID }))).toBe('not_found')
    expect(refusal(await write('decide_event', { event_key: coverageKey(h), state: 'maybe', new_id: ID }))).toBe('validation')
  })
})

describe('undo', () => {
  it('takes each kind of change back', async () => {
    const { h, write, deps } = setup()
    const before = JSON.parse(JSON.stringify(h))
    const ops: UndoOp[] = []
    const key = coverageKey(h)
    for (const [method, params] of [
      ['create_thing', { name: 'Kindle', new_id: ID }],
      ['add_coverage', { thing_id: 't-tv', name: 'Store warranty', end_date: '2027-01-10', new_id: ID2 }],
      ['create_plan', { name: 'Music', amount: 10.99, new_id: '8a1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4d' }],
      ['update_thing', { thing_id: 't-laptop', price: 1, brand: null, retired: true }],
      ['reassign_thing', { thing_id: 't-phone', owner_member_id: 'ann' }],
      ['update_plan', { plan_id: 'p-cloud', amount: 129, payer_member_id: null }],
      ['decide_event', { event_key: key, state: 'dismissed', new_id: '9a1c2a3b-4d5e-5f60-8a7b-9c0d1e2f3a4e' }],
    ] as const) ops.push(done(await write(method, params)).undo!.op)
    // Newest first, as the journal hands them over.
    expect(await undoWrites([...ops].reverse(), deps)).toEqual({ undone: 7, skipped: [] })
    const strip = (x: Household) => JSON.parse(JSON.stringify({ ...x, things: x.things.map(({ updatedAt: _u, ...t }) => t) }))
    expect(strip(h)).toEqual(strip(before))
  })

  it('skips what is no longer there, and says so, without stopping', async () => {
    const { h, deps } = setup()
    h.things = h.things.filter((t) => t.id !== 't-tv')
    const out = await undoWrites([
      { kind: 'restore_thing_fields', thingId: 't-tv', before: { name: 'TV' } },
      { kind: 'restore_thing_fields', thingId: 't-laptop', before: { name: 'Work laptop' } },
      { kind: 'launch_rocket' },
    ], deps)
    expect(out.undone).toBe(1)
    expect(out.skipped.map((s) => s.kind)).toEqual(['restore_thing_fields', 'launch_rocket'])
    expect(thing(h, 't-laptop').name).toBe('Work laptop')
  })
})

describe('anything else', () => {
  it('is not this model\'s to answer', async () => {
    expect(await setup().write('delete_thing', { thing_id: 't-tv' })).toBeNull()
  })
})
