import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import en from './locales/en/translation.json'
import { formatLocale, languages, loaders, nativeLanguageName, pickLanguage, resolveLanguage } from './locales'

type Catalog = Record<string, unknown>
const PLURAL = /_(zero|one|two|few|many|other)$/

function flatten(node: Catalog, prefix = '', out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') out.set(prefix + k, v)
    else flatten(v as Catalog, `${prefix}${k}.`, out)
  }
  return out
}
const slots = (s: string): string[] => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort()
const english = flatten(en)
const englishBases = new Set([...english.keys()].map((k) => k.replace(PLURAL, '')))

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) sources(path, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

describe('which language', () => {
  it('ships English, and lists only what is on disk', () => {
    expect(languages).toContain('en')
    expect(languages).toEqual(['en', ...Object.keys(loaders)].sort())
  })
  it('maps any tag onto a language that ships', () => {
    const have = ['de', 'en', 'pt-BR', 'pt-PT', 'zh-CN']
    expect(resolveLanguage('de', have)).toBe('de')
    expect(resolveLanguage('de-AT', have)).toBe('de')
    expect(resolveLanguage('pt-br', have)).toBe('pt-BR')
    expect(resolveLanguage('pt', have)).toBe('pt-PT')
    expect(resolveLanguage('pt-AO', have)).toBe('pt-PT')
    expect(resolveLanguage('zh', have)).toBe('zh-CN')
    expect(resolveLanguage('fr', have)).toBe('en')
    expect(resolveLanguage(undefined, have)).toBe('en')
  })
  it('takes the first of the device\'s languages that ships', () => {
    expect(pickLanguage(['fr-FR', 'de-DE', 'en-US'], ['de', 'en'])).toBe('de')
    expect(pickLanguage(['fr-FR'], ['de', 'en'])).toBe('en')
    expect(pickLanguage([], ['de', 'en'])).toBe('en')
  })
  it('formats for the device\'s region when it is the same language', () => {
    expect(formatLocale('en', ['en-GB', 'en'])).toBe('en-GB')
    expect(formatLocale('en', ['de-DE', 'en-US'])).toBe('en-US')
    expect(formatLocale('de', ['en-US'])).toBe('de')
    expect(formatLocale('pt-BR', ['pt-PT'])).toBe('pt-BR')
  })
  it('names a language in that language', () => {
    expect(nativeLanguageName('en')).toBe('English')
    expect(nativeLanguageName('de')).toBe('Deutsch')
  })
})

describe('the English catalog', () => {
  it('has both forms for every plural', () => {
    for (const key of english.keys()) {
      if (!PLURAL.test(key)) continue
      const base = key.replace(PLURAL, '')
      expect(english.has(`${base}_one`), `${base}_one`).toBe(true)
      expect(english.has(`${base}_other`), `${base}_other`).toBe(true)
    }
  })
  it('has no empty text', () => {
    for (const [key, value] of english) expect(value.trim().length, key).toBeGreaterThan(0)
  })
})

describe('the code and the catalog agree', () => {
  const files = sources(join(process.cwd(), 'src'))
  const used = new Set<string>()
  const prefixes = new Set<string>()
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(/\b(?:t|tr|plain)\(\s*'([^']+)'/g)) used.add(m[1])
    for (const m of text.matchAll(/i18nKey="([^"]+)"/g)) used.add(m[1])
    // A dynamic key: t(`event.kind.${type}`). Its fixed start is what is checked.
    for (const m of text.matchAll(/\b(?:t|tr)\(\s*`([^`$]*)\$\{/g)) prefixes.add(m[1])
    // A ternary of two literal keys: t(cond ? 'a.b' : 'a.c').
    for (const m of text.matchAll(/\b(?:t|tr)\([^()'`]*\?\s*'([\w.-]+)'\s*:\s*'([\w.-]+)'/g)) { used.add(m[1]); used.add(m[2]) }
  }

  it('finds keys to check', () => {
    expect(used.size).toBeGreaterThan(100)
  })
  it('never asks for a key that is not there', () => {
    const missing = [...used].filter((k) => !englishBases.has(k))
    expect(missing).toEqual([])
    const dangling = [...prefixes].filter((p) => ![...englishBases].some((k) => k.startsWith(p)))
    expect(dangling).toEqual([])
  })
  it('carries no text nothing asks for', () => {
    const unused = [...englishBases].filter((k) => !used.has(k) && ![...prefixes].some((p) => k.startsWith(p)))
    expect(unused).toEqual([])
  })
})

describe('every other language', () => {
  it('has the same keys and the same slots as English', async () => {
    for (const [tag, load] of Object.entries(loaders)) {
      const other = flatten(await load())
      const bases = new Set([...other.keys()].map((k) => k.replace(PLURAL, '')))
      expect([...englishBases].filter((k) => !bases.has(k)), `${tag}: missing`).toEqual([])
      expect([...bases].filter((k) => !englishBases.has(k)), `${tag}: extra`).toEqual([])
      for (const [key, value] of other) {
        const source = english.get(key) ?? english.get(`${key.replace(PLURAL, '')}_other`)
        if (source) expect(slots(value).filter((s) => !slots(source).includes(s)), `${tag}: ${key}`).toEqual([])
      }
    }
  })
})
