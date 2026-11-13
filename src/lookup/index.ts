// Web lookup: fill in a thing from public sources instead of typing it.
//
//   Wikipedia       what it is: photo, summary, specs, release date
//   endoflife.date  how long it is supported
//
// Both are public, key-less, CORS-enabled APIs, so the PWA needs no proxy and
// the store builds need no special entitlement. Nothing is sent but the
// product name the user typed into the lookup box, and the whole feature can
// be switched off in Settings. A native shell can later swap in richer
// providers behind this same function.

import type { CategoryId, Spec } from '@/core/types'
import { guessCategory } from '@/core/categories'
import { fetchWikiProduct, searchWikipedia, type SearchHit } from './wikipedia'
import { findSupport, type SupportInfo } from './endoflife'

export type { SearchHit, SupportInfo }
export { searchWikipedia, findSupport }

export interface LookupResult {
  name: string
  description?: string
  summary?: string
  imageUrl?: string
  sourceUrl?: string
  brand?: string
  releaseDate?: string
  specs: Spec[]
  category: CategoryId | null
  support: SupportInfo | null
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)

// `typed` is what the user wrote in the lookup box. One article often covers a
// family ("Pixel 8" is also the 8 Pro), so when the typed name is the more
// specific one it wins, both as the thing's name and for the support lookup.
export async function lookupProduct(title: string, typed?: string, signal?: AbortSignal): Promise<LookupResult> {
  const wiki = await fetchWikiProduct(title, signal)
  const typedWords = new Set(words(typed ?? ''))
  const specific = !!typed && typedWords.size > words(wiki.title).length && words(wiki.title).every((w) => typedWords.has(w))
  const name = specific ? typed!.trim() : wiki.title
  const support = await findSupport(name).catch(() => null) ?? (specific ? await findSupport(wiki.title).catch(() => null) : null)
  return {
    name,
    description: wiki.description,
    summary: wiki.summary,
    imageUrl: wiki.imageUrl,
    sourceUrl: wiki.sourceUrl,
    brand: wiki.brand,
    releaseDate: support?.releaseDate ?? wiki.releaseDate,
    specs: wiki.specs,
    category: guessCategory(`${wiki.title} ${wiki.description ?? ''}`),
    support,
  }
}
