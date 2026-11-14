// Bridge between the data layer (src/db/queries.ts) and the vault engine. The
// engine only exchanges rows that changed; its sole input is markDirty(id).
// A no-op whenever the vault is off, so the data layer never has to care.
// When a vault is expected but its engine is not up yet, changes wait in a
// hold (dirtyHold.ts) and are handed over when it registers.

import type { DbSyncEngine } from '@glance-apps/sync'
import { createDirtyHold, vaultExpected } from './dirtyHold'

const hold = createDirtyHold('tg_dirty_waiting')

// A burst of writes (a form save touching several rows, an import) collapses
// into one sync.
const PUSH_DEBOUNCE_MS = 3000

let dbEngine: DbSyncEngine | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<() => void>()

function cancelScheduledPush(): void {
  if (pushTimer != null) { clearTimeout(pushTimer); pushTimer = null }
}

function schedulePush(): void {
  if (!dbEngine) return
  cancelScheduledPush()
  pushTimer = setTimeout(() => {
    pushTimer = null
    dbEngine?.dbSyncCycle().catch(() => { /* surfaced via the engine onError */ })
  }, PUSH_DEBOUNCE_MS)
}

export function registerDbEngine(engine: DbSyncEngine | null): void {
  cancelScheduledPush()
  dbEngine = engine
  if (!engine) return
  const waiting = hold.take()
  for (const id of waiting) engine.markDirty(id)
  if (waiting.length) schedulePush()
}

// Fires on every local write, vault or not: the launcher snapshot, the app
// badge and anything else that mirrors local data listens here.
export function onLocalWrite(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// Mark an entity changed OR deleted. The engine resolves deletions by absence:
// a dirty id whose getLocalEntity returns null is pushed as a soft-delete.
export function markDirty(id: string | null | undefined): void {
  if (!id) return
  for (const fn of listeners) { try { fn() } catch { /* a listener must not break a write */ } }
  if (!dbEngine) {
    if (vaultExpected()) hold.add(id)
    return
  }
  dbEngine.markDirty(id)
  schedulePush()
}
