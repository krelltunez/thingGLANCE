// The app's language: i18next, set up the way the sibling apps do it, with
// two differences that fall out of this app's rules.
//
//   - Locale files are bundled, not fetched (see src/locales.ts). The siblings
//     load /locales/<lng>/translation.json over HTTP at runtime; here every
//     request has to go through the shell's transport, and an app asset is
//     not something a native transport can fetch.
//   - Core never imports this. It gets its words through src/core/text.ts,
//     and this module installs the translator there.
//
// A choice made in the picker is stored on the device. With none stored, the
// app follows the device's language.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en/translation.json'
import { setTranslator, type TextKey, type TextParams } from './core/text'
import { formatLocale, languages, loaders, pickLanguage } from './locales'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}

export const LANGUAGE_KEY = 'tg_lang'

const reported = (): readonly string[] => {
  if (typeof navigator === 'undefined') return []
  return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : []
}

// The language the user picked on this device, or null when it follows the
// device.
export function storedLanguage(): string | null {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY)
    return v && languages.includes(v) ? v : null
  } catch {
    return null
  }
}

export const deviceLanguage = (): string => pickLanguage(reported())

// Every other language arrives as its own chunk.
const chunks = {
  type: 'backend' as const,
  init() { /* nothing to set up */ },
  read(lng: string, _ns: string, done: (err: unknown, data: Record<string, unknown> | null) => void) {
    const load = loaders[lng]
    if (!load) { done(new Error(`no locale file for ${lng}`), null); return }
    load().then((data) => done(null, data), (err) => done(err, null))
  },
}

// i18next's own `t` is typed against the catalog for components. Core has
// its own key type (TextKey), checked the same way, so here it is just a call.
const plain = i18n.t.bind(i18n) as unknown as (key: string, params?: TextParams) => string

function follow(lng: string | undefined): void {
  // i18next has already settled on a language that ships.
  const language = lng || 'en'
  setTranslator((key: TextKey, params?: TextParams) => plain(key, params), formatLocale(language, reported()))
  if (typeof document !== 'undefined') document.documentElement.lang = language
}

// Registered before init so core is already on the new language when
// react-i18next re-renders: no frame paints a date in the language just left.
i18n.on('languageChanged', follow)

// Resolves once the starting language is loaded. English resolves at once
// (it is in the bundle); main.tsx waits for this before the first render so
// another language never flashes English first.
export const i18nReady: Promise<unknown> = i18n
  .use(chunks)
  .use(initReactI18next)
  .init({
    lng: storedLanguage() ?? deviceLanguage(),
    fallbackLng: 'en',
    supportedLngs: languages,
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    ns: ['translation'],
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  })

follow(i18n.language)

// Null goes back to following the device.
export async function setLanguage(lng: string | null): Promise<void> {
  try {
    if (lng) localStorage.setItem(LANGUAGE_KEY, lng)
    else localStorage.removeItem(LANGUAGE_KEY)
  } catch { /* applied for this session all the same */ }
  await i18n.changeLanguage(lng ?? deviceLanguage())
}

export default i18n
