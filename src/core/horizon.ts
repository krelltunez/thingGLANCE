// The horizon: every dated thing that is coming, as one sorted list of events.
// Warranties running out, support windows closing, plans renewing, trials
// converting, and the day you said you would replace something.

import type { DataSet, Day, Decision, EventType, HorizonEvent, Severity, Subscription, Thing } from './types'
import { addDays, daysBetween, today } from './dates'
import { lifecycle } from './health'
import { cycleShort, renewalsBetween } from './money'

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

export const EVENT_META: Record<EventType, { label: string; verb: string; tone: 'ok' | 'accent' | 'warn' | 'sub' | 'bad' }> = {
  'coverage-end': { label: 'Coverage', verb: 'ends', tone: 'ok' },
  'support-end': { label: 'Support', verb: 'ends', tone: 'accent' },
  replace: { label: 'Replace', verb: 'planned', tone: 'warn' },
  renewal: { label: 'Renewal', verb: 'renews', tone: 'sub' },
  'trial-end': { label: 'Trial', verb: 'converts', tone: 'bad' },
  'sub-end': { label: 'Ends', verb: 'ends', tone: 'sub' },
}

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
  // Only things / plans a given household member owns or pays for.
  userId?: string | null
}

const ownedBy = (t: Thing, userId?: string | null) => !userId || t.ownerIds.length === 0 || t.ownerIds.includes(userId)
const paidBy = (s: Subscription, userId?: string | null, thing?: Thing) =>
  !userId || s.payerId === userId || (!s.payerId && (!thing || ownedBy(thing, userId)))

export function buildHorizon(data: DataSet, opts: HorizonOptions = {}): HorizonEvent[] {
  const ref = opts.ref ?? today()
  const from = opts.from ?? addDays(ref, -400)
  const to = opts.to ?? addDays(ref, 365 * 6)
  const decided = latestDecisions(data.decisions)
  const thingsById = new Map(data.things.map((t) => [t.id, t]))
  const out: HorizonEvent[] = []

  const push = (e: Omit<HorizonEvent, 'key' | 'days' | 'severity' | 'attention' | 'decision'> & { entityId: string; lead?: number }) => {
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
    out.push({ ...rest, key, days, severity: lead < 0 ? 'later' : severity(days, lead), attention: inWindow && !settled, decision })
  }

  for (const t of data.things) {
    if (t.status !== 'active' || !ownedBy(t, opts.userId)) continue
    const mine = data.coverages.filter((c) => c.thingId === t.id)
    const life = lifecycle(t, mine, ref)

    for (const c of mine) {
      push({ type: 'coverage-end', entityId: c.id, date: c.endDate, thingId: t.id, coverageId: c.id, title: `${c.name} ends`, detail: t.name })
    }
    if (life.supportEnd) {
      push({
        type: 'support-end', entityId: t.id, date: life.supportEnd, thingId: t.id,
        title: t.supportBasis === 'estimate' ? 'Updates likely end' : 'Security updates end',
        detail: t.name,
      })
    }
    // The plan only earns its own marker when it is what closes the window;
    // if support ends first, that event already says "replace".
    if (life.replaceBy && life.lifeEndReason === 'plan') {
      push({ type: 'replace', entityId: t.id, date: life.replaceBy, thingId: t.id, title: 'Planned replacement', detail: t.name, amount: t.price })
    }
  }

  for (const s of data.subscriptions) {
    const thing = s.thingId ? thingsById.get(s.thingId) : undefined
    if (thing && thing.status !== 'active') continue
    if (!paidBy(s, opts.userId, thing)) continue
    const where = thing ? thing.name : s.provider ?? 'Subscription'
    const base = { thingId: thing?.id, subscriptionId: s.id }

    if (s.status === 'cancelled') {
      if (s.endDate) push({ ...base, type: 'sub-end', entityId: s.id, date: s.endDate, title: `${s.name} access ends`, detail: where })
      continue
    }
    if (s.status === 'trial' && s.trialEnd) {
      push({ ...base, type: 'trial-end', entityId: s.id, date: s.trialEnd, title: `${s.name} trial converts`, detail: `${where} · then ${s.amount}/${cycleShort(s.cycle)}`, amount: s.amount })
    }
    if (!s.autoRenew) {
      const end = s.endDate ?? renewalsBetween(s, ref, to)[0]
      if (end) push({ ...base, type: 'sub-end', entityId: s.id, date: end, title: `${s.name} expires`, detail: where })
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
      push({ ...base, type: 'renewal', entityId: s.id, date: d, title: `${s.name} renews`, detail: where, amount: s.amount, lead, quiet: lead < 0, repeat })
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
