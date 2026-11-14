// The languages this app ships, derived from what is on disk.
//
// A language is a folder: src/locales/<tag>/translation.json. Adding one is
// adding that file; nothing else lists them (a hand-kept list is how a sibling
// app once shipped translations nobody could reach).
//
// English is part of the main bundle, so the app can always speak. Every
// other language is its own chunk, fetched the first time it is needed. A
// chunk is a hashed build file like any other: the service worker precaches
// it with the rest of the app, and it can never be a version behind the code
// that asks it for a key.

const lazy = import.meta.glob<Record<string, unknown>>(
  ['./locales/*/translation.json', '!./locales/en/translation.json'],
  { import: 'default' },
)

// "./locales/pt-BR/translation.json" -> "pt-BR"
const tagOf = (path: string): string => path.split('/').slice(-2)[0]

export const loaders: Record<string, () => Promise<Record<string, unknown>>> =
  Object.fromEntries(Object.entries(lazy).map(([path, load]) => [tagOf(path), load]))

// Sorted so the value is the same on every machine.
export const languages: string[] = ['en', ...Object.keys(loaders)].sort()

// What a bare language tag means when only regional variants ship. The same
// choice the sibling apps made, so "pt" means the same thing in all of them.
const REGIONAL_DEFAULTS: Record<string, string> = { pt: 'pt-PT' }

// Maps any language tag onto one that ships. The boot detection and the
// picker both use it, so the option shown is always the language on screen.
export function resolveLanguage(reported: unknown, available: string[] = languages): string {
  const fallback = available.includes('en') ? 'en' : available[0]
  if (!reported || typeof reported !== 'string') return fallback
  if (available.includes(reported)) return reported

  // "pt-br" from a browser that lower-cases the region.
  const exact = available.find((l) => l.toLowerCase() === reported.toLowerCase())
  if (exact) return exact

  const base = reported.split('-')[0].toLowerCase()
  if (available.includes(base)) return base

  const preferred = REGIONAL_DEFAULTS[base]
  if (preferred && available.includes(preferred)) return preferred

  // A regional tag for a language shipped only regionally: any variant beats
  // falling through to English.
  return available.find((l) => l.split('-')[0].toLowerCase() === base) ?? fallback
}

// The first of the device's languages that ships, else English. Unlike
// resolveLanguage, a language that does not ship is skipped rather than
// answered with English, so French-then-German lands on German when only
// German ships.
export function pickLanguage(reported: readonly string[], available: string[] = languages): string {
  for (const tag of reported) {
    const base = tag.split('-')[0].toLowerCase()
    if (available.some((l) => l.split('-')[0].toLowerCase() === base)) return resolveLanguage(tag, available)
  }
  return resolveLanguage(null, available)
}

// The tag dates and numbers are formatted for. The language decides the
// words; the region decides whether it is "Sep 4" or "4 Sept", so when the
// device reports a region for the language in use, that wins.
export function formatLocale(language: string, reported: readonly string[]): string {
  const base = language.split('-')[0].toLowerCase()
  // A language that ships regionally (pt-BR) already says which region.
  if (language.includes('-')) return language
  return reported.find((tag) => tag.includes('-') && tag.split('-')[0].toLowerCase() === base) ?? language
}

// What a language calls itself ("Deutsch", "português (Brasil)").
export function nativeLanguageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: 'language' }).of(tag)
    if (name) return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1)
  } catch { /* fall through */ }
  return tag
}
