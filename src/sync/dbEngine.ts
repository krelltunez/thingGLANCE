// GLANCEvault wiring for thingGLANCE: the row-grained DB engine from
// @glance-apps/sync, bridged to the Dexie tables. Modelled on lastGLANCE's
// src/sync/dbEngine.ts, minus everything the file roads needed.
//
// applyRemoteEntity / applyRemoteDelete write to Dexie DIRECTLY (never through
// src/db/queries.ts), so a remote apply never calls markDirty and cannot loop
// back into a push.

import { createDbSyncEngine } from '@glance-apps/sync'
import type { DbSyncEngine, DbSyncResult, SyncErrorCode, SyncStatus } from '@glance-apps/sync'
import { db } from '@/db/client'
import type { Coverage, Decision, Subscription, SyncEntity, Thing } from '@/core/types'
import { APP_ID, getVaultConfig, isVaultEnabled } from './vaultConfig'
import { getDeviceId } from './deviceId'

export const CRYPTO_DB_NAME = 'thingglance-crypto'
// One root key per account, shared by every vault engine in this app (things
// and the roster) and derived from the same passphrase + salt as the sibling
// GLANCE apps on the account.
export const DB_CRYPTO_CONFIG = { cryptoDBName: CRYPTO_DB_NAME }

// Applies are durable the moment they return (straight into Dexie), so the
// pull cursor may advance per page and a large backlog resumes mid-way.
export const PULL_CURSOR_COMMIT = 'per-page' as const

const SNAPSHOT_SEEDED_FLAG = `${APP_ID}-db-sync-snapshot-seeded`

type Kind = SyncEntity['kind']
const KINDS: Kind[] = ['thing', 'coverage', 'subscription', 'decision']

function kindOf(entity: unknown): Kind | null {
  if (!entity || typeof entity !== 'object') return null
  const k = (entity as { kind?: unknown }).kind
  return typeof k === 'string' && (KINDS as string[]).includes(k) ? (k as Kind) : null
}

export function getEntityLastModified(entity: unknown): string | undefined {
  return (entity as { updatedAt?: string } | null)?.updatedAt
}

// A server that does not list this app answers 400 "unknown app".
export function isUnknownAppError(message: string | null | undefined): boolean {
  return !!message && (/unknown app/i.test(message) || /failed: 400\b/.test(message))
}

// Local row -> sync shape: the same object, minus the local-only sample flag.
// A sample row answers null so that, were its id ever marked dirty by mistake,
// nothing of it would upload.
function toSync<T extends { sample?: boolean }>(row: T | undefined): Omit<T, 'sample'> | null {
  if (!row) return null
  const { sample, ...rest } = row
  return sample ? null : rest
}

export async function getLocalEntity(entityId: string): Promise<unknown | null> {
  const thing = await db.things.get(entityId)
  if (thing) return toSync(thing)
  const cov = await db.coverages.get(entityId)
  if (cov) return toSync(cov)
  const sub = await db.subscriptions.get(entityId)
  if (sub) return toSync(sub)
  const dec = await db.decisions.get(entityId)
  if (dec) return dec
  return null
}

function notifyApplied(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('tg:sync-applied'))
}

export async function applyRemoteEntity(entityId: string, entity: unknown): Promise<void> {
  const kind = kindOf(entity)
  if (!kind || (entity as { id?: unknown }).id !== entityId) return
  switch (kind) {
    case 'thing': await db.things.put(entity as Thing); break
    case 'coverage': await db.coverages.put(entity as Coverage); break
    case 'subscription': await db.subscriptions.put(entity as Subscription); break
    case 'decision': await db.decisions.put(entity as Decision); break
  }
  await db.tombstones.delete(entityId)
  notifyApplied()
}

export async function applyRemoteDelete(entityId: string): Promise<void> {
  await db.transaction('rw', [db.things, db.coverages, db.subscriptions, db.decisions, db.tombstones], async () => {
    await db.tombstones.put({ id: entityId, deletedAt: new Date().toISOString() })
    await Promise.all([
      db.things.delete(entityId),
      db.coverages.delete(entityId),
      db.subscriptions.delete(entityId),
      db.decisions.delete(entityId),
    ])
  })
  notifyApplied()
}

// First sync on a device: mark everything real so data that predates the vault
// connection uploads. Sample rows are left out.
export async function markAllLocalEntitiesDirty(engine: DbSyncEngine): Promise<void> {
  const [things, covs, subs, decs] = await Promise.all([
    db.things.toArray(), db.coverages.toArray(), db.subscriptions.toArray(), db.decisions.toArray(),
  ])
  for (const r of [...things, ...covs, ...subs]) if (!r.sample) engine.markDirty(r.id)
  for (const d of decs) engine.markDirty(d.id)
}

export interface DbEngineCallbacks {
  onStatusChange?: (status: SyncStatus) => void
  onError?: (message: string | null, code: SyncErrorCode | null, isHardStop: boolean) => void
  onRowsSkipped?: (count: number, entityIds: string[]) => void
}

export function createDbEngine(callbacks: DbEngineCallbacks = {}): DbSyncEngine | null {
  if (!isVaultEnabled()) return null
  const cfg = getVaultConfig()!

  const engine = createDbSyncEngine({
    storageKeyPrefix: APP_ID,
    appId: APP_ID,
    vaultApp: APP_ID,
    cryptoDBName: CRYPTO_DB_NAME,
    vaultUrl: cfg.vaultUrl,
    vaultToken: cfg.vaultToken,
    accountId: cfg.accountId,
    deviceId: getDeviceId(),
    getLocalEntity,
    applyRemoteEntity,
    applyRemoteDelete,
    isInsertOnly: () => false,
    getEntityLastModified,
    pullCursorCommit: PULL_CURSOR_COMMIT,
    onStatusChange: callbacks.onStatusChange,
    onError: callbacks.onError,
    onRowsSkipped: callbacks.onRowsSkipped,
  })

  // One-shot persisted seed (lifeGLANCE's pattern, as lastGLANCE adopted it):
  // mark once, latch, and let the engine's persisted dirty set carry delivery.
  // A device whose cursor is already past 0 synced long ago: latch, do not
  // re-mark.
  const runCycle = engine.dbSyncCycle.bind(engine)
  const dbSyncCycle = async (): Promise<DbSyncResult> => {
    if (localStorage.getItem(SNAPSHOT_SEEDED_FLAG) !== '1') {
      if (engine.getHighWaterMark() > 0) {
        localStorage.setItem(SNAPSHOT_SEEDED_FLAG, '1')
      } else {
        try {
          await markAllLocalEntitiesDirty(engine)
          localStorage.setItem(SNAPSHOT_SEEDED_FLAG, '1')
        } catch (err) {
          console.warn('[thingglance] vault initial snapshot failed:', err)
        }
      }
    }
    return runCycle()
  }

  return { ...engine, dbSyncCycle, sync: dbSyncCycle }
}
