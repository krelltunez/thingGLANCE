// Bridge between the user writes in src/db/queries.ts and the household roster
// vault engine. Separate from src/sync/dirtyTracker.ts on purpose: the roster
// engine syncs the shared glance-users vault app with its own dirty set, and
// must never be told about a thing's id.

import type { DbSyncEngine } from '@glance-apps/sync'

const PUSH_DEBOUNCE_MS = 3000

let rosterEngine: DbSyncEngine | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null

function cancel(): void {
  if (pushTimer != null) { clearTimeout(pushTimer); pushTimer = null }
}

export function registerRosterDbEngine(engine: DbSyncEngine | null): void {
  cancel()
  rosterEngine = engine
}

export function syncRosterSoon(delay = PUSH_DEBOUNCE_MS): void {
  if (!rosterEngine) return
  cancel()
  pushTimer = setTimeout(() => {
    pushTimer = null
    rosterEngine?.dbSyncCycle().catch(() => { /* surfaced via onError */ })
  }, delay)
}

// A member changed or was removed (the engine pushes a soft-delete when
// getLocalEntity answers null).
export function markRosterDirty(id: string | null | undefined): void {
  if (!id || !rosterEngine) return
  rosterEngine.markDirty(id)
  syncRosterSoon()
}
