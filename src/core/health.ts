import type { Coverage, Day, Subscription, Thing } from './types'
import { addMonths, daysBetween, today } from './dates'
import { category } from './categories'
import { yearlyCost } from './money'

export type Verdict = 'prime' | 'solid' | 'watch' | 'replace' | 'overdue' | 'retired' | 'unknown'

export interface Lifecycle {
  start: Day | null          // when its clock started for you (purchase, else release)
  ageDays: number | null
  replaceBy: Day | null      // your plan: purchase + lifespan
  supportEnd: Day | null
  lifeEnd: Day | null        // whichever of the two comes first
  lifeEndReason: 'support' | 'plan' | null
  daysLeft: number | null
  remaining: number | null   // 0..1 of its window still ahead
  warrantyEnd: Day | null    // latest coverage end
  covered: boolean
  verdict: Verdict
}

export const VERDICTS: Record<Verdict, { label: string; hint: string; tone: 'ok' | 'accent' | 'warn' | 'bad' | 'dim' }> = {
  prime: { label: 'Prime', hint: 'Covered and current', tone: 'ok' },
  solid: { label: 'Solid', hint: 'Plenty of life left', tone: 'accent' },
  watch: { label: 'Watch', hint: 'Start thinking about what is next', tone: 'warn' },
  replace: { label: 'Replace soon', hint: 'Its window closes within six months', tone: 'bad' },
  overdue: { label: 'Past its window', hint: 'Out of support or past your plan', tone: 'bad' },
  retired: { label: 'Retired', hint: 'No longer in service', tone: 'dim' },
  unknown: { label: 'No dates yet', hint: 'Add a purchase date to start the clock', tone: 'dim' },
}

export function lifecycle(thing: Thing, coverages: Coverage[] = [], ref: Day = today()): Lifecycle {
  const start = thing.purchaseDate ?? thing.releaseDate ?? null
  const ageDays = start ? Math.max(0, daysBetween(start, ref)) : null
  const months = thing.lifespanMonths ?? category(thing.category).lifespanMonths
  const replaceBy = thing.purchaseDate ? addMonths(thing.purchaseDate, months) : null
  const supportEnd = thing.supportEnd ?? null

  let lifeEnd: Day | null = null
  let lifeEndReason: Lifecycle['lifeEndReason'] = null
  if (supportEnd && (!replaceBy || supportEnd <= replaceBy)) { lifeEnd = supportEnd; lifeEndReason = 'support' }
  else if (replaceBy) { lifeEnd = replaceBy; lifeEndReason = 'plan' }

  const daysLeft = lifeEnd ? daysBetween(ref, lifeEnd) : null
  let remaining: number | null = null
  if (lifeEnd && start) {
    const total = daysBetween(start, lifeEnd)
    remaining = total > 0 ? Math.min(1, Math.max(0, (daysLeft ?? 0) / total)) : 0
  }

  const ends = coverages.filter((c) => c.thingId === thing.id).map((c) => c.endDate).sort()
  const warrantyEnd = ends.length ? ends[ends.length - 1] : null
  const covered = !!warrantyEnd && warrantyEnd >= ref

  let verdict: Verdict
  if (thing.status === 'retired') verdict = 'retired'
  else if (daysLeft == null) verdict = 'unknown'
  else if (daysLeft < 0) verdict = 'overdue'
  else if (daysLeft <= 183) verdict = 'replace'
  else if (daysLeft <= 548 || (remaining != null && remaining < 0.25)) verdict = 'watch'
  else if (covered && (remaining ?? 0) > 0.6) verdict = 'prime'
  else verdict = 'solid'

  return { start, ageDays, replaceBy, supportEnd, lifeEnd, lifeEndReason, daysLeft, remaining, warrantyEnd, covered, verdict }
}

export interface Ownership {
  hardware: number
  coverage: number
  subscriptionsPerYear: number
  perDay: number | null     // hardware + coverage, spread over the days owned so far
  projectedPerDay: number | null // spread over the whole planned life
}

export function ownership(thing: Thing, coverages: Coverage[], subs: Subscription[], ref: Day = today()): Ownership {
  const hardware = thing.price ?? 0
  const coverage = coverages.filter((c) => c.thingId === thing.id).reduce((t, c) => t + (c.cost ?? 0), 0)
  const subscriptionsPerYear = subs.filter((s) => s.thingId === thing.id).reduce((t, s) => t + yearlyCost(s), 0)
  const life = lifecycle(thing, coverages, ref)
  const end = thing.status === 'retired' && thing.retiredAt ? thing.retiredAt : ref
  const owned = thing.purchaseDate ? Math.max(1, daysBetween(thing.purchaseDate, end)) : null
  const net = hardware + coverage - (thing.status === 'retired' ? thing.resaleValue ?? 0 : 0)
  const planned = thing.purchaseDate && life.lifeEnd ? Math.max(1, daysBetween(thing.purchaseDate, life.lifeEnd)) : null
  return {
    hardware,
    coverage,
    subscriptionsPerYear,
    perDay: owned && net > 0 ? net / owned : null,
    projectedPerDay: planned && net > 0 ? net / planned : null,
  }
}

// "Set this much aside each month and every replacement is already paid for."
// For each active thing with a price and a plan: its price spread over the
// months it has left. A thing already past its window counts in full.
export function replacementFund(things: Thing[], coverages: Coverage[], ref: Day = today()) {
  let monthly = 0
  let dueNow = 0
  const rows: { thing: Thing; monthly: number; monthsLeft: number; lifeEnd: Day }[] = []
  for (const t of things) {
    if (t.status !== 'active' || !t.price) continue
    const life = lifecycle(t, coverages, ref)
    if (!life.lifeEnd || life.daysLeft == null) continue
    const monthsLeft = life.daysLeft / 30.44
    if (monthsLeft <= 1) { dueNow += t.price; rows.push({ thing: t, monthly: t.price, monthsLeft: 0, lifeEnd: life.lifeEnd }); continue }
    const m = t.price / monthsLeft
    monthly += m
    rows.push({ thing: t, monthly: m, monthsLeft, lifeEnd: life.lifeEnd })
  }
  rows.sort((a, b) => a.monthsLeft - b.monthsLeft)
  return { monthly, dueNow, rows }
}
