// What an assistant is shown (docs/mcp.md): the page's answers to the MCP
// server's read requests. Pure: everything it needs arrives in `ReadData`
// (mcp/readData.ts reads it from the database), so the same inputs give the
// same answer in a test.
//
// Privacy is not this file's to decide. `data` has already been through
// visibleTo(): an assistant acts as this device's member and can see no more
// than the screen shows them. Another member's private things and plans are
// simply not here.
//
// The shapes are the tools' wire format (snake_case, plain JSON, local dates
// as YYYY-MM-DD). Changing a field name changes what docs/mcp.md promises.

import { categoryLabel } from '@/core/categories'
import { addDays, isDay } from '@/core/dates'
import { lifecycle, verdictLabel, type Verdict } from '@/core/health'
import { attentionQueue, buildHorizon, eventKindLabel } from '@/core/horizon'
import { handlerOfEvent, holderOf, ownedSince, usedBy } from '@/core/household'
import { leftOnTerm, monthlyCost, nextRenewal, paidToDate, startStatus, yearlyCost } from '@/core/money'
import { tr } from '@/core/text'
import type { GlanceSnapshot } from '@/core/snapshot'
import type { DataSet, Day, EventType, HorizonEvent, Member, Subscription, Thing } from '@/core/types'
import dayjs from 'dayjs'

export interface ReadData {
  // Everything, for the one question that has to read the same on every
  // device: who deals with a date. Nothing else is taken from it.
  all: DataSet
  // What this device's member may see.
  data: DataSet
  members: Member[]
  meId: string | null
  // Members who use the app (core/household: userIds).
  users: Set<string>
  snapshot: GlanceSnapshot
  today: Day
}

export type McpAnswer =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: { code: 'validation' | 'not_found' | 'internal' | 'unknown_method'; message: string } }

const fail = (code: 'validation' | 'not_found', message: string): McpAnswer => ({ ok: false, error: { code, message } })
const ok = (data: Record<string, unknown>): McpAnswer => ({ ok: true, data })

export const EVENT_TYPES: readonly EventType[] = ['coverage-end', 'support-end', 'replace', 'renewal', 'trial-end', 'sub-end']
export const VERDICTS: readonly Verdict[] = ['prime', 'solid', 'watch', 'replace', 'overdue', 'retired', 'unknown']
// The furthest ahead thingglance_list_upcoming reads at once.
export const MAX_UPCOMING_DAYS = 366 * 3
export const QUEUE_LIMIT = 50

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const matches = (query: unknown, ...hay: (string | undefined)[]): boolean => {
  if (typeof query !== 'string' || !query.trim()) return true
  const text = fold(hay.filter(Boolean).join(' '))
  return fold(query).split(/\s+/).filter(Boolean).every((w) => text.includes(w))
}

export function memberName(d: Pick<ReadData, 'members'>, id: string | null): string | null {
  return id === null ? null : d.members.find((m) => m.id === id)?.name ?? null
}

// Who owns a thing or pays for a plan. A null id there is not "nobody": it is
// the household, and an answer has to say so, as the app does.
const holderName = (d: Pick<ReadData, 'members'>, id: string | null): string | null => (id === null ? tr('common.household') : memberName(d, id))
const holder = holderOf

function event(d: ReadData, e: HorizonEvent): Record<string, unknown> {
  const thingById = new Map<string, Thing>(d.all.things.map((t) => [t.id, t]))
  const subById = new Map<string, Subscription>(d.data.subscriptions.map((s) => [s.id, s]))
  const handler = handlerOfEvent(e, thingById, subById, d.users)
  return {
    event_key: e.key,
    type: e.type,
    type_label: eventKindLabel(e.type),
    date: e.date,
    days_away: e.days,
    // Already happened. Only a range that starts before today has these.
    ...(e.days < 0 ? { past: true } : {}),
    severity: e.severity,
    title: e.title,
    detail: e.detail,
    ...(e.thingId ? { thing_id: e.thingId } : {}),
    ...(e.subscriptionId ? { plan_id: e.subscriptionId } : {}),
    ...(e.amount != null ? { amount: e.amount } : {}),
    needs_decision: e.attention,
    state: e.decision?.state ?? 'open',
    handler_member_id: handler,
    handler_name: memberName(d, handler),
  }
}

function thingSummary(d: ReadData, t: Thing): Record<string, unknown> {
  const life = lifecycle(t, d.data.coverages, d.today)
  return {
    thing_id: t.id,
    name: t.name,
    category: t.category,
    category_label: categoryLabel(t.category),
    ...(t.brand ? { brand: t.brand } : {}),
    ...(t.model ? { model: t.model } : {}),
    status: t.status,
    verdict: life.verdict,
    verdict_label: verdictLabel(life.verdict),
    purchase_date: t.purchaseDate ?? null,
    price: t.price ?? null,
    coverage_end: life.warrantyEnd,
    under_coverage: life.covered,
    support_end: life.supportEnd,
    replace_by: life.replaceBy,
    life_end: life.lifeEnd,
    life_end_reason: life.lifeEndReason,
    days_left: life.daysLeft,
    owner: holder(t.ownerMemberId),
    owner_member_id: t.ownerMemberId,
    owner_name: holderName(d, t.ownerMemberId),
    owned_since: ownedSince(t),
    // Who deals with it: one member, or the household (everyone is asked).
    responsible: holder(t.responsibleMemberId),
    responsible_member_id: t.responsibleMemberId,
    responsible_name: holderName(d, t.responsibleMemberId),
    visibility: t.visibility,
    pinned: t.pinned === true,
  }
}

export function thingDetail(d: ReadData, t: Thing): Record<string, unknown> {
  return {
    ...thingSummary(d, t),
    retailer: t.retailer ?? null,
    release_date: t.releaseDate ?? null,
    support_basis: t.supportBasis ?? null,
    lifespan_months: t.lifespanMonths ?? null,
    retired_on: t.retiredAt ?? null,
    resale_value: t.resaleValue ?? null,
    notes: t.notes ?? null,
    summary: t.summary ?? null,
    source_url: t.sourceUrl ?? null,
    specs: t.specs ?? [],
    // Earlier owners, oldest first. The current one is owner_*, since owned_since.
    ownership_history: (t.ownershipHistory ?? []).map((s) => ({ owner: holder(s.memberId), member_id: s.memberId, member_name: holderName(d, s.memberId), from: s.from ?? null, to: s.to })),
  }
}

export function planSummary(d: ReadData, s: Subscription): Record<string, unknown> {
  const paid = paidToDate(s, d.today)
  const left = leftOnTerm(s, d.today)
  return {
    plan_id: s.id,
    name: s.name,
    provider: s.provider ?? null,
    amount: s.amount,
    cycle: s.cycle,
    status: s.status,
    auto_renew: s.autoRenew,
    review_before_renewal: s.review,
    next_renewal: s.status === 'cancelled' || !s.autoRenew ? null : nextRenewal(s, d.today),
    anchor_date: s.anchorDate,
    // The day it began, when that is on record. "unknown" (it began before
    // it was tracked) and "not_set" (nobody has said) have no date.
    start_date: s.startDate ?? null,
    start_date_status: startStatus(s),
    trial_end: s.trialEnd ?? null,
    end_date: s.endDate ?? null,
    monthly_cost: cents(monthlyCost(s, d.today)),
    yearly_cost: cents(yearlyCost(s, d.today)),
    // History, kept apart from what is coming: the payments made up to
    // yesterday, at today's price. Counted from start_date, or with none on
    // record from the day the plan was entered: `basis` says which.
    paid_to_date: { basis: paid.basis, since: paid.since, payments: paid.payments, total: paid.total, last_payment: paid.last },
    // A fixed term (a lease, installments): what is still to pay before it ends.
    left_on_term: left ? { ends: left.ends, payments: left.payments, total: left.total } : null,
    thing_ids: s.coversThingIds,
    // Who uses it: the members named, the household as a whole, or (an empty
    // list and no household) nobody has said.
    used_by: usedBy(s),
    member_ids: s.coversMemberIds,
    member_names: usedBy(s) === 'household' ? [tr('common.household')] : s.coversMemberIds.map((id) => memberName(d, id)).filter((name): name is string => name !== null),
    payer: holder(s.payerMemberId),
    payer_member_id: s.payerMemberId,
    payer_name: holderName(d, s.payerMemberId),
    responsible: holder(s.responsibleMemberId),
    responsible_member_id: s.responsibleMemberId,
    responsible_name: holderName(d, s.responsibleMemberId),
    visibility: s.visibility,
    notes: s.notes ?? null,
  }
}

const cents = (n: number): number => Math.round(n * 100) / 100

// What a list of plans comes to a month and a year, as the plans stand today.
function planTotals(d: ReadData, plans: Subscription[]): Record<string, unknown> {
  const monthly = plans.reduce((t, s) => t + monthlyCost(s, d.today), 0)
  return { monthly: cents(monthly), yearly: cents(monthly * 12), currency: d.snapshot.currency }
}

const horizon = (d: ReadData, from?: Day, to?: Day): HorizonEvent[] =>
  buildHorizon(d.data, { ref: d.today, allThings: d.all.things, ...(from ? { from } : {}), ...(to ? { to } : {}) })

function overview(d: ReadData): McpAnswer {
  const events = horizon(d)
  const queue = attentionQueue(events)
  const s = d.snapshot
  return ok({
    currency: s.currency,
    counts: {
      things_in_service: s.counts.things,
      things_under_coverage: s.counts.covered,
      plans: s.counts.subscriptions,
      needs_decision: queue.length,
      urgent: s.counts.urgent,
    },
    plan_cost: { monthly: Math.round(s.burn.monthly * 100) / 100, yearly: Math.round(s.burn.yearly * 100) / 100 },
    replacement_fund_monthly: Math.round(s.burn.replacementMonthly * 100) / 100,
    charges_next_30_days: { total: Math.round(s.charges.total * 100) / 100, count: s.charges.count },
    needs_decision: queue.slice(0, QUEUE_LIMIT).map((e) => event(d, e)),
    needs_decision_truncated: queue.length > QUEUE_LIMIT,
    coming_up: events.filter((e) => e.days >= 0 && !e.quiet && !e.repeat && !e.attention).slice(0, 10).map((e) => event(d, e)),
    me: d.meId ? { member_id: d.meId, name: memberName(d, d.meId) } : null,
  })
}

function listThings(d: ReadData, p: Record<string, unknown>): McpAnswer {
  const status = p.status ?? 'active'
  if (!['active', 'retired', 'all'].includes(status as string)) return fail('validation', 'status must be active, retired or all.')
  if (p.verdict !== undefined && !VERDICTS.includes(p.verdict as Verdict)) return fail('validation', `verdict must be one of ${VERDICTS.join(', ')}.`)
  let owner: string | null | undefined
  if (p.owner !== undefined) {
    if (p.owner === 'household') owner = null
    else if (p.owner === 'me') {
      if (!d.meId) return fail('validation', 'owner "me" needs this device to belong to a household member, and it does not yet.')
      owner = d.meId
    } else if (typeof p.owner === 'string' && d.members.some((m) => m.id === p.owner)) owner = p.owner
    else return fail('not_found', 'owner: no household member with that id. Use thingglance_list_members.')
  }
  const items = d.data.things
    .filter((t) => status === 'all' || t.status === status)
    .filter((t) => p.category === undefined || t.category === p.category)
    .filter((t) => owner === undefined || t.ownerMemberId === owner)
    .filter((t) => matches(p.query, t.name, t.brand, t.model, categoryLabel(t.category)))
    .map((t) => thingSummary(d, t))
    .filter((t) => p.verdict === undefined || t.verdict === p.verdict)
    // What runs out soonest first; things with no dates last, then by name.
    .sort((a, b) => ((a.days_left as number | null) ?? Infinity) - ((b.days_left as number | null) ?? Infinity) || String(a.name).localeCompare(String(b.name)))
  return ok({ items })
}

function getThing(d: ReadData, p: Record<string, unknown>): McpAnswer {
  const t = typeof p.thing_id === 'string' ? d.data.things.find((x) => x.id === p.thing_id) : undefined
  if (!t) return fail('not_found', 'No thing with that id. Use thingglance_list_things.')
  return ok({
    thing: thingDetail(d, t),
    coverage: d.data.coverages.filter((c) => c.thingId === t.id).sort((a, b) => a.endDate.localeCompare(b.endDate)).map((c) => ({
      coverage_id: c.id, type: c.type, name: c.name, provider: c.provider ?? null, start_date: c.startDate ?? null, end_date: c.endDate, cost: c.cost ?? null, notes: c.notes ?? null,
      active: c.endDate >= d.today,
    })),
    plans: d.data.subscriptions.filter((s) => s.coversThingIds.includes(t.id)).map((s) => planSummary(d, s)),
    // What the app's own page for a thing lists: what is ahead, and anything
    // behind that still waits for a decision. A plan's payments already made
    // are on the plan (paid_to_date), never here.
    dates: horizon(d).filter((e) => e.thingId === t.id && !e.repeat && (e.days >= 0 || e.attention)).map((e) => event(d, e)),
  })
}

function listPlans(d: ReadData, p: Record<string, unknown>): McpAnswer {
  const status = p.status ?? 'current'
  if (!['current', 'active', 'trial', 'cancelled', 'all'].includes(status as string)) return fail('validation', 'status must be current, active, trial, cancelled or all.')
  // Like the owner filter on things: a member means the plans that name them,
  // and "household" the plans said to be the household's as a whole.
  let user: string | null | undefined
  if (p.used_by !== undefined) {
    if (p.used_by === 'household') user = null
    else if (p.used_by === 'me') {
      if (!d.meId) return fail('validation', 'used_by "me" needs this device to belong to a household member, and it does not yet.')
      user = d.meId
    } else if (typeof p.used_by === 'string' && d.members.some((m) => m.id === p.used_by)) user = p.used_by
    else return fail('not_found', 'used_by: no household member with that id. Use thingglance_list_members.')
  }
  const listed = d.data.subscriptions
    .filter((s) => status === 'all' || (status === 'current' ? s.status !== 'cancelled' : s.status === status))
    .filter((s) => user === undefined || (user === null ? usedBy(s) === 'household' : s.coversMemberIds.includes(user)))
    .filter((s) => p.thing_id === undefined || s.coversThingIds.includes(p.thing_id as string))
    .filter((s) => matches(p.query, s.name, s.provider))
  const items = listed
    .map((s) => planSummary(d, s))
    .sort((a, b) => (b.yearly_cost as number) - (a.yearly_cost as number) || String(a.name).localeCompare(String(b.name)))
  // `totals` is for the plans listed, whatever the filters were. What every
  // plan comes to is its own figure.
  return ok({ items, totals: planTotals(d, listed), all_plans_totals: planTotals(d, d.data.subscriptions) })
}

function listUpcoming(d: ReadData, p: Record<string, unknown>): McpAnswer {
  const from = p.from ?? d.today
  const to = p.to ?? addDays(d.today, 90)
  if (!isDay(from) || !isDay(to)) return fail('validation', 'from and to must be local dates, YYYY-MM-DD.')
  if (from > to) return fail('validation', 'from must be on or before to.')
  if (dayjs(to).diff(dayjs(from), 'day') > MAX_UPCOMING_DAYS) return fail('validation', `At most ${MAX_UPCOMING_DAYS} days at once.`)
  const types = p.types
  if (types !== undefined && (!Array.isArray(types) || types.some((t) => !EVENT_TYPES.includes(t as EventType)))) {
    return fail('validation', `types must be a list from: ${EVENT_TYPES.join(', ')}.`)
  }
  const wanted = types ? new Set(types as EventType[]) : null
  const items = horizon(d, from, to)
    .filter((e) => !e.quiet || p.include_routine === true)
    .filter((e) => !wanted || wanted.has(e.type))
    .filter((e) => p.thing_id === undefined || e.thingId === p.thing_id)
    .filter((e) => p.plan_id === undefined || e.subscriptionId === p.plan_id)
    .map((e) => event(d, e))
  return ok({ from, to, items })
}

function listQueue(d: ReadData): McpAnswer {
  return ok({ items: attentionQueue(horizon(d)).map((e) => event(d, e)) })
}

function listMembers(d: ReadData): McpAnswer {
  return ok({
    items: d.members.map((m) => ({
      member_id: m.id, name: m.name, uses_the_app: d.users.has(m.id), is_this_device: m.id === d.meId,
      owns: d.data.things.filter((t) => t.status === 'active' && t.ownerMemberId === m.id).length,
      pays_for: d.data.subscriptions.filter((s) => s.status !== 'cancelled' && s.payerMemberId === m.id).length,
      uses: d.data.subscriptions.filter((s) => s.status !== 'cancelled' && s.coversMemberIds.includes(m.id)).length,
    })),
    this_device_member_id: d.meId,
    // What belongs to no one member: an owner or a payer of null is the household.
    household_owns: d.data.things.filter((t) => t.status === 'active' && t.ownerMemberId === null).length,
    household_pays_for: d.data.subscriptions.filter((s) => s.status !== 'cancelled' && s.payerMemberId === null).length,
    household_uses: d.data.subscriptions.filter((s) => s.status !== 'cancelled' && usedBy(s) === 'household').length,
  })
}

// Null for a method this model does not answer (the write model may).
export function handleRead(d: ReadData, method: string, params: Record<string, unknown> = {}): McpAnswer | null {
  switch (method) {
    case 'ping': return ok({ ok: true })
    case 'overview': return overview(d)
    case 'list_things': return listThings(d, params)
    case 'get_thing': return getThing(d, params)
    case 'list_plans': return listPlans(d, params)
    case 'list_upcoming': return listUpcoming(d, params)
    case 'list_queue': return listQueue(d)
    case 'list_members': return listMembers(d)
    default: return null
  }
}
