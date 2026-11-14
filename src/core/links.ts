// One link grammar for everything that opens the app at a particular place:
// widget taps, notification taps, shortcuts, the tray, the launcher, Siri, a
// pasted link. Each of those hands over a string; parseLink() turns it into a
// target and the app has one place that acts on it (state/useLinks.ts).
//
// dayGLANCE's stated hindsight is to send all of these through one router from
// the first day, so that is what this is.
//
//   thingglance://thing/<id>           a thing's detail
//   thingglance://plan/<id>            a plan
//   thingglance://event/<key>          whatever a date on the horizon belongs to
//   thingglance://view/<name>          glance | horizon | things | plans
//   thingglance://queue                what needs a decision (the Glance page)
//   thingglance://action/add           the add-a-thing form (?name= prefills)
//   thingglance://action/add-plan      the add-a-plan form
//   thingglance://settings/<section>   settings, optionally at a section
//   thingglance://search?q=<text>      the command palette
//
// A link only ever NAVIGATES. Nothing here changes data: a link can arrive
// from anywhere, a web page included. Writes from outside go through
// intents/handleIntent.ts, which demands an id for each one.
//
// The web app has no custom scheme of its own, so the same paths are accepted
// as `?link=<path or full link>` on the app's own address, along with the
// older query forms the PWA shortcuts were installed with.

export const LINK_SCHEME = 'thingglance'
export const LINK_VIEWS = ['glance', 'horizon', 'things', 'plans'] as const
export type LinkView = (typeof LINK_VIEWS)[number]
export const LINK_SETTINGS = ['general', 'vault', 'household', 'integrations', 'data', 'about'] as const
export type LinkSettings = (typeof LINK_SETTINGS)[number]

export type LinkTarget =
  | { kind: 'view'; view: LinkView }
  | { kind: 'queue' }
  | { kind: 'thing'; id: string }
  | { kind: 'plan'; id: string }
  | { kind: 'event'; key: string }
  | { kind: 'add'; what: 'thing' | 'plan'; name?: string }
  | { kind: 'settings'; section?: LinkSettings }
  | { kind: 'search'; q?: string }

const isView = (v: string): v is LinkView => (LINK_VIEWS as readonly string[]).includes(v)
const isSection = (v: string): v is LinkSettings => (LINK_SETTINGS as readonly string[]).includes(v)
const decode = (v: string): string => { try { return decodeURIComponent(v) } catch { return v } }
// Ids and event keys are opaque, but they are never empty and never enormous.
const usable = (v: string | undefined): v is string => !!v && v.length <= 300

// `path` is "thing/abc", `query` whatever followed a "?".
function fromPath(path: string, query: URLSearchParams): LinkTarget | null {
  const [head, ...rest] = path.replace(/^\/+|\/+$/g, '').split('/')
  const arg = rest.length ? decode(rest.join('/')) : undefined
  switch (head) {
    case 'thing': return usable(arg) ? { kind: 'thing', id: arg } : null
    case 'plan': return usable(arg) ? { kind: 'plan', id: arg } : null
    case 'event': return usable(arg) ? { kind: 'event', key: arg } : null
    case 'view': return arg && isView(arg) ? { kind: 'view', view: arg } : null
    case 'queue': return { kind: 'queue' }
    case 'action': {
      const name = query.get('name')?.trim().slice(0, 200) || undefined
      if (arg === 'add' || arg === 'add-thing') return { kind: 'add', what: 'thing', ...(name ? { name } : {}) }
      if (arg === 'add-plan' || arg === 'add-subscription') return { kind: 'add', what: 'plan', ...(name ? { name } : {}) }
      return null
    }
    case 'settings': return arg === undefined ? { kind: 'settings' } : isSection(arg) ? { kind: 'settings', section: arg } : null
    case 'search': {
      const q = query.get('q')?.trim().slice(0, 200) || undefined
      return { kind: 'search', ...(q ? { q } : {}) }
    }
    default: return null
  }
}

// The older query forms: ?view=horizon, ?thing=<id>, ?action=add-thing.
function fromLegacyQuery(q: URLSearchParams): LinkTarget | null {
  const thing = q.get('thing')
  if (usable(thing ?? undefined)) return { kind: 'thing', id: thing! }
  const action = q.get('action')
  if (action) return fromPath(`action/${action}`, q)
  const view = q.get('view')
  if (view && isView(view)) return { kind: 'view', view }
  return null
}

// Accepts a thingglance:// link (or web+thingglance://, the form a PWA's
// protocol handler receives), a bare path ("thing/abc"), or the app's own web
// address with ?link= or one of the older query forms. Null for anything else.
export function parseLink(input: string | null | undefined): LinkTarget | null {
  const raw = (input ?? '').trim()
  if (!raw || raw.length > 2000) return null
  const custom = raw.match(/^(?:web\+)?thingglance:\/{0,2}([^?#]*)(?:\?([^#]*))?/i)
  if (custom) return fromPath(custom[1], new URLSearchParams(custom[2] ?? ''))
  if (/^https?:\/\//i.test(raw) || raw.startsWith('?') || raw.startsWith('/?')) {
    let query: URLSearchParams
    try { query = /^https?:/i.test(raw) ? new URL(raw).searchParams : new URLSearchParams(raw.slice(raw.indexOf('?'))) } catch { return null }
    const link = query.get('link')
    if (link) {
      // A link inside a link is still only a link; one level is all it gets.
      const inner = link.trim()
      return /^https?:/i.test(inner) || inner.startsWith('?') ? null : parseLink(inner)
    }
    return fromLegacyQuery(query)
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return null // some other scheme
  const [path, query = ''] = raw.split('?')
  return fromPath(path, new URLSearchParams(query))
}

const enc = encodeURIComponent

// The canonical link for a target. parseLink(formatLink(t)) is t.
export function formatLink(t: LinkTarget): string {
  const base = `${LINK_SCHEME}://`
  switch (t.kind) {
    case 'view': return `${base}view/${t.view}`
    case 'queue': return `${base}queue`
    case 'thing': return `${base}thing/${enc(t.id)}`
    case 'plan': return `${base}plan/${enc(t.id)}`
    case 'event': return `${base}event/${enc(t.key)}`
    case 'add': return `${base}action/${t.what === 'thing' ? 'add' : 'add-plan'}${t.name ? `?name=${enc(t.name)}` : ''}`
    case 'settings': return `${base}settings${t.section ? `/${t.section}` : ''}`
    case 'search': return `${base}search${t.q ? `?q=${enc(t.q)}` : ''}`
  }
}

// Where a date on the horizon leads: its own link, which the app resolves to
// the plan or the thing it belongs to. Used on snapshot events and reminders,
// so a widget row or a notification only has to open what it was given.
export const eventLink = (key: string): string => formatLink({ kind: 'event', key })
