import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import type { Coverage, DataSet, Decision, Subscription, Thing } from './types'
import { eventKey } from './horizon'
import { DEFAULT_REMINDER_PREFS, capReminders, diffReminders, normalizeReminderPrefs, planReminders, reminderNumericId, reminderSignature, tellsDevice, type Reminder, type ReminderPrefs } from './reminders'

const stamp = '2026-01-01T00:00:00.000Z'
// Local wall-clock times, so the tests read the same in any time zone.
const at = (local: string) => dayjs(local).valueOf()
const NOW = at('2026-11-12T08:00')

const thing = (p: Partial<Thing>): Thing => ({ id: 't1', kind: 'thing', name: 'Laptop', category: 'laptop', status: 'active', ownerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p })
const cov = (p: Partial<Coverage>): Coverage => ({ id: 'c1', kind: 'coverage', thingId: 't1', type: 'warranty', name: 'Warranty', endDate: '2027-01-15', createdAt: stamp, updatedAt: stamp, ...p })
const sub = (p: Partial<Subscription>): Subscription => ({ id: 's1', kind: 'subscription', name: 'Plan', amount: 120, cycle: 'yearly', anchorDate: '2027-02-01', autoRenew: true, status: 'active', review: false, coversThingIds: [], coversMemberIds: [], payerMemberId: null, responsibleMemberId: null, visibility: 'shared', createdAt: stamp, updatedAt: stamp, ...p })
const data = (p: Partial<DataSet>): DataSet => ({ things: [], coverages: [], subscriptions: [], decisions: [], ...p })
const decision = (key: string, state: Decision['state']): Decision => ({ id: key, kind: 'decision', eventKey: key, state, createdAt: stamp, updatedAt: stamp } as Decision)

const solo = { meId: null, users: new Set<string>(), now: NOW }
const when = (r: Reminder) => dayjs(r.at).format('YYYY-MM-DD HH:mm')
const warranty = data({ things: [thing({})], coverages: [cov({})] })

describe('when a reminder fires', () => {
  it('nudges twice: as the date enters its window, and a last call before it', () => {
    const plan = planReminders(warranty, solo)
    expect(plan.map((r) => [r.stage, when(r), r.daysBefore])).toEqual([
      ['heads-up', '2026-12-01 09:00', 45],
      ['last-call', '2027-01-08 09:00', 7],
    ])
    expect(plan[0]).toMatchObject({ type: 'coverage-end', eventDate: '2027-01-15', day: '2026-12-01', thingId: 't1', title: 'Warranty ends' })
    expect(plan[0].body).toBe('Laptop · in 6 weeks, Jan 15')
  })
  it('skips a nudge whose moment has passed instead of catching up', () => {
    const soon = data({ things: [thing({})], coverages: [cov({ endDate: '2026-11-24' })] })
    expect(planReminders(soon, solo).map((r) => [r.stage, when(r)])).toEqual([['last-call', '2026-11-17 09:00']])
  })
  it('still fires today if the hour has not come yet, and not once it has', () => {
    const due = data({ things: [thing({})], coverages: [cov({ endDate: '2026-11-19' })] })
    expect(planReminders(due, solo)).toHaveLength(1)
    expect(planReminders(due, { ...solo, now: at('2026-11-12T09:00') })).toHaveLength(0)
  })
  it('follows the hour the device prefers', () => {
    const plan = planReminders(warranty, { ...solo, prefs: { ...DEFAULT_REMINDER_PREFS, hour: 18, minute: 30 } })
    expect(when(plan[0])).toBe('2026-12-01 18:30')
  })
  it('gives each kind a last call sized to what acting on it takes', () => {
    const plan = planReminders(data({ subscriptions: [sub({})] }), solo)
    expect(plan.map((r) => [r.stage, r.day])).toEqual([['heads-up', '2027-01-02'], ['last-call', '2027-01-29']])
  })
})

describe('what is worth a reminder', () => {
  it('says nothing once a date is cleared or has been sent to dayGLANCE', () => {
    const key = eventKey('coverage-end', 'c1', '2027-01-15')
    for (const state of ['dismissed', 'done', 'sent'] as const) {
      expect(planReminders({ ...warranty, decisions: [decision(key, state)] }, solo)).toEqual([])
    }
  })
  it('leaves a routine monthly plan alone, and reminds for every month of one under review', () => {
    const monthly = sub({ cycle: 'monthly', anchorDate: '2026-11-20', amount: 10 })
    expect(planReminders(data({ subscriptions: [monthly] }), solo)).toEqual([])
    const reviewed = planReminders(data({ subscriptions: [{ ...monthly, review: true }] }), solo)
    // Not only the next one: a phone that is not opened for a month still has
    // to be told about the one after.
    expect(reviewed.slice(0, 4).map((r) => [r.stage, r.day, r.eventDate])).toEqual([
      ['heads-up', '2026-11-13', '2026-11-20'], ['last-call', '2026-11-17', '2026-11-20'],
      ['heads-up', '2026-12-13', '2026-12-20'], ['last-call', '2026-12-17', '2026-12-20'],
    ])
    expect(new Set(reviewed.map((r) => r.eventDate)).size).toBeGreaterThanOrEqual(12)
    expect(new Set(reviewed.map((r) => r.id)).size).toBe(reviewed.length)
  })
  it('nudges once a week, not twice, for a weekly plan under review', () => {
    const weekly = sub({ cycle: 'weekly', anchorDate: '2026-11-16', amount: 5, review: true })
    const plan = planReminders(data({ subscriptions: [weekly] }), { ...solo, horizonDays: 30 })
    expect(plan.every((r) => r.stage === 'last-call' && r.daysBefore === 3)).toBe(true)
    expect(plan.slice(0, 3).map((r) => [r.day, r.eventDate])).toEqual([['2026-11-13', '2026-11-16'], ['2026-11-20', '2026-11-23'], ['2026-11-27', '2026-11-30']])
  })
  it('reads preferences from anywhere without being thrown by them', () => {
    expect(normalizeReminderPrefs(undefined)).toEqual(DEFAULT_REMINDER_PREFS)
    expect(normalizeReminderPrefs({ hour: 24, minute: 60 })).toEqual(DEFAULT_REMINDER_PREFS)
    expect(normalizeReminderPrefs({ hour: NaN, minute: 7.5, enabled: false })).toEqual({ ...DEFAULT_REMINDER_PREFS, enabled: false })
    expect(normalizeReminderPrefs({ hour: 18, minute: 30, kinds: { renewal: false, replace: true, nonsense: false } })).toEqual({ enabled: true, hour: 18, minute: 30, kinds: { renewal: false } })
    // Out of range or partial, the plan still lands on the right day at 9:00.
    const odd = planReminders(warranty, { ...solo, prefs: { hour: 24 } as unknown as ReminderPrefs })
    expect(odd.map((r) => [r.day, when(r)])).toEqual([['2026-12-01', '2026-12-01 09:00'], ['2027-01-08', '2027-01-08 09:00']])
  })
  it('respects the switch and the per-kind switches', () => {
    expect(planReminders(warranty, { ...solo, prefs: { ...DEFAULT_REMINDER_PREFS, enabled: false } })).toEqual([])
    expect(planReminders(warranty, { ...solo, prefs: { ...DEFAULT_REMINDER_PREFS, kinds: { 'coverage-end': false } } })).toEqual([])
  })
  it('does not look past its planning window', () => {
    const far = data({ things: [thing({})], coverages: [cov({ endDate: '2029-01-15' })] })
    expect(planReminders(far, solo)).toEqual([])
  })
})

describe('whose device is told', () => {
  const users = new Set(['ann', 'ben'])
  const told = (d: DataSet, meId: string | null) => planReminders(d, { meId, users, now: NOW }).length > 0

  it('tells only whoever deals with it', () => {
    const anns = data({ things: [thing({ responsibleMemberId: 'ann' })], coverages: [cov({})] })
    expect(told(anns, 'ann')).toBe(true)
    expect(told(anns, 'ben')).toBe(false)
  })
  it('falls to the owner when nobody was picked', () => {
    const bens = data({ things: [thing({ ownerMemberId: 'ben' })], coverages: [cov({})] })
    expect(told(bens, 'ben')).toBe(true)
    expect(told(bens, 'ann')).toBe(false)
  })
  it('tells everyone about what falls to nobody, a device nobody claimed included', () => {
    expect(told(warranty, 'ann')).toBe(true)
    expect(told(warranty, 'ben')).toBe(true)
    expect(told(warranty, null)).toBe(true)
  })
  it('tells an unclaimed device nothing that is someone else\'s', () => {
    expect(told(data({ things: [thing({ responsibleMemberId: 'ann' })], coverages: [cov({})] }), null)).toBe(false)
  })
  it('keeps a private item to its owner\'s devices, whoever was picked before it went private', () => {
    const secret = data({ things: [thing({ ownerMemberId: 'ann', responsibleMemberId: 'ben', visibility: 'private' })], coverages: [cov({})] })
    expect(told(secret, 'ann')).toBe(true)
    expect(told(secret, 'ben')).toBe(false)
    expect(told(secret, null)).toBe(false)
  })
  it('states the rule directly', () => {
    expect(tellsDevice(null, 'ann')).toBe(true)
    expect(tellsDevice('ann', 'ann')).toBe(true)
    expect(tellsDevice('ann', 'ben')).toBe(false)
    expect(tellsDevice('ann', null)).toBe(false)
  })
})

describe('what a shell needs', () => {
  it('gives every reminder a stable id, so scheduling again replaces it', () => {
    const a = planReminders(warranty, solo)
    const b = planReminders(warranty, { ...solo, now: at('2026-11-13T12:00') })
    expect(a.map((r) => r.id)).toEqual(b.map((r) => r.id))
    expect(new Set(a.map((r) => r.id)).size).toBe(a.length)
    expect(a[0].id).toBe('coverage-end:c1:2027-01-15@heads-up')
  })
  it('maps ids to positive 32-bit ints for native notification ids', () => {
    const n = reminderNumericId('coverage-end:c1:2027-01-15@heads-up')
    expect(n).toBe(reminderNumericId('coverage-end:c1:2027-01-15@heads-up'))
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(0x7fffffff)
    expect(n).not.toBe(reminderNumericId('coverage-end:c1:2027-01-15@last-call'))
  })
  it('keeps the soonest when a platform has a ceiling', () => {
    const many = data({ things: [thing({})], coverages: [cov({}), cov({ id: 'c2', endDate: '2027-03-01' }), cov({ id: 'c3', endDate: '2027-06-01' })] })
    const plan = planReminders(many, solo)
    expect(plan.length).toBe(6)
    const kept = capReminders(plan, 3)
    expect(kept).toEqual(plan.slice(0, 3))
    expect(capReminders(plan, 10)).toBe(plan)
  })
})

describe('making the platform match the plan', () => {
  const plan = planReminders(warranty, solo)
  const held = (list: Reminder[]) => list.map((r) => ({ id: reminderNumericId(r.id), signature: reminderSignature(r) }))

  it('schedules everything on a device that has nothing pending', () => {
    expect(diffReminders(plan, [])).toEqual({ schedule: plan, cancel: [] })
  })
  it('does nothing when the platform already holds exactly the plan', () => {
    expect(diffReminders(plan, held(plan))).toEqual({ schedule: [], cancel: [] })
  })
  it('cancels what is no longer planned, and only that', () => {
    const stale = { id: 424242, signature: 'something that was cleared' }
    expect(diffReminders(plan, [...held(plan), stale])).toEqual({ schedule: [], cancel: [424242] })
    expect(diffReminders([], held(plan)).cancel).toEqual(held(plan).map((p) => p.id))
  })
  it('schedules again what changed: its time, its words, or one with no signature', () => {
    const later = planReminders(warranty, { ...solo, prefs: { ...DEFAULT_REMINDER_PREFS, hour: 18 } })
    expect(diffReminders(later, held(plan))).toEqual({ schedule: later, cancel: [] })
    const renamed = planReminders(data({ things: [thing({ name: 'Work laptop' })], coverages: [cov({})] }), solo)
    expect(diffReminders(renamed, held(plan)).schedule).toEqual(renamed)
    expect(diffReminders(plan, held(plan).map((p) => ({ id: p.id }))).schedule).toEqual(plan)
  })
})
