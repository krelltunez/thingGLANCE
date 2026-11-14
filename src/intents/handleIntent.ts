// The one handler for anything outside the app that wants to change or ask
// something: a widget button, a notification action, the launcher, the tray,
// Tasker, an MCP tool. Each of those is only a transport. They all hand over
// the same three things (an action, a payload, an id for the write) and get
// the same plain result back.
//
// It has no knowledge of where a request came from and no access of its own:
// everything it can do is a collaborator on `ctx`, and the live context
// (intents/inbound.ts) builds those from the same functions the forms use, so
// an outside write stamps, syncs and promotes samples exactly as a tap in the
// app would. With a collaborator missing, the handler validates and answers
// without changing anything, which is how the tests and dry runs use it.
//
// Idempotency is not optional. Every write must carry a `clientId` its caller
// chose; a second write with the same id is acknowledged from the ledger and
// not applied again. A create whose id is a UUID also becomes the new row's
// own id, so the same write arriving on another device makes the same row.
//
// Modelled on lastGLANCE's handleIntent and launcher ledger.

import type { CategoryId, CoverageType, Cycle, HorizonEvent, Member, Thing } from '@/core/types'
import { CATEGORIES, guessCategory } from '@/core/categories'
import { isDay, today } from '@/core/dates'
import { MAX_LIFESPAN_MONTHS } from '@/core/health'
import { parseLink, type LinkTarget } from '@/core/links'
import type { GlanceSnapshot } from '@/core/snapshot'
import type { CoverageInput, SubscriptionInput, ThingInput } from '@/db/queries'
import { findHandled, readLedger, recordHandled, writeLedger, type HandledWrite } from './ledger'

export const INTENT_ACTIONS = {
  CREATE_THING: 'create_thing',
  ADD_COVERAGE: 'add_coverage',
  CREATE_PLAN: 'create_plan',
  // Clear a date from the queue ("done" or "dismissed"), or put it back ("restore").
  DECIDE: 'decide',
  // Hand a date to dayGLANCE as a task.
  SEND: 'send',
  // Navigate: the payload's `link` goes through the link router.
  OPEN: 'open',
  // Read the glance snapshot.
  QUERY: 'query',
} as const

// Reads need no id. Everything else is a write and does.
const READS = new Set<string>([INTENT_ACTIONS.OPEN, INTENT_ACTIONS.QUERY])
const KNOWN = new Set<string>(Object.values(INTENT_ACTIONS))
// The key each write's entity is reported under.
const ENTITY_KEY: Record<string, 'thing_id' | 'coverage_id' | 'plan_id' | 'event_key'> = {
  [INTENT_ACTIONS.CREATE_THING]: 'thing_id',
  [INTENT_ACTIONS.ADD_COVERAGE]: 'coverage_id',
  [INTENT_ACTIONS.CREATE_PLAN]: 'plan_id',
  [INTENT_ACTIONS.DECIDE]: 'event_key',
  [INTENT_ACTIONS.SEND]: 'event_key',
}

export type IntentErrorCode = 'unknown_action' | 'client_id_required' | 'invalid' | 'not_found' | 'unavailable' | 'failed'

// Plain keys, so it serializes as it is for any transport.
export interface IntentResult {
  success: boolean
  code?: IntentErrorCode
  error?: string
  // True when this id was already applied: nothing changed this time.
  deduped?: boolean
  thing_id?: string
  coverage_id?: string
  plan_id?: string
  event_key?: string
  snapshot?: GlanceSnapshot
  [k: string]: unknown
}

export interface ExternalWrite {
  action: string
  payload?: Record<string, unknown>
  clientId?: string
}

export type EntityKind = 'thing' | 'coverage' | 'plan'

export interface IntentContext {
  // A thing as this device may see it (another member's private thing is not there).
  getThing?: (id: string) => Promise<Thing | null>
  // Whether a row of this kind already has this id.
  entityExists?: (id: string, kind: EntityKind) => Promise<boolean>
  members?: () => Promise<Member[]>
  createThing?: (input: ThingInput, id?: string) => Promise<{ id: string }>
  saveCoverage?: (input: CoverageInput, id?: string) => Promise<{ id: string }>
  savePlan?: (input: SubscriptionInput, id?: string) => Promise<{ id: string }>
  // A date on the horizon, as this device may see it.
  findEvent?: (key: string) => Promise<HorizonEvent | null>
  decide?: (key: string, state: 'dismissed' | 'done') => Promise<void>
  undecide?: (key: string) => Promise<void>
  // Throws with `reason` 'disabled' or 'no-key' when dayGLANCE is not reachable.
  send?: (event: HorizonEvent) => Promise<void>
  navigate?: (target: LinkTarget) => void
  snapshot?: () => Promise<GlanceSnapshot>
}

export interface LedgerIO {
  ledger?: HandledWrite[]
  persist?: (ledger: HandledWrite[]) => void
}

// ── Reading a payload ────────────────────────────────────────────────────────

class Refused extends Error {
  constructor(readonly code: IntentErrorCode, message: string) { super(message) }
}
const invalid = (message: string): never => { throw new Refused('invalid', message) }

function reader(p: Record<string, unknown>) {
  const has = (k: string) => p[k] !== undefined && p[k] !== null && p[k] !== ''
  return {
    str(k: string, required = false, max = 200): string | undefined {
      if (!has(k)) return required ? invalid(`"${k}" is required`) : undefined
      const v = p[k]
      if (typeof v !== 'string' || !v.trim()) return invalid(`"${k}" must be text`)
      if (v.length > max) return invalid(`"${k}" is too long`)
      return v.trim()
    },
    // A number, or text that is nothing but a plain decimal (automation
    // tools hand everything over as text). Bounded, so nothing downstream has
    // to cope with a figure no date or total can hold.
    num(k: string, required = false, opts: { max?: number; min?: number; whole?: boolean } = {}): number | undefined {
      if (!has(k)) return required ? invalid(`"${k}" is required`) : undefined
      const raw = p[k]
      const v = typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : raw
      const min = opts.min ?? 0
      const max = opts.max ?? MAX_AMOUNT
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return invalid(`"${k}" must be a number from ${min} to ${max}`)
      if (opts.whole && !Number.isInteger(v)) return invalid(`"${k}" must be a whole number`)
      return v
    },
    day(k: string, required = false): string | undefined {
      if (!has(k)) return required ? invalid(`"${k}" is required`) : undefined
      return isDay(p[k]) ? p[k] : invalid(`"${k}" must be a real date like 2027-01-15`)
    },
    bool(k: string): boolean | undefined {
      if (!has(k)) return undefined
      return typeof p[k] === 'boolean' ? p[k] : invalid(`"${k}" must be true or false`)
    },
    oneOf<T extends string>(k: string, allowed: readonly T[]): T | undefined {
      if (!has(k)) return undefined
      return (allowed as readonly unknown[]).includes(p[k]) ? (p[k] as T) : invalid(`"${k}" must be one of: ${allowed.join(', ')}`)
    },
    ids(k: string): string[] {
      if (!has(k)) return []
      const v = p[k]
      if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !x)) return invalid(`"${k}" must be a list of ids`)
      return [...new Set(v as string[])]
    },
  }
}

// The most any amount of money may be. Far above any real price, far below
// where totals stop being exact.
export const MAX_AMOUNT = 1_000_000_000

const isUuid = (v: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)

async function memberOrRefuse(id: string | undefined, key: string, ctx: IntentContext): Promise<string | null> {
  if (!id) return null
  if (ctx.members && !(await ctx.members()).some((m) => m.id === id)) throw new Refused('not_found', `"${key}": no household member with that id`)
  return id
}

// ── The actions ──────────────────────────────────────────────────────────────

const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as readonly CategoryId[]
const COVERAGE_TYPES: readonly CoverageType[] = ['warranty', 'extended', 'insurance']
const CYCLES: readonly Cycle[] = ['weekly', 'monthly', 'quarterly', 'yearly']

// A create whose caller-chosen id is a UUID uses it as the row's id. If a row
// of that kind is already there, the write has landed (here or on another
// device). Asked before anything in the payload is looked at: a retry has to
// be told its write landed even if what it pointed at has since gone.
async function claimId(clientId: string, kind: EntityKind, ctx: IntentContext): Promise<{ id?: string; exists: boolean }> {
  if (!isUuid(clientId)) return { exists: false }
  return { id: clientId, exists: !!(await ctx.entityExists?.(clientId, kind)) }
}

async function createThing(p: Record<string, unknown>, clientId: string, ctx: IntentContext): Promise<IntentResult> {
  const { id, exists } = await claimId(clientId, 'thing', ctx)
  if (exists) return { success: true, deduped: true, thing_id: id }
  const r = reader(p)
  const name = r.str('name', true)!
  const supportEnd = r.day('support_end')
  const input: ThingInput = {
    name,
    category: r.oneOf('category', CATEGORY_IDS) ?? guessCategory(name) ?? 'other',
    status: 'active',
    brand: r.str('brand'), model: r.str('model'), retailer: r.str('retailer'), notes: r.str('notes', false, 2000),
    purchaseDate: r.day('purchase_date'), price: r.num('price'), lifespanMonths: r.num('lifespan_months', false, { min: 1, max: MAX_LIFESPAN_MONTHS, whole: true }),
    supportEnd, supportBasis: supportEnd ? 'manual' : undefined,
    ownerMemberId: await memberOrRefuse(r.str('owner_member_id'), 'owner_member_id', ctx),
    responsibleMemberId: null,
    visibility: 'shared',
  }
  if (!ctx.createThing) return { success: true, thing_id: id }
  return { success: true, thing_id: (await ctx.createThing(input, id)).id }
}

async function addCoverage(p: Record<string, unknown>, clientId: string, ctx: IntentContext): Promise<IntentResult> {
  const { id, exists } = await claimId(clientId, 'coverage', ctx)
  if (exists) return { success: true, deduped: true, coverage_id: id }
  const r = reader(p)
  const thingId = r.str('thing_id', true)!
  const input: CoverageInput = {
    thingId, name: r.str('name', true)!, endDate: r.day('end_date', true)!,
    type: r.oneOf('type', COVERAGE_TYPES) ?? 'warranty',
    startDate: r.day('start_date'), provider: r.str('provider'), cost: r.num('cost'), notes: r.str('notes', false, 2000),
  }
  if (input.startDate && input.startDate > input.endDate) invalid('"start_date" is after "end_date"')
  if (ctx.getThing && !(await ctx.getThing(thingId))) throw new Refused('not_found', 'No thing with that id on this device')
  if (!ctx.saveCoverage) return { success: true, coverage_id: id }
  return { success: true, coverage_id: (await ctx.saveCoverage(input, id)).id }
}

async function createPlan(p: Record<string, unknown>, clientId: string, ctx: IntentContext): Promise<IntentResult> {
  const { id, exists } = await claimId(clientId, 'plan', ctx)
  if (exists) return { success: true, deduped: true, plan_id: id }
  const r = reader(p)
  const status = r.oneOf('status', ['active', 'trial'] as const) ?? 'active'
  const trialEnd = r.day('trial_end')
  if (status === 'trial' && !trialEnd) invalid('"trial_end" is required for a trial')
  const thingIds = r.ids('thing_ids')
  const input: SubscriptionInput = {
    name: r.str('name', true)!, amount: r.num('amount', true)!,
    cycle: r.oneOf('cycle', CYCLES) ?? 'monthly',
    anchorDate: r.day('anchor_date') ?? today(),
    autoRenew: r.bool('auto_renew') ?? true,
    status, trialEnd: status === 'trial' ? trialEnd : undefined,
    review: r.bool('review') ?? false,
    provider: r.str('provider'), notes: r.str('notes', false, 2000),
    coversThingIds: thingIds, coversMemberIds: [],
    payerMemberId: await memberOrRefuse(r.str('payer_member_id'), 'payer_member_id', ctx),
    responsibleMemberId: null,
    visibility: 'shared',
  }
  if (ctx.getThing) for (const id of thingIds) if (!(await ctx.getThing(id))) throw new Refused('not_found', `"thing_ids": no thing with id ${id} on this device`)
  if (!ctx.savePlan) return { success: true, plan_id: id }
  return { success: true, plan_id: (await ctx.savePlan(input, id)).id }
}

async function eventOrRefuse(key: string, ctx: IntentContext): Promise<HorizonEvent | null> {
  if (!ctx.findEvent) return null
  const e = await ctx.findEvent(key)
  if (!e) throw new Refused('not_found', 'No date with that key on this device')
  return e
}

async function decide(p: Record<string, unknown>, ctx: IntentContext): Promise<IntentResult> {
  const r = reader(p)
  const key = r.str('event_key', true, 300)!
  const state = r.oneOf('state', ['done', 'dismissed', 'restore'] as const) ?? 'done'
  await eventOrRefuse(key, ctx)
  if (state === 'restore') await ctx.undecide?.(key)
  else await ctx.decide?.(key, state)
  return { success: true, event_key: key, state }
}

async function send(p: Record<string, unknown>, ctx: IntentContext): Promise<IntentResult> {
  const key = reader(p).str('event_key', true, 300)!
  const event = await eventOrRefuse(key, ctx)
  if (event && ctx.send) {
    try {
      await ctx.send(event)
    } catch (err) {
      const reason = (err as { reason?: string })?.reason
      if (reason === 'disabled') throw new Refused('unavailable', 'dayGLANCE is not connected in thingGLANCE yet')
      if (reason === 'no-key') throw new Refused('unavailable', 'thingGLANCE needs its sync passphrase before it can send')
      throw new Refused('failed', 'Could not reach GLANCEvault; the task was not sent')
    }
  }
  return { success: true, event_key: key }
}

function open(p: Record<string, unknown>, ctx: IntentContext): IntentResult {
  const target = parseLink(reader(p).str('link', true, 2000))
  if (!target) return invalid('"link" is not a thingGLANCE link')
  ctx.navigate?.(target)
  return { success: true }
}

async function query(ctx: IntentContext): Promise<IntentResult> {
  return ctx.snapshot ? { success: true, snapshot: await ctx.snapshot() } : { success: true }
}

// ── The handler ──────────────────────────────────────────────────────────────

// Two copies of one write arriving together share one application: the ledger
// only knows about a write once it has finished.
const inFlight = new Map<string, Promise<IntentResult>>()

const refused = (code: IntentErrorCode, error: string): IntentResult => ({ success: false, code, error })

export async function handleIntent(write: ExternalWrite, ctx: IntentContext = {}, io: LedgerIO = {}): Promise<IntentResult> {
  if (!write || typeof write !== 'object') return refused('invalid', 'A write is an object with an action')
  const { action, clientId } = write
  const payload = write.payload && typeof write.payload === 'object' ? write.payload : {}
  if (!KNOWN.has(action)) return refused('unknown_action', `Unknown action: ${String(action)}`)

  const run = async (): Promise<IntentResult> => {
    try {
      switch (action) {
        case INTENT_ACTIONS.CREATE_THING: return await createThing(payload, clientId!, ctx)
        case INTENT_ACTIONS.ADD_COVERAGE: return await addCoverage(payload, clientId!, ctx)
        case INTENT_ACTIONS.CREATE_PLAN: return await createPlan(payload, clientId!, ctx)
        case INTENT_ACTIONS.DECIDE: return await decide(payload, ctx)
        case INTENT_ACTIONS.SEND: return await send(payload, ctx)
        case INTENT_ACTIONS.OPEN: return open(payload, ctx)
        default: return await query(ctx)
      }
    } catch (err) {
      if (err instanceof Refused) return refused(err.code, err.message)
      return refused('failed', err instanceof Error ? err.message : String(err))
    }
  }
  if (READS.has(action)) return run()

  if (typeof clientId !== 'string' || !clientId.trim() || clientId.length > 200) {
    return refused('client_id_required', 'Every write needs a clientId: an id you choose, sent again unchanged if you retry')
  }
  const running = inFlight.get(clientId)
  if (running) return running

  const ledger = io.ledger ?? readLedger()
  const prior = findHandled(ledger, clientId)
  if (prior) {
    // One id names one write. The same id on a different action is a caller's
    // mistake, and answering "already done" would hide that nothing happened.
    if (prior.action !== action) return refused('invalid', `This clientId was already used for "${prior.action}". Every write needs its own.`)
    const again: IntentResult = { success: true, deduped: true, ...(prior.extra ?? {}) }
    const key = ENTITY_KEY[prior.action]
    if (key && prior.entityId) again[key] = prior.entityId
    return again
  }

  const work = run().then((result) => {
    if (result.success) {
      const entityId = result[ENTITY_KEY[action]]
      const persist = io.persist ?? ((next: HandledWrite[]) => writeLedger(next))
      // Read again: another write may have been recorded while this one ran.
      const extra = typeof result.state === 'string' ? { state: result.state } : undefined
      persist(recordHandled(io.ledger ?? readLedger(), { clientId, action, entityId: typeof entityId === 'string' ? entityId : null, at: new Date().toISOString(), ...(extra ? { extra } : {}) }))
    }
    return result
  }).finally(() => inFlight.delete(clientId))
  inFlight.set(clientId, work)
  return work
}
