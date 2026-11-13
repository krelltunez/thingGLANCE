// Product facts from Wikipedia: a search, a summary + photo, and the specs in
// the article's infobox. Wikipedia's API answers cross-origin requests from
// any site (`origin=*`), needs no key, and is not scraping, so this works the
// same in the PWA, in Capacitor and in Electron, and is store-safe.

import type { Spec } from '@/core/types'

const API = 'https://en.wikipedia.org/w/api.php'
const REST = 'https://en.wikipedia.org/api/rest_v1'
const TIMEOUT_MS = 12_000

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
  if (!res.ok) throw new Error(`lookup failed: ${res.status}`)
  return (await res.json()) as T
}

export interface SearchHit { title: string; description?: string; thumbnail?: string }

export async function searchWikipedia(query: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'prefixsearch', gpssearch: q, gpslimit: '7',
    prop: 'pageimages|description', piprop: 'thumbnail', pithumbsize: '96', redirects: '1',
  })
  type Page = { title: string; index: number; description?: string; thumbnail?: { source: string } }
  const data = await getJson<{ query?: { pages?: Record<string, Page> } }>(`${API}?${params}`, signal)
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .filter((p) => !/disambiguation/i.test(p.description ?? ''))
    .map((p) => ({ title: p.title, description: p.description, thumbnail: p.thumbnail?.source }))
}

export interface WikiProduct {
  title: string
  description?: string
  summary?: string
  imageUrl?: string
  sourceUrl: string
  brand?: string
  releaseDate?: string
  specs: Spec[]
}

export async function fetchWikiProduct(title: string, signal?: AbortSignal): Promise<WikiProduct> {
  const slug = encodeURIComponent(title.replace(/ /g, '_'))
  type Summary = { title: string; description?: string; extract?: string; thumbnail?: { source: string }; content_urls?: { desktop?: { page?: string } } }
  const params = new URLSearchParams({ action: 'parse', format: 'json', origin: '*', page: title, prop: 'wikitext', section: '0', redirects: '1' })
  const [summary, parsed] = await Promise.all([
    getJson<Summary>(`${REST}/page/summary/${slug}`, signal),
    getJson<{ parse?: { wikitext?: { '*'?: string } } }>(`${API}?${params}`, signal).catch(() => null),
  ])
  const fields = parseInfobox(parsed?.parse?.wikitext?.['*'] ?? '')
  const display = (summary.title ?? title).replace(/^IPhone/, 'iPhone').replace(/^IPad/, 'iPad').replace(/^IMac/, 'iMac')
  return {
    title: display,
    description: summary.description,
    summary: summary.extract,
    imageUrl: summary.thumbnail?.source,
    sourceUrl: summary.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${slug}`,
    brand: pick(fields, ['manufacturer', 'developer', 'brand']),
    releaseDate: toDay(pick(fields, ['released', 'release_date', 'releasedate', 'release date', 'first_release_date', 'date'])),
    specs: toSpecs(fields),
  }
}

// ── Infobox parsing ──────────────────────────────────────────────────────────

const pick = (f: Record<string, string>, keys: string[]): string | undefined => {
  for (const k of keys) if (f[k]) return f[k].split(',')[0].trim() || undefined
  return undefined
}

const SPEC_FIELDS: [string[], string][] = [
  [['type'], 'Type'],
  [['soc', 'cpu', 'processor'], 'Chip'],
  [['gpu', 'graphics'], 'Graphics'],
  [['memory', 'ram'], 'Memory'],
  [['storage'], 'Storage'],
  [['display'], 'Display'],
  [['battery', 'power'], 'Battery'],
  [['os', 'operating system', 'operatingsystem'], 'OS'],
  [['rear_camera', 'camera'], 'Camera'],
  [['connectivity'], 'Connectivity'],
  [['weight'], 'Weight'],
  [['discontinued'], 'Discontinued'],
]

function toSpecs(fields: Record<string, string>): Spec[] {
  const out: Spec[] = []
  for (const [keys, label] of SPEC_FIELDS) {
    const raw = keys.map((k) => fields[k]).find(Boolean)
    if (!raw) continue
    out.push({ label, value: clip(raw, 140) })
  }
  return out
}

function clip(v: string, max: number): string {
  if (v.length <= max) return v
  const cut = v.slice(0, max)
  const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '))
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).trim()}…`
}

function toDay(v: string | undefined): string | undefined {
  if (!v) return undefined
  const iso = v.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (iso) return iso[0]
  const ym = v.match(/\b(\d{4})-(\d{2})\b/)
  if (ym) return `${ym[0]}-01`
  const t = Date.parse(v.replace(/\(.*?\)/g, '').trim())
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10)
  const y = v.match(/\b(19|20)\d{2}\b/)
  return y ? `${y[0]}-01-01` : undefined
}

// Returns the first infobox's fields, keys lower-cased, values cleaned to text.
export function parseInfobox(wikitext: string): Record<string, string> {
  const start = wikitext.search(/\{\{\s*infobox/i)
  if (start < 0) return {}
  let depth = 0
  let end = -1
  for (let i = start; i < wikitext.length; i++) {
    if (wikitext.startsWith('{{', i)) { depth++; i++ }
    else if (wikitext.startsWith('}}', i)) { depth--; i++; if (depth === 0) { end = i - 1; break } }
  }
  if (end < 0) return {}
  const body = wikitext.slice(start + 2, end)

  // Split on the pipes that belong to the infobox itself, not to a nested
  // template or link.
  const parts: string[] = []
  let cur = ''
  let braces = 0
  let brackets = 0
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2)
    if (two === '{{') { braces++; cur += two; i++; continue }
    if (two === '}}') { braces--; cur += two; i++; continue }
    if (two === '[[') { brackets++; cur += two; i++; continue }
    if (two === ']]') { brackets--; cur += two; i++; continue }
    if (body[i] === '|' && braces === 0 && brackets === 0) { parts.push(cur); cur = ''; continue }
    cur += body[i]
  }
  parts.push(cur)

  const fields: Record<string, string> = {}
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim().toLowerCase()
    const value = cleanWikitext(part.slice(eq + 1))
    if (key && value && !fields[key]) fields[key] = value
  }
  return fields
}

const LIST_TEMPLATES = new Set(['plainlist', 'plain list', 'unbulleted list', 'ubl', 'flatlist', 'hlist', 'collapsible list', 'bulleted list', 'indented plainlist'])
const PASS_TEMPLATES = new Set(['nowrap', 'nobr', 'small', 'big', 'abbr', 'nobold', 'resize', 'smaller', 'larger', 'val'])
const DATE_TEMPLATES = /^(start|end|release|launch|film|birth|death) ?date/

function resolveTemplate(inner: string): string {
  const args = inner.split('|').map((a) => a.trim())
  const name = args[0].toLowerCase().replace(/_/g, ' ')
  const positional = args.slice(1).filter((a) => !/^[a-z_ ]+\d*\s*=/i.test(a))
  if (DATE_TEMPLATES.test(name)) {
    const nums = positional.filter((a) => /^\d+$/.test(a))
    if (!nums.length) return positional.join(' ')
    const [y, m, d] = nums
    return [y, m?.padStart(2, '0'), d?.padStart(2, '0')].filter(Boolean).join('-')
  }
  if (LIST_TEMPLATES.has(name)) return positional.join(', ')
  if (PASS_TEMPLATES.has(name)) return positional[0] ?? ''
  if (name === 'convert' || name === 'cvt') return positional.slice(0, 2).join(' ')
  if (name === 'lang' || name === 'transl') return positional[1] ?? ''
  if (name === 'url') return ''
  // Unknown templates (colour swatches, footnotes, "current iOS"): drop.
  return ''
}

export function cleanWikitext(raw: string): string {
  let v = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
  for (let pass = 0; pass < 8 && v.includes('{{'); pass++) {
    v = v.replace(/\{\{([^{}]*)\}\}/g, (_, inner: string) => resolveTemplate(inner))
  }
  return v
    .replace(/\{\{|\}\}/g, '')
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/'{2,}/g, '')
    .replace(/^\s*\*+\s*/gm, ', ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;|&mdash;/g, '–')
    .replace(/\s+/g, ' ')
    .replace(/(\s*,\s*)+/g, ', ')
    .replace(/:\s*,\s*/g, ': ')
    .replace(/^[\s,;]+|[\s,;]+$/g, '')
}
