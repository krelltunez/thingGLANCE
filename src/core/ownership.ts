// "Owned since": the record that the app was bought (types.ts: Ownership).
// Pure helpers; the shell that knows whether it was bought is
// src/native/ownership.ts, and the write is recordOwnership() in db/queries.ts.

import type { Iso, Ownership } from './types'

export const ownershipId = (deviceId: string): string => `owned:${deviceId}`

// What a shell reports: the store that installed the app, and when.
export interface OwnershipFact {
  since: Iso
  store: string
  version: string
}

// The row for a device, given what is already held for it. A device's date
// only ever moves earlier: a reinstall reports a later first install, and the
// purchase is as old as the oldest one seen. Answers null when nothing would
// change, so an unchanged fact is not written (and not synced) again.
export function ownershipRow(current: Ownership | undefined, deviceId: string, fact: OwnershipFact, now: Iso): Ownership | null {
  const since = current && current.since <= fact.since ? current.since : fact.since
  // The store and version stay with the date they were recorded with.
  const kept = current && current.since <= fact.since
  const store = kept ? current.store : fact.store
  const version = kept ? current.version : fact.version
  if (current && current.since === since && current.store === store && current.version === version) return null
  return { id: ownershipId(deviceId), kind: 'owned', deviceId, since, store, version, createdAt: current?.createdAt ?? now, updatedAt: now }
}

// The earliest purchase among the rows this device holds (its own, and the
// household's other devices once a vault is connected), or null with none.
export function ownedSince(rows: Ownership[]): Ownership | null {
  return rows.reduce<Ownership | null>((first, row) => (!first || row.since < first.since ? row : first), null)
}
