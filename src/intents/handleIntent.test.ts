import { describe, expect, it, vi } from 'vitest'
import type { HorizonEvent, Thing } from '@/core/types'
import { INTENT_ACTIONS, handleIntent, type IntentContext, type LedgerIO } from './handleIntent'
import { LEDGER_LIMIT, findHandled, readLedger, recordHandled, writeLedger, type HandledWrite } from './ledger'

const UUID = '3f2b8c1e-5d47-4a90-8b6e-1c2d3e4f5a6b'
const stamp = '2026-01-01T00:00:00.000Z'
const laptop: Thing = { id: 't1', kind: 'thing', name: 'Laptop', category: 'laptop', status: 'active', ownerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp }
const event = { key: 'coverage-end:c1:2027-01-15', type: 'coverage-end', thingId: 't1' } as HorizonEvent

// A ledger that lives for one test, as localStorage would across calls.
function memory(): LedgerIO & { all: () => HandledWrite[] } {
  let ledger: HandledWrite[] = []
  return { get ledger() { return ledger }, persist: (next) => { ledger = next }, all: () => ledger }
}

function fakes(over: Partial<IntentContext> = {}) {
  const ctx = {
    getThing: vi.fn(async (id: string) => (id === 't1' ? laptop : null)),
    entityExists: vi.fn(async () => false),
    members: vi.fn(async () => [{ id: 'ann', name: 'Ann', updatedAt: stamp }]),
    createThing: vi.fn(async (_input, id?: string) => ({ id: id ?? 'new-thing' })),
    saveCoverage: vi.fn(async (_input, id?: string) => ({ id: id ?? 'new-cov' })),
    savePlan: vi.fn(async (_input, id?: string) => ({ id: id ?? 'new-plan' })),
    findEvent: vi.fn(async (key: string) => (key === event.key ? event : null)),
    decide: vi.fn(async () => {}),
    undecide: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    navigate: vi.fn(),
    ...over,
  } satisfies IntentContext
  return ctx
}

describe('every write needs an id, and is applied once', () => {
  it('refuses a write with no clientId', async () => {
    const ctx = fakes()
    const r = await handleIntent({ action: 'create_thing', payload: { name: 'Pixel 9' } }, ctx, memory())
    expect(r).toMatchObject({ success: false, code: 'client_id_required' })
    expect(ctx.createThing).not.toHaveBeenCalled()
  })
  it('applies a re-sent write once and answers the same id', async () => {
    const ctx = fakes()
    const io = memory()
    const first = await handleIntent({ action: 'create_thing', payload: { name: 'Pixel 9' }, clientId: 'tap-1' }, ctx, io)
    const again = await handleIntent({ action: 'create_thing', payload: { name: 'Pixel 9' }, clientId: 'tap-1' }, ctx, io)
    expect(first).toEqual({ success: true, thing_id: 'new-thing' })
    expect(again).toEqual({ success: true, deduped: true, thing_id: 'new-thing' })
    expect(ctx.createThing).toHaveBeenCalledTimes(1)
  })
  it('applies two copies that arrive together once', async () => {
    const ctx = fakes()
    const io = memory()
    const write = { action: 'create_thing', payload: { name: 'Pixel 9' }, clientId: 'double' }
    const [a, b] = await Promise.all([handleIntent(write, ctx, io), handleIntent(write, ctx, io)])
    expect(a).toEqual(b)
    expect(ctx.createThing).toHaveBeenCalledTimes(1)
  })
  it('does not remember a write that was refused, so a corrected retry goes through', async () => {
    const ctx = fakes()
    const io = memory()
    expect((await handleIntent({ action: 'create_thing', payload: {}, clientId: 'c1' }, ctx, io)).success).toBe(false)
    expect((await handleIntent({ action: 'create_thing', payload: { name: 'Pixel 9' }, clientId: 'c1' }, ctx, io)).success).toBe(true)
  })
  it('uses a UUID clientId as the new row\'s own id', async () => {
    const ctx = fakes()
    const r = await handleIntent({ action: 'create_thing', payload: { name: 'Pixel 9' }, clientId: UUID }, ctx, memory())
    expect(r.thing_id).toBe(UUID)
    expect(ctx.createThing).toHaveBeenCalledWith(expect.objectContaining({ name: 'Pixel 9' }), UUID)
  })
  it('treats a create as landed when its row already exists, with no ledger at all', async () => {
    const ctx = fakes({ entityExists: vi.fn(async () => true) })
    const r = await handleIntent({ action: 'create_thing', payload: { name: 'Pixel 9' }, clientId: UUID }, ctx, memory())
    expect(r).toEqual({ success: true, deduped: true, thing_id: UUID })
    expect(ctx.createThing).not.toHaveBeenCalled()
  })
  it('asks reads for no id', async () => {
    expect((await handleIntent({ action: 'open', payload: { link: 'thingglance://queue' } }, fakes(), memory())).success).toBe(true)
    expect((await handleIntent({ action: 'query' }, fakes(), memory())).success).toBe(true)
  })
})

describe('creating', () => {
  it('builds a thing the way the form would, guessing the kind from the name', async () => {
    const ctx = fakes()
    await handleIntent({ action: 'create_thing', clientId: 'c', payload: { name: ' Pixel 9 Pro ', brand: 'Google', purchase_date: '2026-10-01', price: '999', owner_member_id: 'ann' } }, ctx, memory())
    expect(vi.mocked(ctx.createThing).mock.calls[0][0]).toMatchObject({
      name: 'Pixel 9 Pro', category: 'phone', status: 'active', brand: 'Google', purchaseDate: '2026-10-01', price: 999,
      ownerMemberId: 'ann', responsibleMemberId: null, visibility: 'shared',
    })
  })
  it('says what is wrong with a payload and changes nothing', async () => {
    const ctx = fakes()
    const bad = async (payload: Record<string, unknown>) => handleIntent({ action: 'create_thing', clientId: crypto.randomUUID(), payload }, ctx, memory())
    expect(await bad({})).toMatchObject({ success: false, code: 'invalid', error: '"name" is required' })
    expect(await bad({ name: 'X', purchase_date: 'last week' })).toMatchObject({ code: 'invalid' })
    expect(await bad({ name: 'X', price: -5 })).toMatchObject({ code: 'invalid' })
    expect(await bad({ name: 'X', category: 'hovercraft' })).toMatchObject({ code: 'invalid' })
    expect(await bad({ name: 'X', owner_member_id: 'nobody' })).toMatchObject({ code: 'not_found' })
    expect(ctx.createThing).not.toHaveBeenCalled()
  })
  it('adds coverage only to a thing this device can see', async () => {
    const ctx = fakes()
    const ok = await handleIntent({ action: 'add_coverage', clientId: 'a', payload: { thing_id: 't1', name: 'AppleCare+', end_date: '2028-01-15', type: 'extended' } }, ctx, memory())
    expect(ok).toEqual({ success: true, coverage_id: 'new-cov' })
    expect(vi.mocked(ctx.saveCoverage).mock.calls[0][0]).toMatchObject({ thingId: 't1', name: 'AppleCare+', endDate: '2028-01-15', type: 'extended' })
    const hidden = await handleIntent({ action: 'add_coverage', clientId: 'b', payload: { thing_id: 'someone-elses-private-thing', name: 'W', end_date: '2028-01-15' } }, ctx, memory())
    expect(hidden).toMatchObject({ success: false, code: 'not_found' })
    const backwards = await handleIntent({ action: 'add_coverage', clientId: 'c', payload: { thing_id: 't1', name: 'W', start_date: '2029-01-01', end_date: '2028-01-15' } }, ctx, memory())
    expect(backwards).toMatchObject({ success: false, code: 'invalid' })
  })
  it('creates a plan with sensible defaults, attached to things that exist', async () => {
    const ctx = fakes()
    const r = await handleIntent({ action: 'create_plan', clientId: 'p', payload: { name: 'iCloud+ 2TB', amount: 9.99, thing_ids: ['t1', 't1'] } }, ctx, memory())
    expect(r).toEqual({ success: true, plan_id: 'new-plan' })
    expect(vi.mocked(ctx.savePlan).mock.calls[0][0]).toMatchObject({ name: 'iCloud+ 2TB', amount: 9.99, cycle: 'monthly', autoRenew: true, status: 'active', review: false, coversThingIds: ['t1'], payerMemberId: null, visibility: 'shared' })
    expect(await handleIntent({ action: 'create_plan', clientId: 'q', payload: { name: 'X', amount: 1, thing_ids: ['gone'] } }, ctx, memory())).toMatchObject({ code: 'not_found' })
    expect(await handleIntent({ action: 'create_plan', clientId: 'r', payload: { name: 'X', amount: 1, status: 'trial' } }, ctx, memory())).toMatchObject({ code: 'invalid' })
  })
})

describe('the queue from outside', () => {
  it('clears a date and puts it back', async () => {
    const ctx = fakes()
    expect(await handleIntent({ action: 'decide', clientId: 'd1', payload: { event_key: event.key } }, ctx, memory())).toEqual({ success: true, event_key: event.key, state: 'done' })
    expect(ctx.decide).toHaveBeenCalledWith(event.key, 'done')
    await handleIntent({ action: 'decide', clientId: 'd2', payload: { event_key: event.key, state: 'restore' } }, ctx, memory())
    expect(ctx.undecide).toHaveBeenCalledWith(event.key)
  })
  it('will not clear a date this device cannot see', async () => {
    const ctx = fakes()
    const r = await handleIntent({ action: 'decide', clientId: 'd', payload: { event_key: 'coverage-end:hidden:2027-01-01' } }, ctx, memory())
    expect(r).toMatchObject({ success: false, code: 'not_found' })
    expect(ctx.decide).not.toHaveBeenCalled()
  })
  it('sends a date to dayGLANCE, and says plainly when it cannot', async () => {
    const ctx = fakes()
    expect(await handleIntent({ action: 'send', clientId: 's1', payload: { event_key: event.key } }, ctx, memory())).toEqual({ success: true, event_key: event.key })
    expect(ctx.send).toHaveBeenCalledWith(event)
    const off = fakes({ send: vi.fn(async () => { throw Object.assign(new Error('off'), { reason: 'disabled' }) }) })
    expect(await handleIntent({ action: 'send', clientId: 's2', payload: { event_key: event.key } }, off, memory())).toMatchObject({ success: false, code: 'unavailable' })
  })
})

describe('reads', () => {
  it('opens a link through the router and refuses anything that is not one', async () => {
    const ctx = fakes()
    await handleIntent({ action: 'open', payload: { link: 'thingglance://thing/t1' } }, ctx)
    expect(ctx.navigate).toHaveBeenCalledWith({ kind: 'thing', id: 't1' })
    expect(await handleIntent({ action: 'open', payload: { link: 'https://evil.example' } }, ctx)).toMatchObject({ success: false, code: 'invalid' })
  })
  it('refuses an action it does not know', async () => {
    expect(await handleIntent({ action: 'delete_everything', clientId: 'x' }, fakes(), memory())).toMatchObject({ success: false, code: 'unknown_action' })
    expect(Object.values(INTENT_ACTIONS).some((a) => /delete|remove|erase/.test(a))).toBe(false)
  })
  it('validates and answers with nothing wired, changing nothing', async () => {
    expect(await handleIntent({ action: 'create_thing', clientId: UUID, payload: { name: 'Pixel 9' } }, {}, memory())).toEqual({ success: true, thing_id: UUID })
    expect(await handleIntent({ action: 'create_thing', clientId: 'dry', payload: {} }, {}, memory())).toMatchObject({ success: false, code: 'invalid' })
  })
})

describe('the ledger', () => {
  const entry = (n: number): HandledWrite => ({ clientId: `c${n}`, action: 'decide', entityId: null, at: stamp })
  it('keeps the newest entries and stays bounded', () => {
    let ledger: HandledWrite[] = []
    for (let i = 0; i < LEDGER_LIMIT + 20; i++) ledger = recordHandled(ledger, entry(i))
    expect(ledger).toHaveLength(LEDGER_LIMIT)
    expect(findHandled(ledger, 'c0')).toBeNull()
    expect(findHandled(ledger, `c${LEDGER_LIMIT + 19}`)).not.toBeNull()
  })
  it('survives storage that is missing, full or corrupt', () => {
    expect(readLedger(undefined)).toEqual([])
    expect(readLedger({ getItem: () => '{not json', setItem: () => {} })).toEqual([])
    expect(readLedger({ getItem: () => '{"a":1}', setItem: () => {} })).toEqual([])
    expect(() => writeLedger([entry(1)], { getItem: () => null, setItem: () => { throw new Error('full') } })).not.toThrow()
  })
})

describe('what a write may carry', () => {
  const tryThing = (ctx: IntentContext, payload: Record<string, unknown>) => handleIntent({ action: 'create_thing', clientId: crypto.randomUUID(), payload: { name: 'X', ...payload } }, ctx, memory())

  it('refuses a date that is the right shape and not a real day', async () => {
    const ctx = fakes()
    for (const end_date of ['2027-13-45', '2027-02-31', '0000-00-00', '9999-99-99']) {
      expect(await handleIntent({ action: 'add_coverage', clientId: crypto.randomUUID(), payload: { thing_id: 't1', name: 'W', end_date } }, ctx, memory()), end_date).toMatchObject({ success: false, code: 'invalid' })
    }
    expect(ctx.saveCoverage).not.toHaveBeenCalled()
  })
  it('refuses figures no date or total could hold', async () => {
    const ctx = fakes()
    expect(await tryThing(ctx, { purchase_date: '2026-01-01', lifespan_months: 1e9 })).toMatchObject({ code: 'invalid' })
    expect(await tryThing(ctx, { lifespan_months: 0 })).toMatchObject({ code: 'invalid' })
    expect(await tryThing(ctx, { lifespan_months: 30.5 })).toMatchObject({ code: 'invalid' })
    expect(await tryThing(ctx, { price: 1e308 })).toMatchObject({ code: 'invalid' })
    expect(await tryThing(ctx, { price: '0x10' })).toMatchObject({ code: 'invalid' })
    expect(await tryThing(ctx, { price: '1e5' })).toMatchObject({ code: 'invalid' })
    expect(await handleIntent({ action: 'create_plan', clientId: 'big', payload: { name: 'X', amount: 1e308, cycle: 'weekly' } }, ctx, memory())).toMatchObject({ code: 'invalid' })
    expect(ctx.createThing).not.toHaveBeenCalled()
    expect(ctx.savePlan).not.toHaveBeenCalled()
  })
  it('still takes a plain number written as text', async () => {
    const ctx = fakes()
    expect(await tryThing(ctx, { price: '999.50', lifespan_months: '48' })).toMatchObject({ success: true })
    expect(vi.mocked(ctx.createThing).mock.calls[0][0]).toMatchObject({ price: 999.5, lifespanMonths: 48 })
  })
  it('answers something that is not a write at all', async () => {
    expect(await handleIntent(null as never)).toMatchObject({ success: false, code: 'invalid' })
  })
})

describe('one id, one write', () => {
  it('refuses an id that was already used for a different action', async () => {
    const ctx = fakes(); const io = memory()
    expect(await handleIntent({ action: 'create_thing', payload: { name: 'Pixel 9' }, clientId: 'same' }, ctx, io)).toMatchObject({ success: true, thing_id: 'new-thing' })
    const second = await handleIntent({ action: 'add_coverage', payload: { thing_id: 't1', name: 'W', end_date: '2028-01-15' }, clientId: 'same' }, ctx, io)
    expect(second).toMatchObject({ success: false, code: 'invalid' })
    expect(second.thing_id).toBeUndefined()
    expect(ctx.saveCoverage).not.toHaveBeenCalled()
  })
  it('asks for a row of the right kind when deciding a create has landed', async () => {
    // A thing has this id. That says nothing about a coverage with it.
    const ctx = fakes({ entityExists: vi.fn(async (_id: string, kind: string) => kind === 'thing') })
    const r = await handleIntent({ action: 'add_coverage', payload: { thing_id: 't1', name: 'W', end_date: '2028-01-15' }, clientId: UUID }, ctx, memory())
    expect(r).toEqual({ success: true, coverage_id: UUID })
    expect(ctx.entityExists).toHaveBeenCalledWith(UUID, 'coverage')
    expect(ctx.saveCoverage).toHaveBeenCalledOnce()
  })
  it('tells a retry its create landed even when what it pointed at has since gone', async () => {
    const ctx = fakes({ entityExists: vi.fn(async () => true), getThing: vi.fn(async () => null), members: vi.fn(async () => []) })
    expect(await handleIntent({ action: 'add_coverage', payload: { thing_id: 'deleted', name: 'W', end_date: '2028-01-15' }, clientId: UUID }, ctx, memory())).toEqual({ success: true, deduped: true, coverage_id: UUID })
    expect(await handleIntent({ action: 'create_plan', payload: { name: 'X', amount: 1, thing_ids: ['deleted'] }, clientId: UUID }, ctx, memory())).toEqual({ success: true, deduped: true, plan_id: UUID })
    expect(await handleIntent({ action: 'create_thing', payload: { name: 'X', owner_member_id: 'removed' }, clientId: UUID }, ctx, memory())).toEqual({ success: true, deduped: true, thing_id: UUID })
  })
  it('repeats what a decision was left as', async () => {
    const ctx = fakes(); const io = memory()
    await handleIntent({ action: 'decide', clientId: 'd', payload: { event_key: event.key, state: 'dismissed' } }, ctx, io)
    expect(await handleIntent({ action: 'decide', clientId: 'd', payload: { event_key: event.key, state: 'dismissed' } }, ctx, io)).toEqual({ success: true, deduped: true, event_key: event.key, state: 'dismissed' })
    expect(ctx.decide).toHaveBeenCalledOnce()
  })
})
