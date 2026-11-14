// The whole road, with a second language that exists only for this test:
// the catalog chunk loads, core starts speaking it, dates follow, and the
// choice is remembered.

import { beforeAll, describe, expect, it, vi } from 'vitest'
import en from './locales/en/translation.json'

type Catalog = { [key: string]: string | Catalog }
// English with every word bracketed: any text that is still plain English
// after switching did not come through the catalog.
const bracket = (node: Catalog): Catalog =>
  Object.fromEntries(Object.entries(node).map(([k, v]) => [k, typeof v === 'string' ? `[${v}]` : bracket(v)]))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})
vi.stubGlobal('navigator', { languages: ['fr-FR', 'en-US'], language: 'fr-FR' })

vi.mock('./locales', async (original) => {
  const real = await original<typeof import('./locales')>()
  return { ...real, languages: ['de', 'en'], loaders: { de: async () => bracket(en as Catalog) } }
})

let mod: typeof import('./i18n')
let text: typeof import('./core/text')
let dates: typeof import('./core/dates')
let horizon: typeof import('./core/horizon')

beforeAll(async () => {
  mod = await import('./i18n')
  text = await import('./core/text')
  dates = await import('./core/dates')
  horizon = await import('./core/horizon')
  await mod.i18nReady
})

describe('the app\'s language', () => {
  it('starts in the first device language that ships, with English ready at once', () => {
    // French does not ship here; English is next on the device's list.
    expect(mod.default.language).toBe('en')
    expect(mod.storedLanguage()).toBeNull()
    expect(mod.default.t('verdict.prime.label')).toBe('Prime')
    expect(text.textLocale()).toBe('en-US')
  })
  it('gives core the app\'s translator, plurals included', () => {
    expect(text.tr('ties.owns', { count: 1 })).toBe('owns 1 thing')
    expect(text.tr('ties.owns', { count: 4 })).toBe('owns 4 things')
  })
  it('switches everything at once, and remembers the choice', async () => {
    await mod.setLanguage('de')
    expect(mod.default.language).toBe('de')
    expect(mod.storedLanguage()).toBe('de')
    expect(mod.default.t('verdict.prime.label')).toBe('[Prime]')
    expect(text.tr('event.title.renews', { name: 'iCloud+' })).toBe('[iCloud+ renews]')
    expect(horizon.eventKindLabel('renewal')).toBe('[Renewal]')
    expect(text.textLocale()).toBe('de')
    expect(dates.fmtDay('2027-01-05')).toBe('5. Jan. 2027')
    expect(dates.tMinus(12)).toBe('T-[12d]')
  })
  it('goes back to following the device', async () => {
    await mod.setLanguage(null)
    expect(mod.storedLanguage()).toBeNull()
    expect(mod.default.language).toBe('en')
    expect(text.tr('verdict.prime.label')).toBe('Prime')
    expect(dates.fmtDay('2027-01-05')).toBe('Jan 5, 2027')
  })
  it('ignores a stored language that no longer ships', () => {
    store.set(mod.LANGUAGE_KEY, 'xx')
    expect(mod.storedLanguage()).toBeNull()
    store.delete(mod.LANGUAGE_KEY)
  })
})
