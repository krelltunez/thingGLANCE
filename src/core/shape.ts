// Readers that bring a stored or pulled row to the current shape.
//
// v0.1 wrote `ownerIds` (a list) on things, and `thingId` / `payerId` on
// plans. Rows in that shape can still arrive from a backup, from a device that
// has not updated, or from the local database on the first run after an
// update, so every door a row comes in through (the Dexie upgrade, the vault
// apply, backup import) passes it through here. Both readers are idempotent,
// and they keep fields they do not know: a newer build's additions survive a
// round trip through an older one.

import type { Subscription, Thing, Visibility } from './types'

type Loose = Record<string, unknown>

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const strs = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && !!x))] : [])
// Private needs someone to be private to. Without one it would be hidden from
// every device, so it reads as shared.
const visibility = (v: unknown, holder: string | null): Visibility => (v === 'private' && holder ? 'private' : 'shared')

export function normalizeThing(raw: unknown): Thing {
  const { ownerIds, ...r } = raw as Loose
  const legacy = strs(ownerIds)
  // One owner maps across. None, or several, was "everyone": the household.
  const owner = 'ownerMemberId' in r ? str(r.ownerMemberId) : legacy.length === 1 ? legacy[0] : null
  return {
    ...r,
    ownerMemberId: owner,
    responsibleMemberId: str(r.responsibleMemberId),
    visibility: visibility(r.visibility, owner),
  } as Thing
}

export function normalizeSubscription(raw: unknown): Subscription {
  const { thingId, payerId, ...r } = raw as Loose
  const legacyThing = str(thingId)
  const payer = 'payerMemberId' in r ? str(r.payerMemberId) : str(payerId)
  return {
    ...r,
    coversThingIds: Array.isArray(r.coversThingIds) ? strs(r.coversThingIds) : legacyThing ? [legacyThing] : [],
    coversMemberIds: strs(r.coversMemberIds),
    payerMemberId: payer,
    responsibleMemberId: str(r.responsibleMemberId),
    visibility: visibility(r.visibility, payer),
  } as Subscription
}
