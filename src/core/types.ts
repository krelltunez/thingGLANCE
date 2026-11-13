// The whole data model. Everything in src/core is pure (no React, no Dexie, no
// DOM) so the same logic can run in the web app, an Electron main process (tray
// popup, MCP server), a headless refresh for the launcher, or a test.
//
// Local shape == sync shape: ids are UUID strings that double as the vault
// entityId, fields are camelCase, and every synced entity carries a `kind`
// discriminator so the vault engine never has to guess what it decrypted.

export type Day = string // 'YYYY-MM-DD', local calendar day
export type Iso = string // ISO 8601 timestamp

export type CategoryId =
  | 'laptop' | 'desktop' | 'phone' | 'tablet' | 'watch' | 'audio' | 'tv' | 'display'
  | 'console' | 'camera' | 'network' | 'storage' | 'smarthome' | 'printer' | 'accessory'
  | 'software' | 'other'

export interface Spec { label: string; value: string }

export interface Thing {
  id: string
  kind: 'thing'
  name: string
  category: CategoryId
  brand?: string
  model?: string
  purchaseDate?: Day
  price?: number
  retailer?: string
  releaseDate?: Day
  // When security / software updates stop. 'official' came from a published
  // end-of-life date, 'estimate' from the maker's usual support window.
  supportEnd?: Day
  supportBasis?: 'official' | 'estimate' | 'manual'
  // How long you plan to keep it. Falls back to the category default.
  lifespanMonths?: number
  status: 'active' | 'retired'
  retiredAt?: Day
  resaleValue?: number
  ownerIds: string[]
  notes?: string
  specs?: Spec[]
  imageUrl?: string
  summary?: string
  sourceUrl?: string
  // endoflife.date handle, kept so support dates can be refreshed later.
  eolProduct?: string
  eolRelease?: string
  pinned?: boolean
  createdAt: Iso
  updatedAt: Iso
  // Local only (never synced): part of the built-in sample set, untouched.
  sample?: boolean
}

export type CoverageType = 'warranty' | 'extended' | 'insurance'

export interface Coverage {
  id: string
  kind: 'coverage'
  thingId: string
  type: CoverageType
  name: string
  provider?: string
  startDate?: Day
  endDate: Day
  cost?: number
  notes?: string
  createdAt: Iso
  updatedAt: Iso
  sample?: boolean
}

export type Cycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export interface Subscription {
  id: string
  kind: 'subscription'
  // Optional: a subscription can stand alone (iCloud+) or hang off a thing
  // (a phone plan, a camera cloud plan, AppleCare+ billed monthly).
  thingId?: string | null
  name: string
  provider?: string
  amount: number
  cycle: Cycle
  // Any date it renewed or will renew on; occurrences roll forward from here.
  anchorDate: Day
  autoRenew: boolean
  status: 'active' | 'trial' | 'cancelled'
  trialEnd?: Day
  // Cancelled (or not auto-renewing): the day access runs out.
  endDate?: Day
  // "Ask me before this renews." Annual plans ask anyway.
  review: boolean
  payerId?: string | null
  notes?: string
  createdAt: Iso
  updatedAt: Iso
  sample?: boolean
}

// What you decided about one horizon event: waved it off, sent it to
// dayGLANCE as a task, or finished that task. Synced, so a decision made on
// one device clears the item everywhere.
export interface Decision {
  id: string
  kind: 'decision'
  eventKey: string
  state: 'dismissed' | 'sent' | 'done'
  taskId?: string
  createdAt: Iso
  updatedAt: Iso
}

// A household member. The roster is the shared `glance-users` vault app that
// every GLANCE app reads and writes.
export interface User {
  id: string
  name: string
  updatedAt: Iso
}

export type SyncEntity = Thing | Coverage | Subscription | Decision

export interface DataSet {
  things: Thing[]
  coverages: Coverage[]
  subscriptions: Subscription[]
  decisions: Decision[]
}

export type EventType = 'coverage-end' | 'support-end' | 'replace' | 'renewal' | 'trial-end' | 'sub-end'

export type Severity = 'past' | 'urgent' | 'soon' | 'later'

export interface HorizonEvent {
  key: string
  type: EventType
  date: Day
  days: number // from today; negative = already happened
  severity: Severity
  title: string
  detail: string
  thingId?: string
  subscriptionId?: string
  coverageId?: string
  amount?: number
  // Inside its lead window and not yet decided: belongs in the attention queue.
  attention: boolean
  decision?: Decision
  // A routine short-cycle renewal nobody asked to hear about (a monthly plan
  // that is not under review). Kept for cost maths, hidden from lists.
  quiet?: boolean
  // A later occurrence of a short-cycle renewal: lists show only the next one.
  repeat?: boolean
}
