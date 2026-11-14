import dayjs from 'dayjs'
import type { Day } from './types'
import { textLocale, tr } from './text'

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
  if (abs < 60) return `T${sign}${tr('time.days', { n: abs })}`
  if (abs < 730) return `T${sign}${tr('time.months', { n: Math.round(abs / 30.44) })}`
  return `T${sign}${tr('time.years', { n: decimal(abs / 365.25) })}`
}

// 2.5 as the language writes it ("2,5"), and 2 rather than 2.0.
const decimal = (n: number): string => {
  const rounded = Number(n.toFixed(1))
  try { return new Intl.NumberFormat(textLocale(), { maximumFractionDigits: 1 }).format(rounded) } catch { return String(rounded) }
}

// "in 6 weeks", "3 days ago", "today".
// The platform already knows how every language says these, plurals and all,
// so there is nothing here to translate.
export function relative(days: number): string {
  const abs = Math.abs(days)
  const sign = days < 0 ? -1 : 1
  const [n, unit]: [number, Intl.RelativeTimeFormatUnit] = abs < 14 ? [abs, 'day']
    : abs < 60 ? [Math.round(abs / 7), 'week']
    : abs < 730 ? [Math.round(abs / 30.44), 'month']
    : [Number((abs / 365.25).toFixed(1)), 'year']
  return new Intl.RelativeTimeFormat(textLocale(), { numeric: 'auto' }).format(sign * n, unit)
}

// "2y 3mo", "8mo", "12d": compact age.
export function span(days: number): string {
  const abs = Math.abs(days)
  if (abs < 31) return tr('time.days', { n: abs })
  const months = Math.floor(abs / 30.44)
  if (months < 12) return tr('time.months', { n: months })
  const y = Math.floor(months / 12)
  const m = months % 12
  return m ? tr('time.yearsMonths', { y, mo: m }) : tr('time.years', { n: y })
}

// The shapes a date is written in. Named by what they look like in English;
// each language orders and abbreviates them its own way.
export type DayStyle = 'MMM D, YYYY' | 'MMM D' | 'MMM YYYY' | 'MMM YY' | 'MMM' | 'ddd, MMM D' | 'YYYY'

const DAY_STYLES: Record<DayStyle, Intl.DateTimeFormatOptions> = {
  'MMM D, YYYY': { month: 'short', day: 'numeric', year: 'numeric' },
  'MMM D': { month: 'short', day: 'numeric' },
  'MMM YYYY': { month: 'short', year: 'numeric' },
  'MMM YY': { month: 'short', year: '2-digit' },
  MMM: { month: 'short' },
  'ddd, MMM D': { weekday: 'short', month: 'short', day: 'numeric' },
  YYYY: { year: 'numeric' },
}

// The shapes a moment is written in: with or without its year and its date.
export type MomentStyle = 'time' | 'day-time' | 'date-time'

const MOMENT_STYLES: Record<MomentStyle, Intl.DateTimeFormatOptions> = {
  time: { hour: 'numeric', minute: '2-digit' },
  'day-time': { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  'date-time': { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
}

const formatters = new Map<string, Intl.DateTimeFormat>()
function formatter(options: Intl.DateTimeFormatOptions, name: string): Intl.DateTimeFormat {
  const locale = textLocale()
  const id = `${locale}|${name}`
  let f = formatters.get(id)
  if (!f) {
    try { f = new Intl.DateTimeFormat(locale, options) } catch { f = new Intl.DateTimeFormat('en', options) }
    formatters.set(id, f)
  }
  return f
}

// A Day is a calendar date with no zone: build it as local midnight, or a
// device west of Greenwich would print the day before.
const localDate = (d: Day): Date => {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, (m || 1) - 1, day || 1)
}

export const fmtDay = (d: Day | undefined | null, style: DayStyle = 'MMM D, YYYY'): string =>
  d ? formatter(DAY_STYLES[style], style).format(localDate(d)) : tr('time.none')
export const fmtMonth = (d: Day): string => fmtDay(d, 'MMM YYYY')

// A point in time (a timestamp or an ISO string), in the device's zone.
export const fmtMoment = (at: number | string | Date | undefined | null, style: MomentStyle = 'day-time'): string => {
  if (at == null) return tr('time.none')
  const date = at instanceof Date ? at : new Date(at)
  return Number.isNaN(date.getTime()) ? tr('time.none') : formatter(MOMENT_STYLES[style], style).format(date)
}

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
