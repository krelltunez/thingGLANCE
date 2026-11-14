import { afterEach, describe, expect, it } from 'vitest'
import { daysBetween, isDay } from './dates'

describe('a day', () => {
  it('is a real calendar date, not just the right shape', () => {
    for (const good of ['2027-01-15', '2028-02-29', '1970-01-01', '2200-12-31']) expect(isDay(good), good).toBe(true)
    for (const bad of ['2027-13-45', '2027-02-31', '2027-02-29', '0000-00-00', '9999-99-99', '2027-00-10', '2027-1-5', '27-01-15', '2027-01-15T00:00', '', null, 20270115]) {
      expect(isDay(bad), String(bad)).toBe(false)
    }
  })
})

describe('days between two dates', () => {
  const zone = process.env.TZ
  afterEach(() => { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone })

  it('counts the calendar', () => {
    expect(daysBetween('2027-01-15', '2027-01-15')).toBe(0)
    expect(daysBetween('2027-01-15', '2027-01-16')).toBe(1)
    expect(daysBetween('2027-01-16', '2027-01-15')).toBe(-1)
    expect(daysBetween('2027-02-28', '2027-03-01')).toBe(1)
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2)
    expect(daysBetween('2026-11-12', '2027-11-12')).toBe(365)
  })
  // Where clocks go forward at midnight, that day has no local midnight, and
  // a count made on the clock comes up a day short.
  it.each(['Africa/Cairo', 'America/Santiago', 'America/Havana', 'America/Denver', 'Pacific/Auckland'])('is right across a clock change in %s', (tz) => {
    process.env.TZ = tz
    expect(daysBetween('2027-04-30', '2027-05-01')).toBe(1)
    expect(daysBetween('2027-04-30', '2027-05-10')).toBe(10)
    for (const [a, b] of [['2027-03-13', '2027-03-15'], ['2027-11-06', '2027-11-08'], ['2027-09-04', '2027-09-06'], ['2027-04-03', '2027-04-05']]) {
      expect(daysBetween(a, b), `${a} to ${b}`).toBe(2)
      expect(daysBetween(b, a), `${b} to ${a}`).toBe(-2)
    }
  })
})
