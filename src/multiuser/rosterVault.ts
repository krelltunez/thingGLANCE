// The household roster on GLANCEvault: the `glance-users` app that every
// GLANCE app (dayGLANCE, lastGLANCE, lifeGLANCE, and now thingGLANCE) reads
// and writes, so a member added in one app reaches the others.
//
// The wire contract, shared with the sibling apps (see lastGLANCE's
// src/multiuser/rosterVault.ts, which this mirrors):
//   app       glance-users
//   entityId  the member's id
//   entity    { id, name, updatedAt: ISO string }
//   delete    the engine's soft-delete
// Entities are encrypted under the account's root key, which every app on the
// account already shares.

import { createDbSyncEngine } from '@glance-apps/sync'
import type { DbSyncEngine, DbSyncResult, SyncErrorCode } from '@glance-apps/sync'
import { db } from '@/db/client'
import type { Member } from '@/core/types'
import { APP_ID, getVaultConfig, isVaultEnabled } from '@/sync/vaultConfig'
import { getDeviceId } from '@/sync/deviceId'
import { CRYPTO_DB_NAME, isUnknownAppError } from '@/sync/dbEngine'
import { getMultiUserEnabled } from './settings'

export const ROSTER_VAULT_APP = 'glance-users'
// Per-app local state (cursor, dirty set, seed flag); the vault app is shared.
const STORAGE_PREFIX = `${APP_ID}-${ROSTER_VAULT_APP}`
const SEEDED_FLAG = `${STORAGE_PREFIX}-db-sync-snapshot-seeded`

// Reads a roster row another app wrote. Strict about what makes it a member
// (a name, and an id that is its own), forgiving about the timestamp: a row
// from an older build may carry epoch milliseconds or none at all, and losing
// a household member over that would be the worse failure. A row with no
// timestamp reads as the oldest possible, so any later edit wins.
export function readRosterEntity(entityId: string, entity: unknown): Member | null {
  if (!entity || typeof entity !== 'object') return null
  const e = entity as Record<string, unknown>
  if (typeof e.name !== 'string' || !e.name.trim()) return null
  if (e.id != null && e.id !== entityId) return null
  const at = e.updatedAt
  const updatedAt = typeof at === 'string' && at ? at
    : typeof at === 'number' && Number.isFinite(at) ? new Date(at).toISOString()
    : new Date(0).toISOString()
  return { id: entityId, name: e.name, updatedAt }
}

const notifyApplied = () => { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tg:sync-applied')) }

// Upsert by id. A member this device deleted later than the remote edit stays
// deleted: the local tombstone is newer and its soft-delete is on the way up.
async function applyRemoteRosterEntity(entityId: string, raw: unknown, onRejected: () => void): Promise<void> {
  const entity = readRosterEntity(entityId, raw)
  if (!entity) { onRejected(); return }
  const changed = await db.transaction('rw', db.members, db.tombstones, async () => {
    const tomb = await db.tombstones.get(entityId)
    const existing = await db.members.get(entityId)
    if (!existing && tomb && tomb.deletedAt >= entity.updatedAt) return false
    if (existing && existing.updatedAt >= entity.updatedAt) return false
    if (tomb) await db.tombstones.delete(entityId)
    await db.members.put({ id: entityId, name: entity.name, updatedAt: entity.updatedAt })
    return true
  })
  if (changed) notifyApplied()
}

async function applyRemoteRosterDelete(entityId: string): Promise<void> {
  await db.transaction('rw', db.members, db.tombstones, async () => {
    await db.tombstones.put({ id: entityId, deletedAt: new Date().toISOString() })
    await db.members.delete(entityId)
  })
  notifyApplied()
}

export interface RosterCallbacks {
  onError?: (message: string | null, code: SyncErrorCode | null) => void
  onUnsupported?: () => void
  // A cycle finished, well or badly. Lets the UI say "checked, and the vault's
  // roster is empty" instead of leaving an empty list unexplained.
  // `skipped` rows would not decrypt; `rejected` rows decrypted but were not a
  // member. `ran` is false when the engine did not actually read the vault
  // this time (it is pausing after a failure): a cycle like that reports no
  // error and no rows, and must not be read as "the roster is empty".
  onChecked?: (outcome: { error: string | null; skipped: number; rejected: number; ran: boolean }) => void
  // What the server's own list says about glance-users: false when it leaves
  // the app out, true when it lists it, null when unknown. Asked before every
  // cycle, so a server that is fixed is picked up without a reload.
  allowed?: () => boolean | null
}

const EMPTY = { applied: 0, skipped: 0, skippedEntityIds: [] } as DbSyncResult

// Null when the vault is off. A cycle is a no-op while multi-user is off on
// this device: there is no household to share.
export function createRosterDbEngine(callbacks: RosterCallbacks = {}): DbSyncEngine | null {
  if (!isVaultEnabled()) return null
  const cfg = getVaultConfig()!
  let unsupported = false
  let failed: string | null = null
  let rejected = 0

  const engine = createDbSyncEngine({
    storageKeyPrefix: STORAGE_PREFIX,
    appId: ROSTER_VAULT_APP,
    vaultApp: ROSTER_VAULT_APP,
    cryptoDBName: CRYPTO_DB_NAME,
    vaultUrl: cfg.vaultUrl,
    vaultToken: cfg.vaultToken,
    accountId: cfg.accountId,
    deviceId: `${getDeviceId()}-roster`,
    getLocalEntity: async (id) => (await db.members.get(id)) ?? null,
    applyRemoteEntity: (id, entity) => applyRemoteRosterEntity(id, entity, () => { rejected += 1 }),
    applyRemoteDelete: applyRemoteRosterDelete,
    isInsertOnly: () => false,
    getEntityLastModified: (e) => (e as { updatedAt?: string } | null)?.updatedAt,
    pullCursorCommit: 'per-page',
    onError: (message, code) => {
      // A server that does not list glance-users refuses every request for
      // it with a 400. On a pull that reads as "unknown app"; on the key
      // check that runs first it surfaces as VERIFIER_UNSUPPORTED instead.
      if (isUnknownAppError(message) || code === 'VERIFIER_UNSUPPORTED') {
        if (!unsupported) { unsupported = true; callbacks.onUnsupported?.() }
        return
      }
      if (message) failed = message
      callbacks.onError?.(message, code)
    },
  })

  const runCycle = engine.dbSyncCycle.bind(engine)
  const dbSyncCycle = async (): Promise<DbSyncResult> => {
    if (!getMultiUserEnabled()) return EMPTY
    const allowed = callbacks.allowed?.() ?? null
    if (allowed === false) {
      if (!unsupported) { unsupported = true; callbacks.onUnsupported?.() }
      return EMPTY
    }
    // The server lists the app now: whatever latched earlier no longer holds.
    if (allowed === true) unsupported = false
    if (unsupported) return EMPTY
    if (localStorage.getItem(SEEDED_FLAG) !== '1') {
      if (engine.getHighWaterMark() > 0) {
        localStorage.setItem(SEEDED_FLAG, '1')
      } else {
        try {
          for (const u of await db.members.toArray()) engine.markDirty(u.id)
          localStorage.setItem(SEEDED_FLAG, '1')
        } catch (err) {
          console.warn('[thingglance] roster initial snapshot failed:', err)
        }
      }
    }
    failed = null
    rejected = 0
    try {
      const result = await runCycle()
      // No result is an overlapping cycle; the flags are the engine saying a
      // half of the cycle was held back or failed.
      const flags = result as (DbSyncResult & { pullSkipped?: boolean; pullFailed?: boolean; halted?: boolean; superseded?: boolean }) | undefined
      const ran = !!flags && !flags.pullSkipped && !flags.pullFailed && !flags.halted && !flags.superseded
      if (!unsupported) callbacks.onChecked?.({ error: failed, skipped: result?.skipped ?? 0, rejected, ran })
      return result
    } catch (err) {
      callbacks.onChecked?.({ error: failed ?? (err instanceof Error ? err.message : 'The roster could not be read.'), skipped: 0, rejected, ran: false })
      throw err
    }
  }

  return { ...engine, dbSyncCycle, sync: dbSyncCycle }
}
