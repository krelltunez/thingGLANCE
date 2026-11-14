import { afterEach, describe, expect, it } from 'vitest'
import { fmtDay, fmtMoment, relative, span, tMinus } from './dates'
import { describeTies } from './household'
import { money } from './money'
import { english, listText, setTranslator, textLocale, tr } from './text'

afterEach(() => setTranslator(null))

describe('the words core uses', () => {
  it('speaks English with nothing installed', () => {
    expect(tr('verdict.prime.label')).toBe('Prime')
    expect(tr('event.title.renews', { name: 'iCloud+' })).toBe('iCloud+ renews')
    expect(textLocale()).toBe('en')
  })
  it('picks the plural form from the count', () => {
    expect(tr('ties.owns', { count: 1 })).toBe('owns 1 thing')
    expect(tr('ties.owns', { count: 3 })).toBe('owns 3 things')
  })
  it('answers the key itself for one it does not know, so a gap is visible', () => {
    expect(english('not.a.key' as never)).toBe('not.a.key')
  })
  it('hands every request to an installed translator, and takes English back', () => {
    setTranslator((key, params) => `<${key}:${params?.name ?? ''}>`, 'de')
    expect(tr('event.title.renews', { name: 'x' })).toBe('<event.title.renews:x>')
    expect(textLocale()).toBe('de')
    setTranslator(null)
    expect(tr('verdict.solid.label')).toBe('Solid')
    expect(textLocale()).toBe('en')
  })
})

describe('dates, numbers and lists follow the locale', () => {
  it('is unchanged in English', () => {
    expect(fmtDay('2027-01-05')).toBe('Jan 5, 2027')
    expect(fmtDay('2027-01-05', 'MMM D')).toBe('Jan 5')
    expect(fmtDay('2027-01-05', 'MMM YYYY')).toBe('Jan 2027')
    expect(fmtDay('2027-01-05', 'ddd, MMM D')).toBe('Tue, Jan 5')
    expect(fmtDay(null)).toBe('—')
    expect(relative(0)).toBe('today')
    expect(relative(1)).toBe('tomorrow')
    expect(relative(-1)).toBe('yesterday')
    expect(relative(5)).toBe('in 5 days')
    expect(relative(-21)).toBe('3 weeks ago')
    expect(relative(90)).toBe('in 3 months')
    expect(relative(913)).toBe('in 2.5 years')
    expect(relative(-731)).toBe('2 years ago')
    expect(tMinus(12)).toBe('T-12d')
    expect(tMinus(-90)).toBe('T+3mo')
    expect(tMinus(913)).toBe('T-2.5y')
    expect(span(800)).toBe('2y 2mo')
    expect(money(1234, 'USD')).toBe('$1,234')
    expect(listText(['a', 'b', 'c'])).toBe('a, b, and c')
  })
  it('never prints the day before for a date with no zone', () => {
    // A Day is a calendar date: it must read the same in every time zone.
    expect(fmtDay('2027-03-01', 'MMM D')).toBe('Mar 1')
    expect(fmtDay('2027-12-31')).toBe('Dec 31, 2027')
  })
  it('writes a moment with its time', () => {
    const at = new Date(2027, 0, 5, 14, 7).getTime()
    expect(fmtMoment(at, 'time')).toMatch(/2:07\sPM/)
    expect(fmtMoment(at, 'day-time')).toMatch(/^Jan 5, 2:07\sPM$/)
    expect(fmtMoment(null)).toBe('—')
    expect(fmtMoment('not a date')).toBe('—')
  })
  it('follows another locale without a word being translated here', () => {
    setTranslator(english, 'de')
    expect(fmtDay('2027-01-05')).toBe('5. Jan. 2027')
    expect(relative(5)).toBe('in 5 Tagen')
    expect(relative(1)).toBe('morgen')
    expect(tMinus(913)).toBe('T-2,5y')
    expect(money(1234.5, 'EUR', { cents: true })).toMatch(/^1\.234,50\s€$/)
    expect(listText(['a', 'b', 'c'])).toBe('a, b und c')
  })
  it('joins a member\'s ties the way the language does', () => {
    expect(describeTies({ owns: 2, pays: 0, responsible: 1 })).toBe('owns 2 things and is responsible for 1 item')
    expect(describeTies({ owns: 0, pays: 1, responsible: 0 })).toBe('pays for 1 plan')
  })
})
