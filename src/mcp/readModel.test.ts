import { describe, expect, it } from 'vitest'
import { TODAY, household, readOf } from './fixture'
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
