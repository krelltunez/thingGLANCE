// Support windows from endoflife.date: an open, community-maintained database
// of when products stop receiving updates, with a public CORS-enabled API.
// This is the answer to "when do security updates end for this?".

import dayjs from 'dayjs'
import { DAY, today } from '@/core/dates'

const API = 'https://endoflife.date/api/v1/products'

// Product families we can recognise from a thing's name, with the maker's
// usual support window (years from release) for models that have no published
// end date yet. An estimate is always labelled as one.
const FAMILIES: { match: RegExp; product: string; strip: RegExp; typicalYears: number }[] = [
  { match: /\biphone\b/i, product: 'iphone', strip: /apple|iphone/gi, typicalYears: 7 },
  { match: /\bipad\b/i, product: 'ipad', strip: /apple|ipad/gi, typicalYears: 7 },
  { match: /\bapple watch\b/i, product: 'apple-watch', strip: /apple|watch/gi, typicalYears: 5 },
  { match: /\bpixel watch\b/i, product: 'pixel-watch', strip: /google|pixel|watch/gi, typicalYears: 3 },
  { match: /\bpixel\b/i, product: 'pixel', strip: /google|pixel/gi, typicalYears: 7 },
  { match: /\bgalaxy tab\b/i, product: 'samsung-galaxy-tab', strip: /samsung|galaxy|tab\b/gi, typicalYears: 5 },
  { match: /\bgalaxy watch\b/i, product: 'samsung-galaxy-watch', strip: /samsung|galaxy|watch/gi, typicalYears: 4 },
  { match: /\b(galaxy|samsung)\b/i, product: 'samsung-mobile', strip: /samsung|galaxy/gi, typicalYears: 5 },
  { match: /\bkindle\b/i, product: 'kindle', strip: /amazon|kindle/gi, typicalYears: 6 },
  { match: /\bsurface\b/i, product: 'surface', strip: /microsoft|surface/gi, typicalYears: 6 },
  { match: /\boneplus\b/i, product: 'oneplus', strip: /oneplus/gi, typicalYears: 4 },
  { match: /\bfairphone\b/i, product: 'fairphone', strip: /fairphone/gi, typicalYears: 6 },
  { match: /\bxperia\b/i, product: 'sony-xperia', strip: /sony|xperia/gi, typicalYears: 3 },
  { match: /\b(motorola|moto)\b/i, product: 'motorola-mobility', strip: /motorola|moto\b/gi, typicalYears: 3 },
  { match: /\bchromecast\b/i, product: 'chromecast', strip: /google|chromecast/gi, typicalYears: 5 },
  { match: /\braspberry pi\b/i, product: 'raspberry-pi', strip: /raspberry|pi\b/gi, typicalYears: 8 },
]

interface Release {
  name: string
  label: string
  releaseDate: string | null
  isEol: boolean
  eolFrom: string | null
  isMaintained: boolean
  isDiscontinued?: boolean
  discontinuedFrom?: string | null
}

export interface SupportInfo {
  product: string
  productLabel: string
  release: string
  releaseLabel: string
  releaseDate?: string
  supportEnd?: string
  basis: 'official' | 'estimate'
  ended: boolean
  discontinued?: string
  link: string
  note: string
}

const tokens = (s: string): string[] => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)

const cache = new Map<string, Promise<{ label: string; releases: Release[] }>>()

function loadProduct(product: string): Promise<{ label: string; releases: Release[] }> {
  let p = cache.get(product)
  if (!p) {
    p = fetch(`${API}/${product}`, { signal: AbortSignal.timeout(12_000) })
      .then((r) => { if (!r.ok) throw new Error(`endoflife.date: ${r.status}`); return r.json() })
      .then((d: { result: { label: string; releases: Release[] } }) => d.result)
    p.catch(() => cache.delete(product))
    cache.set(product, p)
  }
  return p
}

// Best release for a name: the release whose label words ALL appear in the
// name, preferring the longest label ("15 Pro" beats "15" for "iPhone 15 Pro",
// and "15 Pro Max" is out because "max" is not in the name).
export function matchRelease(name: string, releases: Release[], strip: RegExp): Release | null {
  const have = new Set(tokens(name.replace(strip, ' ')))
  let best: Release | null = null
  let bestScore = 0
  for (const r of releases) {
    const want = tokens(r.label.replace(strip, ' '))
    if (!want.length || !want.every((w) => have.has(w))) continue
    // Penalise leftover words in the name so "8" does not win over "8a".
    const score = want.length * 10 - (have.size - want.length)
    if (score > bestScore) { best = r; bestScore = score }
  }
  return best
}

export async function findSupport(name: string): Promise<SupportInfo | null> {
  const family = FAMILIES.find((f) => f.match.test(name))
  if (!family) return null
  const { label, releases } = await loadProduct(family.product)
  const r = matchRelease(name, releases, family.strip)
  if (!r) return null

  const base = {
    product: family.product,
    productLabel: label,
    release: r.name,
    releaseLabel: r.label,
    releaseDate: r.releaseDate ?? undefined,
    discontinued: r.discontinuedFrom ?? undefined,
    link: `https://endoflife.date/${family.product}`,
  }
  if (r.eolFrom) {
    const ended = r.eolFrom <= today()
    return { ...base, supportEnd: r.eolFrom, basis: 'official', ended, note: ended ? 'Support has ended' : 'Published end-of-support date' }
  }
  if (r.isEol) return { ...base, basis: 'official', ended: true, note: 'No longer supported' }
  if (r.releaseDate) {
    return {
      ...base,
      supportEnd: dayjs(r.releaseDate).add(family.typicalYears, 'year').format(DAY),
      basis: 'estimate',
      ended: false,
      note: `Still supported. No end date announced; estimated at ${family.typicalYears} years from release.`,
    }
  }
  return { ...base, basis: 'estimate', ended: false, note: 'Still supported. No end date announced.' }
}
