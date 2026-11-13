import dayjs from 'dayjs'
import type { Cycle, Day, Subscription } from './types'
import { DAY, today } from './dates'

export const CYCLES: { id: Cycle; label: string; short: string; perYear: number }[] = [
  { id: 'weekly', label: 'Weekly', short: 'wk', perYear: 52 },
  { id: 'monthly', label: 'Monthly', short: 'mo', perYear: 12 },
  { id: 'quarterly', label: 'Quarterly', short: 'qtr', perYear: 4 },
  { id: 'yearly', label: 'Yearly', short: 'yr', perYear: 1 },
]

const perYear = (c: Cycle): number => CYCLES.find((x) => x.id === c)!.perYear
export const cycleShort = (c: Cycle): string => CYCLES.find((x) => x.id === c)!.short

// A subscription that still costs money going forward.
export const isBilling = (s: Subscription): boolean => s.status === 'active' && s.autoRenew

export const yearlyCost = (s: Subscription): number => (isBilling(s) ? s.amount * perYear(s.cycle) : 0)
export const monthlyCost = (s: Subscription): number => yearlyCost(s) / 12

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

// Every renewal day inside [from, to], inclusive.
export function renewalsBetween(s: Pick<Subscription, 'anchorDate' | 'cycle'>, from: Day, to: Day): Day[] {
  if (!s.anchorDate || from > to) return []
  const approxDays = { weekly: 7, monthly: 30.44, quarterly: 91.3, yearly: 365.25 }[s.cycle]
  let n = Math.floor(dayjs(from).diff(dayjs(s.anchorDate), 'day') / approxDays) - 1
  const out: Day[] = []
  for (let guard = 0; guard < 600; guard++, n++) {
    const d = occurrence(s.anchorDate, s.cycle, n)
    if (d > to) break
    if (d >= from) out.push(d)
  }
  return out
}

export function nextRenewal(s: Pick<Subscription, 'anchorDate' | 'cycle'>, from: Day = today()): Day | null {
  const far = dayjs(from).add(13, 'month').format(DAY)
  return renewalsBetween(s, from, far)[0] ?? null
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
    return new Intl.NumberFormat(undefined, {
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
