// The horizon: every dated thing that is coming, as one sorted list of events.
// Warranties running out, support windows closing, plans renewing, trials
// converting, and the day you said you would replace something.

import type { DataSet, Day, Decision, EventType, HorizonEvent, Severity, Thing } from './types'
import { addDays, daysBetween, today } from './dates'
import { lifecycle } from './health'
import { concernsPlan, concernsThing } from './household'
import { cycleShort, renewalsBetween } from './money'
import { tr } from './text'

// How far ahead each kind of event starts asking for attention, in days.
export const LEAD_DAYS: Record<EventType, number> = {
  'coverage-end': 45,
  'support-end': 183,
  replace: 120,
  renewal: 30,
  'trial-end': 10,
  'sub-end': 21,
}

// Monthly and weekly renewals are noise unless you asked to review them.
const REVIEW_LEAD_SHORT_CYCLE = 7

// A lapsed event stays in the queue this long before it quietly drops off.
// Support and replacement never drop: an out-of-support device is the point.
const PAST_GRACE: Record<EventType, number> = {
  'coverage-end': 21,
  'support-end': Infinity,
  replace: Infinity,
  renewal: 0,
  'trial-end': 3,
  'sub-end': 7,
}

export const EVENT_META: Record<EventType, { tone: 'ok' | 'accent' | 'warn' | 'sub' | 'bad' }> = {
  'coverage-end': { tone: 'ok' },
  'support-end': { tone: 'accent' },
  replace: { tone: 'warn' },
  renewal: { tone: 'sub' },
  'trial-end': { tone: 'bad' },
  'sub-end': { tone: 'sub' },
}

// The one-word name of a kind of date ("Coverage", "Renewal"). A function,
// not a field: the words follow the language in use when they are asked for.
export const eventKindLabel = (type: EventType): string => tr(`event.kind.${type}`)

export const eventKey = (type: EventType, entityId: string, date: Day): string => `${type}:${entityId}:${date}`

function severity(days: number, lead: number): Severity {
  if (days < 0) return 'past'
  if (days <= 14) return 'urgent'
  if (days <= lead) return 'soon'
  return 'later'
}

function latestDecisions(decisions: Decision[]): Map<string, Decision> {
  const m = new Map<string, Decision>()
  for (const d of decisions) {
    const cur = m.get(d.eventKey)
    if (!cur || d.updatedAt > cur.updatedAt) m.set(d.eventKey, d)
  }
  return m
}

export interface HorizonOptions {
  from?: Day
  to?: Day
  ref?: Day
  // Only what concerns one household member (see core/household.ts). This is
  // a filter, not privacy: pass data through visibleTo() first for that.
  memberId?: string | null
  // Every thing in the household, including ones this viewer may not see.
  // Used for one question only: is anything a plan is attached to still in
  // service? Without it a plan on someone's private (and since retired)
  // phone would keep asking on every other device. Nothing from these rows
  // is ever put into an event.
  allThings?: Thing[]
}

export function buildHorizon(data: DataSet, opts: HorizonOptions = {}): HorizonEvent[] {
  const ref = opts.ref ?? today()
  const from = opts.from ?? addDays(ref, -400)
  const to = opts.to ?? addDays(ref, 365 * 6)
  const decided = latestDecisions(data.decisions)
  const thingsById = new Map(data.things.map((t) => [t.id, t]))
  const everyThing = opts.allThings ? new Map(opts.allThings.map((t) => [t.id, t])) : thingsById
  const out: HorizonEvent[] = []

  const push = (e: Omit<HorizonEvent, 'key' | 'days' | 'severity' | 'lead' | 'attention' | 'decision'> & { entityId: string; lead?: number }) => {
    if (e.date > to) return
    // The look-back only trims history. A device that fell out of support two
    // years ago is still out of support: those never age out of the list.
    const sticky = (e.type === 'support-end' || e.type === 'replace') && !opts.from
    if (e.date < from && !sticky) return
    const { entityId, lead: leadOverride, ...rest } = e
    const key = eventKey(e.type, entityId, e.date)
    const days = daysBetween(ref, e.date)
    const lead = leadOverride ?? LEAD_DAYS[e.type]
    const decision = decided.get(key)
    const inWindow = days <= lead && days >= -PAST_GRACE[e.type]
    const settled = decision?.state === 'dismissed' || decision?.state === 'done'
    out.push({ ...rest, key, days, lead, severity: lead < 0 ? 'later' : severity(days, lead), attention: inWindow && !settled, decision })
  }

  for (const t of data.things) {
    if (t.status !== 'active' || (opts.memberId && !concernsThing(t, opts.memberId))) continue
    const mine = data.coverages.filter((c) => c.thingId === t.id)
    const life = lifecycle(t, mine, ref)

    for (const c of mine) {
      push({ type: 'coverage-end', entityId: c.id, date: c.endDate, thingId: t.id, coverageId: c.id, name: c.name, title: tr('event.title.coverageEnds', { name: c.name }), detail: t.name })
    }
    if (life.supportEnd) {
      push({
        type: 'support-end', entityId: t.id, date: life.supportEnd, thingId: t.id,
        title: t.supportBasis === 'estimate' ? tr('event.title.updatesLikelyEnd') : tr('event.title.securityUpdatesEnd'),
        detail: t.name,
      })
    }
    // The plan only earns its own marker when it is what closes the window;
    // if support ends first, that event already says "replace".
    if (life.replaceBy && life.lifeEndReason === 'plan') {
      push({ type: 'replace', entityId: t.id, date: life.replaceBy, thingId: t.id, title: tr('event.title.plannedReplacement'), detail: t.name, amount: t.price })
    }
  }

  for (const s of data.subscriptions) {
    // A plan follows the things it is attached to: once every one of them is
    // retired it stops asking. The first active one is where a tap leads.
    const attached = s.coversThingIds.map((id) => everyThing.get(id)).filter((t): t is Thing => !!t)
    if (attached.length > 0 && !attached.some((t) => t.status === 'active')) continue
    // Only what this viewer can see is named or linked to.
    const live = s.coversThingIds.map((id) => thingsById.get(id)).filter((t): t is Thing => !!t && t.status === 'active')
    if (opts.memberId && !concernsPlan(s, opts.memberId, thingsById)) continue
    const thing = live[0]
    const where = thing ? (live.length > 1 ? tr('event.detail.andMore', { name: thing.name, count: live.length - 1 }) : thing.name) : s.provider ?? tr('event.detail.subscription')
    const base = { thingId: thing?.id, subscriptionId: s.id, name: s.name }

    if (s.status === 'cancelled') {
      if (s.endDate) push({ ...base, type: 'sub-end', entityId: s.id, date: s.endDate, title: tr('event.title.accessEnds', { name: s.name }), detail: where })
      continue
    }
    if (s.status === 'trial' && s.trialEnd) {
      push({ ...base, type: 'trial-end', entityId: s.id, date: s.trialEnd, title: tr('event.title.trialConverts', { name: s.name }), detail: tr('event.detail.thenPrice', { where, amount: s.amount, cycle: cycleShort(s.cycle) }), amount: s.amount })
    }
    if (!s.autoRenew) {
      const end = s.endDate ?? renewalsBetween(s, ref, to)[0]
      if (end) push({ ...base, type: 'sub-end', entityId: s.id, date: end, title: tr('event.title.expires', { name: s.name }), detail: where })
      continue
    }
    const long = s.cycle === 'yearly' || s.cycle === 'quarterly'
    const lead = long ? LEAD_DAYS.renewal : s.review ? REVIEW_LEAD_SHORT_CYCLE : -1
    const start = s.status === 'trial' && s.trialEnd && s.trialEnd > from ? s.trialEnd : from
    let ahead = 0
    for (const d of renewalsBetween(s, start, to)) {
      // A trial's conversion day is already its own event.
      if (s.status === 'trial' && d === s.trialEnd) continue
      const repeat = !long && d >= ref && ahead++ > 0
      push({ ...base, type: 'renewal', entityId: s.id, date: d, title: tr('event.title.renews', { name: s.name }), detail: where, amount: s.amount, lead, quiet: lead < 0, repeat })
    }
  }

  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)))
  return out
}

// The queue: what needs a decision, most pressing first. Renewals only count
// once (the next one), so a monthly plan under review is a single row.
export function attentionQueue(events: HorizonEvent[]): HorizonEvent[] {
  const seenRenewal = new Set<string>()
  const q: HorizonEvent[] = []
  for (const e of events) {
    if (!e.attention) continue
    if (e.type === 'renewal') {
      if (e.days < 0 || seenRenewal.has(e.subscriptionId!)) continue
      seenRenewal.add(e.subscriptionId!)
    }
    q.push(e)
  }
  const rank = (e: HorizonEvent) => (e.type === 'support-end' || e.type === 'replace') && e.days < 0 ? 0.5 : e.days < 0 ? 1 : 2
  return q.sort((a, b) => rank(a) - rank(b) || Math.abs(a.days) - Math.abs(b.days))
}

// The very next thing coming for one entity, for cards and rows.
export function nextEventFor(events: HorizonEvent[], match: { thingId?: string; subscriptionId?: string }): HorizonEvent | null {
  for (const e of events) {
    if (e.days < 0 || e.quiet) continue
    if (match.subscriptionId && e.subscriptionId === match.subscriptionId) return e
    if (match.thingId && e.thingId === match.thingId) return e
  }
  return null
}
