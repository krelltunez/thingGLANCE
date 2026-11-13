// Owns the vault engines for the life of the page and exposes one small
// observable state the UI renders. No React in here: an Electron tray window
// or a headless refresh can drive the same module.

import { clearDbRootKey, getSyncPassphrase, hasDbRootKey, initDbRootKey, setSyncPassphrase } from '@glance-apps/sync'
import type { DbSyncEngine, SyncErrorCode } from '@glance-apps/sync'
import { DB_CRYPTO_CONFIG, createDbEngine, isUnknownAppError } from './dbEngine'
import { registerDbEngine } from './dirtyTracker'
import { getVaultConfig, isVaultEnabled } from './vaultConfig'
import { createRosterDbEngine } from '@/multiuser/rosterVault'
import { registerRosterDbEngine } from '@/multiuser/rosterDirtyTracker'
import { setupIntentsEncryption } from '@/intents/setup'
import { loadIntentsRootKey } from '@/intents/keyStore'
import { drainIntents, startIntentsPoller } from '@/intents/receive'
import { createNudgeCoalescer, createVaultEventClient, detectSseTransport, openWebSseStream, type SseClientState } from './vaultEventStream'

export type SyncPhase = 'off' | 'locked' | 'idle' | 'syncing' | 'synced' | 'error'

export interface SyncState {
  phase: SyncPhase
  pro: boolean
  lastSynced: string | null
  errorCode: string | null
  errorMessage: string | null
  // The server does not list `thingglance` in its allowed apps.
  unsupported: boolean
  rosterUnsupported: boolean
  skipped: number
  pending: number
  // Live push from the vault's event stream. 'off' means polling only, which
  // is always running underneath regardless.
  live: 'off' | 'connecting' | 'on' | 'stalled' | 'unsupported'
}

let state: SyncState = {
  phase: 'off', pro: false, lastSynced: null, errorCode: null, errorMessage: null,
  unsupported: false, rosterUnsupported: false, skipped: 0, pending: 0, live: 'off',
}
const listeners = new Set<() => void>()
const set = (patch: Partial<SyncState>) => {
  state = { ...state, ...patch }
  for (const fn of listeners) fn()
}

export const getSyncState = (): SyncState => state
export const subscribeSync = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn) }

let engine: DbSyncEngine | null = null
let roster: DbSyncEngine | null = null
let started = false

const CADENCE_MS = 5 * 60 * 1000

export function syncErrorText(code: string | null, message: string | null): string {
  switch (code) {
    case 'KEY_MISMATCH': return 'The passphrase on this device does not match this vault account. Re-enter the passphrase your other GLANCE apps use.'
    case 'AUTH_FAILURE':
    case 'CREDENTIAL_INVALID': return 'The vault rejected this device\'s credential. Reconnect in Settings.'
    case 'FORBIDDEN': return 'The vault refused access to this account.'
    case 'NETWORK_ERROR': return 'Could not reach the vault. It will retry on its own.'
    case 'QUOTA_EXCEEDED': return 'The vault account is over its quota. Uploads are paused; downloads continue.'
    case 'RATE_LIMITED':
    case 'SYNC_SUPPRESSED': return 'Sync is pausing briefly and will resume on its own.'
    case 'VERIFIER_UNSUPPORTED': return 'This vault server is too old to verify the encryption key. Update the server.'
    case 'UNKNOWN_APP': return 'This vault does not accept thingGLANCE yet. Add "thingglance" to the server\'s allowed apps (GLANCEVAULT_ALLOWED_APPS).'
    default: return message || 'Sync failed.'
  }
}

async function cycle(): Promise<void> {
  if (!engine || state.phase === 'locked' || state.unsupported) return
  try {
    await engine.dbSyncCycle()
  } catch { /* reported through onError */ }
  set({ lastSynced: engine.getLastSynced(), pending: engine.getDirtySet().length })
  if (roster && !state.rosterUnsupported) roster.dbSyncCycle().catch(() => { /* reported through onError */ })
}

export async function syncNow(): Promise<void> {
  await cycle()
  drainIntents()
}

// Called once from App on mount. Safe to call again after a config change
// only via a page reload (the sync package keeps its root key in module state).
export async function startSync(): Promise<void> {
  if (started) return
  started = true
  if (!isVaultEnabled()) { set({ phase: 'off' }); return }
  set({ pro: !!getVaultConfig()?.pro })
  navigator.storage?.persist?.().catch(() => {})

  engine = createDbEngine({
    onStatusChange: (s) => {
      if (state.phase === 'locked') return
      if (s === 'uploading' || s === 'downloading') set({ phase: 'syncing' })
      else if (s === 'success') set({ phase: 'synced', errorCode: null, errorMessage: null, lastSynced: engine?.getLastSynced() ?? null })
      else if (s === 'idle' && state.phase === 'syncing') set({ phase: 'idle' })
    },
    onError: (message, code: SyncErrorCode | null) => {
      if (!message && !code) return
      if (code === 'PASSPHRASE_REQUIRED') { set({ phase: 'locked', errorCode: null, errorMessage: null }); return }
      if (isUnknownAppError(message)) { set({ phase: 'error', unsupported: true, errorCode: 'UNKNOWN_APP', errorMessage: message }); return }
      // A scheduled pause is not a failure worth a red indicator.
      if (code === 'SYNC_SUPPRESSED' || code === 'RATE_LIMITED') return
      set({ phase: 'error', errorCode: code, errorMessage: message })
      console.warn('[thingglance] vault sync error:', code ?? '(no code)', message)
    },
    onRowsSkipped: (count) => set({ skipped: count }),
  })
  registerDbEngine(engine)

  roster = createRosterDbEngine({
    onError: (message, code) => { if (message) console.warn('[thingglance] roster sync error:', code ?? '(no code)', message) },
    onUnsupported: () => set({ rosterUnsupported: true }),
  })
  registerRosterDbEngine(roster)

  set({ phase: 'idle', lastSynced: engine?.getLastSynced() ?? null, pending: engine?.getDirtySet().length ?? 0 })

  // Restore the cached root key; only ask for the passphrase when there is none.
  const hasRoot = hasDbRootKey() || (await initDbRootKey(DB_CRYPTO_CONFIG).catch(() => false))
  if (!hasRoot && getSyncPassphrase() === null) set({ phase: 'locked' })

  void cycle()
  startIntentsPoller()
  startEventStream()
  setInterval(() => void cycle(), CADENCE_MS)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void cycle() })
  window.addEventListener('online', () => void cycle())
}

// ── Live push ────────────────────────────────────────────────────────────────
// Purely additive: a nudge runs the SAME drains the cadence runs, which re-read
// their own cursors and no-op when there is nothing new. Open while the page
// is visible, closed while hidden; the reconnect's `ready` frame reconciles
// whatever was missed.
function startEventStream(): void {
  if (detectSseTransport() !== 'web') return

  // Inspectable in a packaged build with no devtools open: the same
  // `window.__glanceVaultSse` the sibling apps expose. Many connects with few
  // events is a reconnect storm; `stalled` is a buffering reverse proxy.
  const diag = { state: 'idle' as SseClientState | 'idle', connects: 0, events: 0, drains: 0, lastEventSeq: null as number | null, lastError: null as string | null, lastConnectedAt: null as string | null }
  ;(window as unknown as Record<string, unknown>).__glanceVaultSse = diag

  const coalescer = createNudgeCoalescer({
    onDrain: () => { diag.drains += 1; void syncNow() },
    onDrainError: (err) => console.warn('[thingglance] live sync drain failed:', err),
  })

  const client = createVaultEventClient({
    getConnection: () => {
      const c = getVaultConfig()
      return c && c.vaultUrl && c.vaultToken && c.accountId ? { vaultUrl: c.vaultUrl, vaultToken: c.vaultToken, accountId: c.accountId } : null
    },
    openStream: openWebSseStream,
    onEvent: (evt) => {
      diag.events += 1
      const seq = (evt as { seq?: number } | null)?.seq
      if (typeof seq === 'number') diag.lastEventSeq = seq
      // The first frame proves the path end to end; 'open' alone does not.
      if (state.live !== 'on') set({ live: 'on' })
      coalescer.handleEvent(evt)
    },
    onStateChange: (s, detail) => {
      diag.state = s
      if (s === 'connecting') { diag.connects += 1; if (state.live === 'off') set({ live: 'connecting' }) }
      else if (s === 'open') diag.lastConnectedAt = new Date().toISOString()
      else if (s === 'stalled') {
        set({ live: 'stalled' })
        console.warn('[thingglance] live sync: the stream opened but nothing arrived. A reverse proxy is probably buffering /events; polling is covering.')
      } else if (s === 'unsupported-server') {
        set({ live: 'unsupported' })
      } else if (s === 'error') {
        diag.lastError = detail instanceof Error ? detail.message : String(detail ?? 'error')
        if (state.live === 'on') set({ live: 'connecting' })
      } else if (s === 'closed' && state.live === 'on') {
        set({ live: 'connecting' })
      } else if (s === 'stopped') {
        set({ live: 'off' })
      }
    },
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') client.start()
    else { client.stop(); coalescer.cancel() }
  })
  if (document.visibilityState !== 'hidden') client.start()
}

// Resolves to null on success, or a message to show under the passphrase field.
export async function submitPassphrase(passphrase: string): Promise<string | null> {
  if (!engine) return 'The vault is not connected.'
  setSyncPassphrase(passphrase)
  try {
    await engine.ensureRootKey()
  } catch (err) {
    const code = (err as { code?: string })?.code ?? null
    if (code === 'KEY_MISMATCH') {
      // The wrong key is cached now; drop it so the next attempt derives afresh.
      await clearDbRootKey(DB_CRYPTO_CONFIG).catch(() => {})
      setSyncPassphrase(null)
      return 'That passphrase does not match this vault account. Use the one your other GLANCE apps sync with.'
    }
    return syncErrorText(code, (err as Error)?.message ?? null)
  }
  set({ phase: 'idle', errorCode: null, errorMessage: null })
  // Intents are encrypted with a key from the same passphrase and salt; derive
  // it now while the passphrase is in memory.
  if (!(await loadIntentsRootKey().catch(() => null))) {
    await setupIntentsEncryption(passphrase).catch((e) => console.warn('[thingglance] intents key setup failed:', e))
  }
  void syncNow()
  return null
}

export const hasPassphraseInMemory = (): boolean => getSyncPassphrase() !== null
