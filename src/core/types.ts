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
  | 'console' | 'camera' | 'security' | 'network' | 'storage' | 'smarthome' | 'printer' | 'accessory'
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
  // Whose it is. Any household member, user of the app or not; null means the
  // household (the TV, the router).
  ownerMemberId: string | null
  // Who deals with it: the member whose devices are asked about its dates.
  // Null means nobody in particular, so everyone is asked.
  responsibleMemberId: string | null
  // 'private' hides it on every device that is not its owner's. A display
  // rule, not encryption: every household device holds the same keys.
  visibility: Visibility
  // Earlier owners, oldest first. The current owner is ownerMemberId.
  ownershipHistory?: OwnershipSpan[]
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

export type Visibility = 'shared' | 'private'

export interface OwnershipSpan {
  memberId: string | null // null: the household
  from?: Day
  to: Day
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
  // The things it is attached to. Empty: it stands alone (iCloud+). One: a
  // camera cloud plan, AppleCare+ billed monthly. Several: a carrier plan
  // across the family's phones.
  coversThingIds: string[]
  // The people it serves. Empty says nothing in particular.
  coversMemberIds: string[]
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
  // Who pays; null means the household. Drives "what I pay".
  payerMemberId: string | null
  // Who is asked before it renews; null means everyone.
  responsibleMemberId: string | null
  // Private plans show only on the payer's devices.
  visibility: Visibility
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

// A household member: anyone things are tracked for, whether or not they use
// the app. The roster is the shared `glance-users` vault app every GLANCE app
// reads and writes, and its row is exactly these three fields. The sibling
// apps write it back as just these three, so nothing else may live on it.
export interface Member {
  id: string
  name: string
  updatedAt: Iso
}

// "This device is that member." One row per device, written by the device
// itself, with the device's own id as its id. A member with at least one of
// these is a user. It lives in thingGLANCE's own vault app, not on the shared
// roster row: being a user of thingGLANCE is a fact about thingGLANCE.
export interface DeviceLink {
  id: string // the device id (src/sync/deviceId.ts)
  kind: 'device'
  memberId: string
  // "Chrome on macOS": enough to tell two of them apart in a list.
  label?: string
  createdAt: Iso
  updatedAt: Iso
}

export type SyncEntity = Thing | Coverage | Subscription | Decision | DeviceLink

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
  // How many days ahead this event starts asking for attention. Negative for
  // a routine renewal that never does.
  lead: number
  title: string
  detail: string
  // The plan's or the coverage's own name, for text built around it (the
  // title already has it inside a sentence in the user's language).
  name?: string
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
