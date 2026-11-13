import dayjs from 'dayjs'
import type { Day } from './types'

export const DAY = 'YYYY-MM-DD'

export const today = (): Day => dayjs().format(DAY)
export const nowIso = (): string => new Date().toISOString()

export const isDay = (v: unknown): v is Day => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

export const addDays = (d: Day, n: number): Day => dayjs(d).add(n, 'day').format(DAY)
export const addMonths = (d: Day, n: number): Day => dayjs(d).add(n, 'month').format(DAY)

// Whole calendar days from a to b (positive when b is later).
export const daysBetween = (a: Day, b: Day): number => dayjs(b).startOf('day').diff(dayjs(a).startOf('day'), 'day')

export const daysFromToday = (d: Day, ref: Day = today()): number => daysBetween(ref, d)

// "T-42d" before the date, "T+12d" after it: the app's countdown notation.
export function tMinus(days: number): string {
  if (days === 0) return 'T-0'
  const abs = Math.abs(days)
  const sign = days > 0 ? '-' : '+'
  if (abs < 60) return `T${sign}${abs}d`
  if (abs < 730) return `T${sign}${Math.round(abs / 30.44)}mo`
  return `T${sign}${(abs / 365.25).toFixed(1).replace(/\.0$/, '')}y`
}

// "in 6 weeks", "3 days ago", "today".
export function relative(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  const abs = Math.abs(days)
  const span = abs < 14 ? `${abs} days`
    : abs < 60 ? `${Math.round(abs / 7)} weeks`
    : abs < 730 ? `${Math.round(abs / 30.44)} months`
    : `${(abs / 365.25).toFixed(1).replace(/\.0$/, '')} years`
  return days > 0 ? `in ${span}` : `${span} ago`
}

// "2y 3mo", "8mo", "12d": compact age.
export function span(days: number): string {
  const abs = Math.abs(days)
  if (abs < 31) return `${abs}d`
  const months = Math.floor(abs / 30.44)
  if (months < 12) return `${months}mo`
  const y = Math.floor(months / 12)
  const m = months % 12
  return m ? `${y}y ${m}mo` : `${y}y`
}

export const fmtDay = (d: Day | undefined | null, f = 'MMM D, YYYY'): string => (d ? dayjs(d).format(f) : '—')
export const fmtMonth = (d: Day): string => dayjs(d).format('MMM YYYY')

// Packs dated spans into as few rows as it can, so that no two spans in a row
// overlap. Used where spans are drawn as bars on a shared axis: a warranty and
// a protection plan that run at the same time get a row each instead of being
// drawn on top of one another. Spans that merely touch (one ends the day the
// next begins) are kept apart too, since their bars would meet.
export function packRows<T>(items: T[], span: (item: T) => [Day, Day]): T[][] {
  const rows: { end: Day; items: T[] }[] = []
  const sorted = [...items].sort((a, b) => {
    const [as, ae] = span(a)
    const [bs, be] = span(b)
    return as < bs ? -1 : as > bs ? 1 : ae > be ? -1 : ae < be ? 1 : 0
  })
  for (const item of sorted) {
    const [from, to] = span(item)
    const row = rows.find((r) => r.end < from)
    if (row) { row.items.push(item); row.end = to }
    else rows.push({ end: to, items: [item] })
  }
  return rows.map((r) => r.items)
}
