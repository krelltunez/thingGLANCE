// What an assistant may change (docs/mcp.md): the page's half of the MCP write
// tools. Every change goes through the same functions the app's forms call
// (src/db/queries.ts), so it is stamped, marked for sync and promotes sample
// rows exactly as a tap in the app would. Nothing is ever deleted by a tool.
//
// The three creates and "decide" go through dispatchExternalWrite(), the one
// door every write from outside uses: its validation is the widgets' and
// Tasker's, and its ledger makes a retried create one row. The edits have no
// such door, so they are validated here, against the same rules the forms
// keep.
//
// Each change answers with the entity as it now stands and an undo record:
// what to do to take it back. Only the page has the before-state, so only the
// page can build it. The main process keeps the records for the session
// (electron/mcpJournal.ts) and hands them back to undoWrites().
//
// An assistant acts as this device's member. It cannot see or change another
// member's private thing: the read it starts from has been through visibleTo().

import { CATEGORIES } from '@/core/categories'
import { isDay } from '@/core/dates'
import { MAX_LIFESPAN_MONTHS } from '@/core/health'
import type { CategoryId, Cycle, Decision, Subscription, Thing } from '@/core/types'
import { db } from '@/db/client'
import { decide, deleteCoverage, deleteSubscription, deleteThing, patchSubscription, retireThing, reviveThing, undecide, updateThing, type SubscriptionInput, type ThingInput } from '@/db/queries'
import { MAX_AMOUNT, type ExternalWrite, type IntentResult } from '@/intents/handleIntent'
import { dispatchExternalWrite } from '@/intents/inbound'
import { readData } from './readData'
import { planSummary, thingDetail, type ReadData } from './readModel'

export type UndoOp =
  | { kind: 'remove_created_thing'; thingId: string }
  | { kind: 'restore_thing_fields'; thingId: string; before: Record<string, unknown> }
  | { kind: 'remove_created_coverage'; thingId: string; coverageId: string }
  | { kind: 'remove_created_plan'; planId: string }
  | { kind: 'restore_plan_fields'; planId: string; before: Record<string, unknown> }
  | { kind: 'restore_decision'; eventKey: string; before: Decision['state'] | null; taskId?: string }

export type WriteAnswer =
  | { ok: true; data: Record<string, unknown>; undo?: { summary: string; op: UndoOp } }
  | { ok: false; error: { code: 'validation' | 'not_found' | 'internal'; message: string } }

// What the model works through. The live ones are the app's own; a test hands
// in its own.
export interface WriteDeps {
  read: () => Promise<ReadData>
  dispatch: (write: ExternalWrite) => Promise<IntentResult>
  updateThing: (id: string, patch: Partial<ThingInput>) => Promise<void>
  retireThing: (id: string, resaleValue?: number) => Promise<void>
  reviveThing: (id: string) => Promise<void>
  patchPlan: (id: string, patch: Partial<SubscriptionInput>) => Promise<void>
  deleteThing: (id: string) => Promise<void>
  deleteCoverage: (id: string) => Promise<void>
  deletePlan: (id: string) => Promise<void>
  decide: (key: string, state: Decision['state'], taskId?: string) => Promise<unknown>
  undecide: (key: string) => Promise<void>
  decisionFor: (key: string) => Promise<Decision | null>
  coverageExists: (id: string) => Promise<boolean>
}

export const liveWriteDeps: WriteDeps = {
  read: readData,
  dispatch: dispatchExternalWrite,
  updateThing, retireThing, reviveThing,
  patchPlan: patchSubscription,
  deleteThing, deleteCoverage,
  deletePlan: deleteSubscription,
  decide, undecide,
  decisionFor: async (key) => (await db.decisions.where('eventKey').equals(key).toArray()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null,
  coverageExists: async (id) => !!(await db.coverages.get(id)),
}

class Invalid extends Error {
  constructor(readonly code: 'validation' | 'not_found', message: string) { super(message) }
}
const invalid = (message: string): never => { throw new Invalid('validation', message) }

const fromIntent = (r: IntentResult): WriteAnswer => ({
  ok: false,
  error: { code: r.code === 'invalid' || r.code === 'client_id_required' ? 'validation' : r.code === 'not_found' ? 'not_found' : 'internal', message: r.error ?? 'thingGLANCE could not make that change.' },
})

// ── Reading an edit ──────────────────────────────────────────────────────────
// An edit names only the fields it changes. A field left out is untouched;
// null clears one that can be empty.

const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as readonly CategoryId[]
const CYCLES: readonly Cycle[] = ['weekly', 'monthly', 'quarterly', 'yearly']

function fields(p: Record<string, unknown>, d: ReadData) {
  const given = (k: string) => p[k] !== undefined
  const text = (k: string, max = 200, required = false): string | undefined => {
    const v = p[k]
    if (v === null || v === '') return required ? invalid(`"${k}" cannot be empty`) : undefined
    if (typeof v !== 'string' || !v.trim()) return invalid(`"${k}" must be text`)
    if (v.length > max) return invalid(`"${k}" is too long`)
    return v.trim()
  }
  const day = (k: string, required = false): string | undefined => {
    if (p[k] === null) return required ? invalid(`"${k}" cannot be empty`) : undefined
    return isDay(p[k]) ? p[k] : invalid(`"${k}" must be a real date like 2027-01-15`)
  }
  const amount = (k: string, required = false, opts: { min?: number; max?: number; whole?: boolean } = {}): number | undefined => {
    const v = p[k]
    if (v === null) return required ? invalid(`"${k}" cannot be empty`) : undefined
    const min = opts.min ?? 0, max = opts.max ?? MAX_AMOUNT
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return invalid(`"${k}" must be a number from ${min} to ${max}`)
    if (opts.whole && !Number.isInteger(v)) return invalid(`"${k}" must be a whole number`)
    return v
  }
  const bool = (k: string): boolean => (typeof p[k] === 'boolean' ? (p[k] as boolean) : invalid(`"${k}" must be true or false`))
  const oneOf = <T extends string>(k: string, allowed: readonly T[]): T =>
    ((allowed as readonly unknown[]).includes(p[k]) ? (p[k] as T) : invalid(`"${k}" must be one of: ${allowed.join(', ')}`))
  // A household member's id, or null for the household (or for nobody in particular).
  const member = (k: string): string | null => {
    const v = p[k]
    if (v === null) return null
    if (typeof v === 'string' && d.members.some((m) => m.id === v)) return v
    throw new Invalid('not_found', `"${k}": no household member with that id. Use thingglance_list_members.`)
  }
  const things = (k: string): string[] => {
    const v = p[k]
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) return invalid(`"${k}" must be a list of thing ids`)
    const ids = [...new Set(v as string[])]
    for (const id of ids) if (!d.data.things.some((t) => t.id === id)) throw new Invalid('not_found', `"${k}": no thing with id ${id}. Use thingglance_list_things.`)
    return ids
  }
  return { given, text, day, amount, bool, oneOf, member, things }
}

// The value a field had, as an undo record can carry it: JSON has no
// "absent", so an optional field that was not set is recorded as null.
const was = <T extends object>(row: T, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]))
// ...and back. The member fields are the ones where null is itself a value.
const MEMBER_FIELDS = new Set(['ownerMemberId', 'responsibleMemberId', 'payerMemberId'])
const restored = (before: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v === null && !MEMBER_FIELDS.has(k) ? undefined : v]))

const changedKeys = (cur: object, patch: Record<string, unknown>): string[] =>
  Object.keys(patch).filter((k) => JSON.stringify((cur as Record<string, unknown>)[k] ?? null) !== JSON.stringify(patch[k] ?? null))

const thingOr = (d: ReadData, id: unknown): Thing => {
  const t = typeof id === 'string' ? d.data.things.find((x) => x.id === id) : undefined
  if (!t) throw new Invalid('not_found', 'No thing with that id. Use thingglance_list_things.')
  return t
}
const planOr = (d: ReadData, id: unknown): Subscription => {
  const s = typeof id === 'string' ? d.data.subscriptions.find((x) => x.id === id) : undefined
  if (!s) throw new Invalid('not_found', 'No plan with that id. Use thingglance_list_plans.')
  return s
}

// ── The changes ──────────────────────────────────────────────────────────────

async function created(deps: WriteDeps, action: string, payload: Record<string, unknown>, newId: unknown): Promise<IntentResult> {
  if (typeof newId !== 'string' || !newId) throw new Invalid('validation', 'A create needs an id for the new row.')
  return deps.dispatch({ action, payload, clientId: newId })
}

async function createThing(p: Record<string, unknown>, deps: WriteDeps): Promise<WriteAnswer> {
  const { new_id, ...payload } = p
  const r = await created(deps, 'create_thing', payload, new_id)
  if (!r.success || !r.thing_id) return fromIntent(r)
  const d = await deps.read()
  const thing = thingOr(d, r.thing_id)
  return {
    ok: true,
    data: { thing: thingDetail(d, thing), created: !r.deduped },
    ...(r.deduped ? {} : { undo: { summary: `Added "${thing.name}"`, op: { kind: 'remove_created_thing', thingId: thing.id } } }),
  }
}

async function addCoverage(p: Record<string, unknown>, deps: WriteDeps): Promise<WriteAnswer> {
  const { new_id, ...payload } = p
  const before = await deps.read()
  const thing = thingOr(before, payload.thing_id)
  const r = await created(deps, 'add_coverage', payload, new_id)
  if (!r.success || !r.coverage_id) return fromIntent(r)
  const d = await deps.read()
  const row = d.data.coverages.find((c) => c.id === r.coverage_id)
  return {
    ok: true,
    data: { coverage_id: r.coverage_id, created: !r.deduped, thing: thingDetail(d, thingOr(d, thing.id)) },
    ...(r.deduped ? {} : { undo: { summary: `Added coverage "${row?.name ?? ''}" to "${thing.name}"`, op: { kind: 'remove_created_coverage', thingId: thing.id, coverageId: r.coverage_id } } }),
  }
}

async function createPlan(p: Record<string, unknown>, deps: WriteDeps): Promise<WriteAnswer> {
  const { new_id, ...payload } = p
  const r = await created(deps, 'create_plan', payload, new_id)
  if (!r.success || !r.plan_id) return fromIntent(r)
  const d = await deps.read()
  const plan = planOr(d, r.plan_id)
  return {
    ok: true,
    data: { plan: planSummary(d, plan), created: !r.deduped },
    ...(r.deduped ? {} : { undo: { summary: `Added the plan "${plan.name}"`, op: { kind: 'remove_created_plan', planId: plan.id } } }),
  }
}

async function updateThingFields(p: Record<string, unknown>, deps: WriteDeps): Promise<WriteAnswer> {
  const d = await deps.read()
  const cur = thingOr(d, p.thing_id)
  const f = fields(p, d)
  const patch: Record<string, unknown> = {}
  if (f.given('name')) patch.name = f.text('name', 200, true)
  if (f.given('category')) patch.category = f.oneOf('category', CATEGORY_IDS)
  for (const [key, field] of [['brand', 'brand'], ['model', 'model'], ['retailer', 'retailer']] as const) if (f.given(key)) patch[field] = f.text(key)
  if (f.given('notes')) patch.notes = f.text('notes', 2000)
  if (f.given('purchase_date')) patch.purchaseDate = f.day('purchase_date')
  if (f.given('release_date')) patch.releaseDate = f.day('release_date')
  if (f.given('price')) patch.price = f.amount('price')
  if (f.given('lifespan_months')) patch.lifespanMonths = f.amount('lifespan_months', false, { min: 1, max: MAX_LIFESPAN_MONTHS, whole: true })
  if (f.given('support_end')) {
    patch.supportEnd = f.day('support_end')
    // A date someone typed is theirs, not the maker's published one.
    patch.supportBasis = patch.supportEnd ? 'manual' : undefined
  }
  if (f.given('pinned')) patch.pinned = f.bool('pinned') || undefined
  if (f.given('visibility')) {
    patch.visibility = f.oneOf('visibility', ['shared', 'private'] as const)
    // As in the form: only something that is somebody's can be private.
    if (patch.visibility === 'private' && cur.ownerMemberId === null) invalid('A thing the household owns cannot be private. Give it an owner first (thingglance_reassign_thing).')
  }
  if (f.given('retired')) {
    const retired = f.bool('retired')
    patch.status = retired ? 'retired' : 'active'
    if (!retired) { patch.retiredAt = undefined; patch.resaleValue = undefined }
  }
  if (f.given('resale_value')) {
    if ((patch.status ?? cur.status) !== 'retired') invalid('"resale_value" is for a retired thing: send "retired": true with it.')
    patch.resaleValue = f.amount('resale_value')
  }
  const keys = changedKeys(cur, patch)
  if (!keys.length) return { ok: true, data: { thing: thingDetail(d, cur), changed: [] } }
  // Retiring stamps the day; that is part of what an undo puts back.
  const before = was(cur, [...new Set([...keys, ...(keys.includes('status') ? ['retiredAt', 'resaleValue'] : [])])])
  if (keys.includes('status')) {
    if (patch.status === 'retired') await deps.retireThing(cur.id, patch.resaleValue as number | undefined)
    else await deps.reviveThing(cur.id)
  }
  const rest = Object.fromEntries(keys.filter((k) => k !== 'status' && !(k === 'resaleValue' && keys.includes('status')) && k !== 'retiredAt').map((k) => [k, patch[k]]))
  if (Object.keys(rest).length) await deps.updateThing(cur.id, rest as Partial<ThingInput>)
  const after = await deps.read()
  return {
    ok: true,
    data: { thing: thingDetail(after, thingOr(after, cur.id)), changed: keys },
    undo: { summary: `Edited "${cur.name}"`, op: { kind: 'restore_thing_fields', thingId: cur.id, before } },
  }
}

async function reassignThing(p: Record<string, unknown>, deps: WriteDeps): Promise<WriteAnswer> {
  const d = await deps.read()
  const cur = thingOr(d, p.thing_id)
  const f = fields(p, d)
  if (!f.given('owner_member_id') && !f.given('responsible_member_id')) invalid('Give "owner_member_id", "responsible_member_id" or both.')
  const patch: Record<string, unknown> = {}
  if (f.given('owner_member_id')) patch.ownerMemberId = f.member('owner_member_id')
  if (f.given('responsible_member_id')) patch.responsibleMemberId = f.member('responsible_member_id')
  // Handing a private thing to the household would leave it hidden from everyone.
  if (patch.ownerMemberId === null && cur.visibility === 'private') patch.visibility = 'shared'
  const keys = changedKeys(cur, patch)
  if (!keys.length) return { ok: true, data: { thing: thingDetail(d, cur), changed: [] } }
  await deps.updateThing(cur.id, Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<ThingInput>)
  const after = await deps.read()
  // The new owner may have made it private to someone else's device: it is
  // then no longer this member's to see.
  const now = after.data.things.find((t) => t.id === cur.id)
  return {
    ok: true,
    data: { thing: now ? thingDetail(after, now) : null, changed: keys },
    undo: { summary: `Reassigned "${cur.name}"`, op: { kind: 'restore_thing_fields', thingId: cur.id, before: was(cur, keys) } },
  }
}

async function updatePlanFields(p: Record<string, unknown>, deps: WriteDeps): Promise<WriteAnswer> {
  const d = await deps.read()
  const cur = planOr(d, p.plan_id)
  const f = fields(p, d)
  const patch: Record<string, unknown> = {}
  if (f.given('name')) patch.name = f.text('name', 200, true)
  if (f.given('provider')) patch.provider = f.text('provider')
  if (f.given('notes')) patch.notes = f.text('notes', 2000)
  if (f.given('amount')) patch.amount = f.amount('amount', true)
  if (f.given('cycle')) patch.cycle = f.oneOf('cycle', CYCLES)
  if (f.given('anchor_date')) patch.anchorDate = f.day('anchor_date', true)
  if (f.given('auto_renew')) patch.autoRenew = f.bool('auto_renew')
  if (f.given('review_before_renewal')) patch.review = f.bool('review_before_renewal')
  if (f.given('status')) patch.status = f.oneOf('status', ['active', 'trial', 'cancelled'] as const)
  if (f.given('trial_end')) patch.trialEnd = f.day('trial_end')
  if (f.given('end_date')) patch.endDate = f.day('end_date')
  if (f.given('thing_ids')) patch.coversThingIds = f.things('thing_ids')
  if (f.given('payer_member_id')) patch.payerMemberId = f.member('payer_member_id')
  if (f.given('responsible_member_id')) patch.responsibleMemberId = f.member('responsible_member_id')
  if (f.given('visibility')) patch.visibility = f.oneOf('visibility', ['shared', 'private'] as const)
  const next = { ...cur, ...patch } as Subscription
  if (next.status === 'trial' && !next.trialEnd) invalid('A trial needs "trial_end".')
  if (next.visibility === 'private' && next.payerMemberId === null) invalid('A plan the household pays for cannot be private. Give it a payer first.')
  const keys = changedKeys(cur, patch)
  if (!keys.length) return { ok: true, data: { plan: planSummary(d, cur), changed: [] } }
  await deps.patchPlan(cur.id, Object.fromEntries(keys.map((k) => [k, patch[k]])) as Partial<SubscriptionInput>)
  const after = await deps.read()
  const now = after.data.subscriptions.find((s) => s.id === cur.id)
  return {
    ok: true,
    data: { plan: now ? planSummary(after, now) : null, changed: keys },
    undo: { summary: `Edited the plan "${cur.name}"`, op: { kind: 'restore_plan_fields', planId: cur.id, before: was(cur, keys) } },
  }
}

async function decideEvent(p: Record<string, unknown>, deps: WriteDeps): Promise<WriteAnswer> {
  const key = typeof p.event_key === 'string' ? p.event_key : invalid('"event_key" is required')
  const before = await deps.decisionFor(key)
  // An id of its own each time: the same date can be decided, restored and decided again.
  const clientId = typeof p.new_id === 'string' && p.new_id ? p.new_id : invalid('A change needs an id.')
  const r = await deps.dispatch({ action: 'decide', payload: { event_key: key, state: p.state ?? 'done' }, clientId })
  if (!r.success) return fromIntent(r)
  const after = await deps.decisionFor(key)
  const changed = (before?.state ?? null) !== (after?.state ?? null)
  return {
    ok: true,
    data: { event_key: key, state: after?.state ?? 'open', changed },
    ...(changed && !r.deduped ? { undo: { summary: `Marked a date ${after ? after.state : 'open again'}`, op: { kind: 'restore_decision', eventKey: key, before: before?.state ?? null, ...(before?.taskId ? { taskId: before.taskId } : {}) } } } : {}),
  }
}

// ── Undo ─────────────────────────────────────────────────────────────────────

export interface UndoOutcome { undone: number; skipped: { kind: string; reason: string }[] }

// Takes changes back, in the order given (the journal hands them newest
// first). One that no longer applies (the thing has since been removed in the
// app) is skipped and said so; the rest still run.
export async function undoWrites(ops: unknown, deps: WriteDeps = liveWriteDeps): Promise<UndoOutcome> {
  const out: UndoOutcome = { undone: 0, skipped: [] }
  for (const raw of Array.isArray(ops) ? ops : []) {
    const op = raw as UndoOp
    try {
      const d = await deps.read()
      const hasThing = (id: string) => d.data.things.some((t) => t.id === id)
      const hasPlan = (id: string) => d.data.subscriptions.some((s) => s.id === id)
      const gone = () => { out.skipped.push({ kind: op.kind, reason: 'It is no longer there.' }) }
      switch (op.kind) {
        case 'remove_created_thing': if (!hasThing(op.thingId)) { gone(); continue } await deps.deleteThing(op.thingId); break
        case 'remove_created_coverage': if (!(await deps.coverageExists(op.coverageId))) { gone(); continue } await deps.deleteCoverage(op.coverageId); break
        case 'remove_created_plan': if (!hasPlan(op.planId)) { gone(); continue } await deps.deletePlan(op.planId); break
        case 'restore_thing_fields': {
          if (!hasThing(op.thingId)) { gone(); continue }
          const { status, ...rest } = restored(op.before)
          await deps.updateThing(op.thingId, { ...rest, ...(status ? { status } : {}) } as Partial<ThingInput>)
          break
        }
        case 'restore_plan_fields': if (!hasPlan(op.planId)) { gone(); continue } await deps.patchPlan(op.planId, restored(op.before) as Partial<SubscriptionInput>); break
        case 'restore_decision':
          if (op.before === null) await deps.undecide(op.eventKey)
          else await deps.decide(op.eventKey, op.before, op.taskId)
          break
        default: out.skipped.push({ kind: String((op as { kind?: unknown })?.kind), reason: 'Not a change this version knows how to undo.' }); continue
      }
      out.undone += 1
    } catch {
      out.skipped.push({ kind: String(op?.kind), reason: 'It could not be undone.' })
    }
  }
  return out
}

// Null for a method this model does not answer.
export async function handleWrite(method: string, params: Record<string, unknown> = {}, deps: WriteDeps = liveWriteDeps): Promise<WriteAnswer | null> {
  const run = (fn: (p: Record<string, unknown>, deps: WriteDeps) => Promise<WriteAnswer>) => fn(params, deps).catch((e): WriteAnswer => {
    if (e instanceof Invalid) return { ok: false, error: { code: e.code, message: e.message } }
    return { ok: false, error: { code: 'internal', message: 'thingGLANCE could not make that change.' } }
  })
  switch (method) {
    case 'create_thing': return run(createThing)
    case 'update_thing': return run(updateThingFields)
    case 'reassign_thing': return run(reassignThing)
    case 'add_coverage': return run(addCoverage)
    case 'create_plan': return run(createPlan)
    case 'update_plan': return run(updatePlanFields)
    case 'decide_event': return run(decideEvent)
    case 'undo_mcp_writes': return { ok: true, data: { ...(await undoWrites(params.ops, deps)) } }
    default: return null
  }
}
