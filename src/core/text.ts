// Where core gets its words from.
//
// Core builds text other surfaces show as it is: a date's title on the
// horizon, a reminder's body, a verdict's label. It must not know about
// i18next or React (a widget host, the tray and a headless run import core
// too), so it asks for words through this seam.
//
// With nothing installed, the words are English, read straight from the same
// catalog the app ships (src/locales/en/translation.json). The app installs
// its translator at boot (src/i18n.ts), and from then on core speaks whatever
// language the app does. Any other host does the same with one call.

import en from '../locales/en/translation.json'

type PluralSuffix = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'
type Strip<K extends string> = K extends `${infer Base}_${PluralSuffix}` ? Base : K
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? Strip<`${P}${K}`> : Leaves<T[K], `${P}${K}.`>
}[keyof T & string]

// Every key in the English catalog, with plural suffixes folded away: a key
// that is not in the catalog does not compile.
export type TextKey = Leaves<typeof en>
export type TextParams = Record<string, string | number | null | undefined>
export type Translate = (key: TextKey, params?: TextParams) => string

function lookup(key: string): string | undefined {
  let node: unknown = en
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : undefined
}

// The fallback: English, with the two things the catalog needs from a
// translator (a count picking the plural form, and {{name}} slots).
export const english: Translate = (key, params) => {
  const count = params?.count
  const found = (typeof count === 'number' ? lookup(`${key}_${count === 1 ? 'one' : 'other'}`) : undefined) ?? lookup(key)
  if (found === undefined) return key
  return found.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params?.[name] ?? ''))
}

let translate: Translate = english
// The BCP 47 tag dates, numbers and lists are formatted for.
let locale = 'en'

export const tr: Translate = (key, params) => translate(key, params)
export const textLocale = (): string => locale

// Null puts English back. `tag` is the formatting locale, which can be more
// specific than the language ("en-GB" under an English catalog).
export function setTranslator(fn: Translate | null, tag?: string): void {
  translate = fn ?? english
  locale = fn ? (tag ?? locale) : 'en'
}

export function setTextLocale(tag: string): void {
  locale = tag
}

// "a, b and c" in whatever way the language joins a list.
export function listText(parts: string[]): string {
  try {
    return new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(parts)
  } catch {
    return parts.join(', ')
  }
}
