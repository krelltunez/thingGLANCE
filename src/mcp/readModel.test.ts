import { describe, expect, it } from 'vitest'
import { dayOf } from '@/core/dates'
import { TODAY, household, planRow, readOf, thingRow, type Household } from './fixture'
import { handleRead, type McpAnswer } from './readModel'

type Row = Record<string, unknown>
const data = (a: McpAnswer | null): Row => { if (!a?.ok) throw new Error(`refused: ${JSON.stringify(a)}`); return a.data }
const items = (a: McpAnswer | null) => data(a).items as Row[]
const error = (a: McpAnswer | null) => (a && !a.ok ? a.error.code : 'none')
const ask = (method: string, params: Row = {}) => handleRead(readOf(household()), method, params)
const names = (rows: Row[]) => rows.map((r) => r.name)

describe('what an assistant is shown', () => {
  it('never includes another member\'s private things, in any answer', () => {
    const everything = JSON.stringify([ask('overview'), ask('list_things', { status: 'all' }), ask('list_upcoming', { to: '2029-11-16' }), ask('list_members')])
    expect(everything).not.toContain('E-reader')
    expect(error(ask('get_thing', { thing_id: 't-diary' }))).toBe('not_found')
  })

  it('answers only the methods it knows', () => {
    expect(handleRead(readOf(household()), 'create_thing', {})).toBeNull()
    expect(data(ask('ping'))).toEqual({ ok: true })
  })
})

describe('the overview', () => {
  const o = data(ask('overview'))
  it('counts what is in service and what the plans cost', () => {
    expect(o.counts).toMatchObject({ things_in_service: 3, plans: 3 })
    expect(o.currency).toBe('USD')
    expect((o.plan_cost as Row).monthly).toBeCloseTo(15.99 + 119 / 12, 2)
    expect(o.me).toEqual({ member_id: 'ann', name: 'Ann' })
  })
  it('lists what needs a decision, most pressing first, each with its key', () => {
    const queue = o.needs_decision as Row[]
    expect(queue.length).toBe((o.counts as Row).needs_decision)
    expect(queue.map((e) => e.type)).toEqual(expect.arrayContaining(['coverage-end', 'trial-end']))
    expect(queue.every((e) => e.needs_decision === true && e.state === 'open' && typeof e.event_key === 'string')).toBe(true)
    const days = queue.map((e) => e.days_away as number)
    expect(days).toEqual([...days].sort((a, b) => a - b))
  })
})

describe('listing things', () => {
  it('lists what is in service by default, soonest to run out first', () => {
    const rows = items(ask('list_things'))
    expect(names(rows).sort()).toEqual(['Living room TV', 'MacBook Pro', 'Pixel 9'])
    expect(rows[0].name).toBe('Living room TV')
    expect(rows.find((r) => r.name === 'Pixel 9')).toMatchObject({ thing_id: 't-phone', category: 'phone', owner_member_id: 'kid', owner_name: 'Kit', coverage_end: '2026-11-25', under_coverage: true, support_end: '2031-08-01' })
  })
  it('filters by status, owner, category, verdict and words', () => {
    expect(names(items(ask('list_things', { status: 'retired' })))).toEqual(['Old tablet'])
    expect(names(items(ask('list_things', { owner: 'me' })))).toEqual(['MacBook Pro'])
    expect(names(items(ask('list_things', { owner: 'household' })))).toEqual(['Living room TV'])
    expect(names(items(ask('list_things', { owner: 'kid' })))).toEqual(['Pixel 9'])
    expect(names(items(ask('list_things', { category: 'phone' })))).toEqual(['Pixel 9'])
    expect(names(items(ask('list_things', { query: 'apple macbook' })))).toEqual(['MacBook Pro'])
    expect(names(items(ask('list_things', { verdict: 'replace' })))).toEqual(['Living room TV'])
  })
  it('refuses a filter it does not know, and says which', () => {
    expect(error(ask('list_things', { status: 'broken' }))).toBe('validation')
    expect(error(ask('list_things', { verdict: 'fine' }))).toBe('validation')
    expect(error(ask('list_things', { owner: 'nobody-here' }))).toBe('not_found')
  })
})

describe('one thing', () => {
  it('comes with its coverage, its plans and its dates', () => {
    const d = data(ask('get_thing', { thing_id: 't-phone' }))
    expect(d.thing).toMatchObject({ name: 'Pixel 9', price: 800, purchase_date: '2025-11-25' })
    expect(d.coverage).toEqual([expect.objectContaining({ coverage_id: 'c-phone', end_date: '2026-11-25', active: true })])
    expect((d.dates as Row[]).map((e) => e.type)).toEqual(expect.arrayContaining(['coverage-end', 'support-end']))
  })
})

describe('listing plans', () => {
  it('lists current plans, most expensive first, with the totals', () => {
    const d = data(ask('list_plans'))
    expect(names(d.items as Row[])).toEqual(['Streamflix', 'Cloud 2 TB', 'Photo editor'])
    expect((d.items as Row[])[1]).toMatchObject({ plan_id: 'p-cloud', cycle: 'yearly', next_renewal: '2026-12-01', payer_name: 'Ann', yearly_cost: 119 })
    expect((d.totals as Row).currency).toBe('USD')
  })
  it('filters by status and words', () => {
    expect(names(items(ask('list_plans', { status: 'cancelled' })))).toEqual(['Old gym'])
    expect(names(items(ask('list_plans', { status: 'trial' })))).toEqual(['Photo editor'])
    expect(names(items(ask('list_plans', { query: 'cloud apple' })))).toEqual(['Cloud 2 TB'])
    expect(error(ask('list_plans', { status: 'paused' }))).toBe('validation')
  })
})

describe('what is coming up', () => {
  it('lists the next 90 days by default, soonest first, without routine renewals', () => {
    const d = data(ask('list_upcoming'))
    expect(d.from).toBe(TODAY)
    const rows = d.items as Row[]
    expect(rows.map((e) => e.date)).toEqual([...rows.map((e) => e.date as string)].sort())
    expect(rows.some((e) => e.plan_id === 'p-stream')).toBe(false)
    expect(rows.some((e) => e.plan_id === 'p-cloud' && e.type === 'renewal')).toBe(true)
  })
  it('takes a window, kinds, and one thing or plan', () => {
    expect(items(ask('list_upcoming', { types: ['coverage-end'] })).every((e) => e.type === 'coverage-end')).toBe(true)
    expect(items(ask('list_upcoming', { thing_id: 't-phone', to: '2029-01-01' })).every((e) => e.thing_id === 't-phone')).toBe(true)
    expect(items(ask('list_upcoming', { include_routine: true })).some((e) => e.plan_id === 'p-stream')).toBe(true)
  })
  it('refuses a window it cannot read', () => {
    expect(error(ask('list_upcoming', { from: 'tomorrow' }))).toBe('validation')
    expect(error(ask('list_upcoming', { from: '2027-01-01', to: '2026-01-01' }))).toBe('validation')
    expect(error(ask('list_upcoming', { to: '2040-01-01' }))).toBe('validation')
    expect(error(ask('list_upcoming', { types: ['birthday'] }))).toBe('validation')
  })
})

describe('the queue and the household', () => {
  it('lists every date that needs a decision', () => {
    const rows = items(ask('list_queue'))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((e) => e.needs_decision === true)).toBe(true)
  })
  it('names the members, who uses the app, and which one this computer is', () => {
    const d = data(ask('list_members'))
    expect(d.this_device_member_id).toBe('ann')
    expect(d.items).toEqual([
      expect.objectContaining({ member_id: 'ann', uses_the_app: true, is_this_device: true, owns: 1, pays_for: 1 }),
      expect.objectContaining({ member_id: 'ben', uses_the_app: true, is_this_device: false, owns: 0 }),
      expect.objectContaining({ member_id: 'kid', name: 'Kit', uses_the_app: false, owns: 1 }),
    ])
    expect(d.household_owns).toBe(1)
  })
})

// What the first assistant to use these tools ran into: a desktop leased on
// 2026-09-22 and entered on 2026-11-13, with a protection plan billed monthly
// and the lease itself as a plan.
function studio(over: { care?: Record<string, unknown> } = {}): Household {
  const h = household()
  const entered = '2026-11-13T18:00:00.000Z'
  h.things.push(thingRow({ id: 't-studio', name: 'Mac Studio', category: 'desktop', purchaseDate: '2026-09-22', ownerMemberId: 'ann', createdAt: entered }))
  h.subscriptions.push(
    planRow({ id: 'p-care', name: 'AppleCare+', amount: 6.49, anchorDate: '2026-11-22', coversThingIds: ['t-studio'], payerMemberId: 'ann', createdAt: entered, ...over.care }),
    planRow({ id: 'p-lease', name: 'Apple Lease', provider: 'Klarna', amount: 75.17, anchorDate: '2026-11-19', startDate: '2026-09-22', endDate: '2029-09-22', coversThingIds: ['t-studio'], createdAt: entered }),
  )
  return h
}
const askOf = (h: Household, method: string, params: Row = {}) => handleRead(readOf(h), method, params)

describe('the household is named', () => {
  it('as the payer and the owner, with the id left null', () => {
    const plans = items(ask('list_plans'))
    expect(plans.find((p) => p.plan_id === 'p-stream')).toMatchObject({ payer: 'household', payer_member_id: null, payer_name: 'Household' })
    expect(plans.find((p) => p.plan_id === 'p-cloud')).toMatchObject({ payer: 'member', payer_member_id: 'ann', payer_name: 'Ann' })
    const tv = items(ask('list_things')).find((t) => t.thing_id === 't-tv')
    expect(tv).toMatchObject({ owner: 'household', owner_member_id: null, owner_name: 'Household' })
  })
  it('in a thing\'s history, and counted beside the members', () => {
    const h = household()
    h.things = h.things.map((t) => (t.id === 't-laptop' ? { ...t, ownershipHistory: [{ memberId: null, from: '2024-11-20', to: '2025-03-01' }] } : t))
    const thing = data(askOf(h, 'get_thing', { thing_id: 't-laptop' })).thing as Row
    expect(thing.ownership_history).toEqual([{ owner: 'household', member_id: null, member_name: 'Household', from: '2024-11-20', to: '2025-03-01' }])
    expect(thing).toMatchObject({ owner_name: 'Ann', owned_since: '2025-03-01' })
    // Two plans nobody in particular pays for: the stream and the trial.
    expect(data(ask('list_members'))).toMatchObject({ household_owns: 1, household_pays_for: 2 })
  })
  it('and who deals with a date stays empty when it falls to nobody', () => {
    const tv = items(ask('list_upcoming', { to: '2029-11-16', thing_id: 't-tv' }))[0]
    expect(tv).toMatchObject({ handler_member_id: null, handler_name: null })
  })
})

describe('a plan\'s payments, behind and ahead', () => {
  it('lists no renewal from before today among a thing\'s dates', () => {
    const d = data(askOf(studio(), 'get_thing', { thing_id: 't-studio' }))
    const dates = d.dates as Row[]
    expect(dates.length).toBeGreaterThan(0)
    expect(dates.every((e) => (e.days_away as number) >= 0 || e.needs_decision === true)).toBe(true)
    expect(dates.filter((e) => e.type === 'renewal').every((e) => (e.date as string) >= TODAY)).toBe(true)
    expect(dates.some((e) => e.past === true && e.type === 'renewal')).toBe(false)
  })
  it('counts from the day the plan was entered until it has a start date', () => {
    const care = (data(askOf(studio(), 'get_thing', { thing_id: 't-studio' })).plans as Row[]).find((p) => p.plan_id === 'p-care')!
    const day = dayOf('2026-11-13T18:00:00.000Z')
    expect(care).toMatchObject({ start_date: null, start_date_status: 'not_set', paid_to_date: { basis: 'entry_date', since: day, payments: 0, total: 0, last_payment: null }, left_on_term: null })
    expect('start_date_recorded' in care).toBe(false)
    expect(items(askOf(studio(), 'list_upcoming', { from: '2025-10-01', to: TODAY, plan_id: 'p-care', include_routine: true }))).toEqual([])
  })
  it('lists what was paid from the start date on, marked as past, and adds it up', () => {
    const h = studio({ care: { startDate: '2026-09-22' } })
    const behind = items(askOf(h, 'list_upcoming', { from: '2025-10-01', to: TODAY, plan_id: 'p-care', include_routine: true }))
    expect(behind.map((e) => [e.date, e.past])).toEqual([['2026-09-22', true], ['2026-10-22', true]])
    const ahead = items(askOf(h, 'list_upcoming', { plan_id: 'p-care', include_routine: true }))
    expect(ahead.map((e) => e.date)).toEqual(['2026-11-22', '2026-12-22', '2027-01-22'])
    expect(ahead.some((e) => 'past' in e)).toBe(false)
    const care = items(askOf(h, 'list_plans', { thing_id: 't-studio' })).find((p) => p.plan_id === 'p-care')!
    expect(care).toMatchObject({ start_date: '2026-09-22', start_date_status: 'recorded', paid_to_date: { basis: 'start_date', since: '2026-09-22', payments: 2, total: 12.98, last_payment: '2026-10-22' } })
  })
  it('says when a start is unknown on purpose, wherever a plan appears', () => {
    const h = studio({ care: { startUnknown: true } })
    const day = dayOf('2026-11-13T18:00:00.000Z')
    const unknown = { start_date: null, start_date_status: 'unknown', paid_to_date: { basis: 'entry_date', since: day, payments: 0 } }
    expect(items(askOf(h, 'list_plans')).find((p) => p.plan_id === 'p-care')).toMatchObject(unknown)
    expect((data(askOf(h, 'get_thing', { thing_id: 't-studio' })).plans as Row[]).find((p) => p.plan_id === 'p-care')).toMatchObject(unknown)
    // The lease beside it has its date, and the plans nobody answered for say so.
    const statuses = Object.fromEntries(items(askOf(h, 'list_plans')).map((p) => [p.plan_id, p.start_date_status]))
    expect(statuses).toMatchObject({ 'p-lease': 'recorded', 'p-care': 'unknown', 'p-stream': 'not_set' })
  })
  it('pays a lease each month until its term ends, then marks the end', () => {
    const h = studio()
    const lease = items(askOf(h, 'list_plans', { query: 'lease' }))[0]
    expect(lease).toMatchObject({
      monthly_cost: 75.17, yearly_cost: 902.04, next_renewal: '2026-11-19', end_date: '2029-09-22',
      paid_to_date: { payments: 1, total: 75.17, last_payment: '2026-10-19' },
      left_on_term: { ends: '2029-09-22', payments: 35, total: 2630.95 },
    })
    const end = items(askOf(h, 'list_upcoming', { from: '2029-08-01', to: '2030-06-30', plan_id: 'p-lease', include_routine: true }))
    expect(end.map((e) => [e.type, e.date])).toEqual([['renewal', '2029-08-19'], ['renewal', '2029-09-19'], ['sub-end', '2029-09-22']])
  })
})

describe('the totals of a list of plans', () => {
  it('follow the filters, with every plan\'s total beside them', () => {
    const d = data(askOf(studio(), 'list_plans', { thing_id: 't-studio' }))
    expect(names(d.items as Row[])).toEqual(['Apple Lease', 'AppleCare+'])
    expect(d.totals).toEqual({ monthly: 81.66, yearly: 979.92, currency: 'USD' })
    const all = Math.round((81.66 + 15.99 + 119 / 12) * 100) / 100
    expect((d.all_plans_totals as Row).monthly).toBe(all)
    // With no filter the two are the same figure.
    const whole = data(askOf(studio(), 'list_plans'))
    expect(whole.totals).toEqual(whole.all_plans_totals)
    expect((data(askOf(studio(), 'list_plans', { status: 'cancelled' })).totals as Row).monthly).toBe(0)
  })
})
