import dayjs from 'dayjs'
import type { Cycle, Day, Subscription } from './types'
import { DAY, addDays, dayOf, today } from './dates'
import { textLocale, tr } from './text'

export const CYCLES: { id: Cycle; perYear: number }[] = [
  { id: 'weekly', perYear: 52 },
  { id: 'monthly', perYear: 12 },
  { id: 'quarterly', perYear: 4 },
  { id: 'yearly', perYear: 1 },
]

const perYear = (c: Cycle): number => CYCLES.find((x) => x.id === c)!.perYear
// "Monthly" and the "mo" in "$9.99/mo", in the language in use.
export const cycleLabel = (c: Cycle): string => tr(`cycle.${c}.label`)
export const cycleShort = (c: Cycle): string => tr(`cycle.${c}.short`)

// A plan with a fixed term: it is paid each cycle until the day it ends (a
// lease, a phone on installments). Answers that day, or null for a plan that
// renews until someone cancels it, and for one that does not renew at all.
export const termEnd = (s: Pick<Subscription, 'status' | 'autoRenew' | 'endDate'>): Day | null =>
  s.status !== 'cancelled' && s.autoRenew && s.endDate ? s.endDate : null

// Over and done with: cancelled, or a fixed term whose last day has passed.
// (A cancelled plan may still give access until its end date; it is in the
// "ended" pile all the same, as it has been since it was cancelled.)
export const isOver = (s: Pick<Subscription, 'status' | 'autoRenew' | 'endDate'>, ref: Day = today()): boolean =>
  s.status === 'cancelled' || (termEnd(s) ?? ref) < ref

// A subscription that still costs money going forward. A term that has run
// out costs nothing more.
export const isBilling = (s: Subscription, ref: Day = today()): boolean =>
  s.status === 'active' && s.autoRenew && !(s.endDate && s.endDate <= ref)

export const yearlyCost = (s: Subscription, ref: Day = today()): number => (isBilling(s, ref) ? s.amount * perYear(s.cycle) : 0)
export const monthlyCost = (s: Subscription, ref: Day = today()): number => yearlyCost(s, ref) / 12

// The day a plan's payments are counted from: the day it began, when that is
// on record, and otherwise the day it was entered.
export const planStart = (s: Pick<Subscription, 'startDate' | 'createdAt'>): Day => s.startDate ?? dayOf(s.createdAt)

// The nth occurrence from the anchor, computed from the anchor each time so a
// monthly plan anchored on the 31st does not drift to the 28th forever.
function occurrence(anchor: Day, cycle: Cycle, n: number): Day {
  const a = dayjs(anchor)
  switch (cycle) {
    case 'weekly': return a.add(n * 7, 'day').format(DAY)
    case 'monthly': return a.add(n, 'month').format(DAY)
    case 'quarterly': return a.add(n * 3, 'month').format(DAY)
    case 'yearly': return a.add(n, 'year').format(DAY)
  }
}

// A weekly plan for a lifetime: enough for any range this app asks about.
const MAX_RENEWALS = 5000

// What a plan's renewal days are worked out from. The anchor and the cycle
// say where they fall; the rest only bound them, and may be left out.
export type Renewing = Pick<Subscription, 'anchorDate' | 'cycle'> & Partial<Pick<Subscription, 'startDate' | 'endDate' | 'createdAt'>>

// Every renewal day inside [from, to], inclusive. A plan renews on its cycle
// from the day it began and stops before the day it ends: nothing renewed
// before there was a plan, and the last day of a term is not a payment.
export function renewalsBetween(s: Renewing, from: Day, to: Day): Day[] {
  if (!s.anchorDate) return []
  const began = s.startDate ?? (s.createdAt ? dayOf(s.createdAt) : null)
  if (began && began > from) from = began
  if (s.endDate && s.endDate <= to) to = addDays(s.endDate, -1)
  if (from > to) return []
  const approxDays = { weekly: 7, monthly: 30.44, quarterly: 91.3, yearly: 365.25 }[s.cycle]
  let n = Math.floor(dayjs(from).diff(dayjs(s.anchorDate), 'day') / approxDays) - 1
  const out: Day[] = []
  for (let guard = 0; guard < MAX_RENEWALS; guard++, n++) {
    const d = occurrence(s.anchorDate, s.cycle, n)
    if (d > to) break
    if (d >= from) out.push(d)
  }
  return out
}

export function nextRenewal(s: Renewing, from: Day = today()): Day | null {
  const far = dayjs(from).add(13, 'month').format(DAY)
  return renewalsBetween(s, from, far)[0] ?? null
}

// What a plan has taken so far: its renewal days from the day it began up to
// yesterday, at what it costs now (what it cost before is not on record). A
// trial has taken nothing until it converts.
export interface Paid { since: Day; payments: number; total: number; last: Day | null }

export function paidToDate(s: Subscription, ref: Day = today()): Paid {
  const since = planStart(s)
  const days = renewalsBetween(s, since, addDays(ref, -1)).filter((d) => !(s.status === 'trial' && s.trialEnd && d < s.trialEnd))
  return { since, payments: days.length, total: cents(days.length * s.amount), last: days[days.length - 1] ?? null }
}

// What is left on a fixed term: the payments from today to the day it ends.
// Null for a plan with no term.
export interface TermLeft { ends: Day; payments: number; total: number }

export function leftOnTerm(s: Subscription, ref: Day = today()): TermLeft | null {
  const ends = termEnd(s)
  if (!ends) return null
  const days = renewalsBetween(s, ref, ends).filter((d) => !(s.status === 'trial' && s.trialEnd && d < s.trialEnd))
  return { ends, payments: days.length, total: cents(days.length * s.amount) }
}

const cents = (n: number): number => Math.round(n * 100) / 100

export interface Charge { subscriptionId: string; name: string; date: Day; amount: number }

// Every charge that will actually be made from `from` through `days` days
// later, soonest first. A cancelled plan and one that does not renew charge
// nothing; a trial charges nothing before it converts.
export function chargesWithin(subs: Subscription[], from: Day, days: number): Charge[] {
  const to = dayjs(from).add(days, 'day').format(DAY)
  const out: Charge[] = []
  for (const s of subs) {
    if (s.status === 'cancelled' || !s.autoRenew) continue
    for (const date of renewalsBetween(s, from, to)) {
      if (s.status === 'trial' && s.trialEnd && date < s.trialEnd) continue
      out.push({ subscriptionId: s.id, name: s.name, date, amount: s.amount })
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount))
}

export interface ForecastMonth { month: Day; total: number; items: { id: string; name: string; amount: number; date: Day }[] }

// What will actually be charged in each of the next `months` calendar months.
export function forecast(subs: Subscription[], months = 12, ref: Day = today()): ForecastMonth[] {
  const start = dayjs(ref).startOf('month')
  const out: ForecastMonth[] = []
  for (let i = 0; i < months; i++) {
    const m = start.add(i, 'month')
    const from = i === 0 ? ref : m.format(DAY)
    const to = m.endOf('month').format(DAY)
    const items: ForecastMonth['items'] = []
    for (const s of subs) {
      if (s.status === 'cancelled') continue
      if (s.status === 'active' && !s.autoRenew) continue
      for (const d of renewalsBetween(s, from, to)) {
        if (s.status === 'trial' && s.trialEnd && d < s.trialEnd) continue
        items.push({ id: s.id, name: s.name, amount: s.amount, date: d })
      }
    }
    items.sort((a, b) => b.amount - a.amount)
    out.push({ month: m.format(DAY), total: items.reduce((t, x) => t + x.amount, 0), items })
  }
  return out
}

export function money(amount: number | undefined | null, currency: string, opts: { compact?: boolean; cents?: boolean } = {}): string {
  if (amount == null || Number.isNaN(amount)) return '—'
  const cents = opts.cents ?? (Math.abs(amount) < 100 && amount % 1 !== 0)
  try {
    return new Intl.NumberFormat(textLocale(), {
      style: 'currency',
      currency,
      notation: opts.compact && Math.abs(amount) >= 10000 ? 'compact' : 'standard',
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(cents ? 2 : 0)}`
  }
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'SEK', 'NOK', 'DKK', 'NZD', 'BRL', 'MXN', 'INR']

export function defaultCurrency(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region
    const map: Record<string, string> = { US: 'USD', GB: 'GBP', CA: 'CAD', AU: 'AUD', NZ: 'NZD', CH: 'CHF', JP: 'JPY', SE: 'SEK', NO: 'NOK', DK: 'DKK', BR: 'BRL', MX: 'MXN', IN: 'INR' }
    if (region && map[region]) return map[region]
    const euro = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR']
    if (region && euro.includes(region)) return 'EUR'
  } catch { /* fall through */ }
  return 'USD'
}
