// Owns the vault engines for the life of the page and exposes one small
// observable state the UI renders. No React in here: an Electron tray window
// or a headless refresh can drive the same module.

import { clearDbRootKey, getSyncPassphrase, hasDbRootKey, initDbRootKey, setSyncPassphrase } from '@glance-apps/sync'
import type { DbSyncEngine, SyncErrorCode } from '@glance-apps/sync'
import { tr } from '@/core/text'
import { createDbEngine, isUnknownAppError, markAllLocalEntitiesDirty } from './dbEngine'
import { dbCryptoConfig } from './keyHooks'
import { checkKeyAgainstSiblings, rewriteOwnVerifier, tryPassphrase, type SiblingKeyCheck } from './keyCheck'
import { registerDbEngine } from './dirtyTracker'
import { secretsUnreadable } from './secrets'
import { getVaultConfig, isVaultEnabled, settleStreamOwner, vaultAccountTag } from './vaultConfig'
import { probeAllowedApps } from './vaultConnect'
import { ROSTER_VAULT_APP, createRosterDbEngine } from '@/multiuser/rosterVault'
import { registerRosterDbEngine } from '@/multiuser/rosterDirtyTracker'
import { setupIntentsEncryption } from '@/intents/setup'
import { clearIntentsRootKey, loadIntentsRootKey } from '@/intents/keyStore'
import { drainIntents, startIntentsPoller } from '@/intents/receive'
import { shellBridge } from '@/native/shell'
import { createBridgeSseClient, createNudgeCoalescer, createVaultEventClient, detectSseTransport, openWebSseStream, type SseClientState } from './vaultEventStream'

export type SyncPhase = 'off' | 'locked' | 'idle' | 'syncing' | 'synced' | 'error'

export interface SyncState {
  phase: SyncPhase
  pro: boolean
  lastSynced: string | null
  errorCode: string | null
  errorMessage: string | null
  // The server does not list `thingglance` in its allowed apps.
  unsupported: boolean
  // The server refuses the shared roster's app (glance-users is not in its
  // allowed apps), so no GLANCE app can share members through it.
  rosterUnsupported: boolean
  // The last roster cycle did not reach the vault (sync is pausing after a
  // failure). Not the same as an empty roster.
  rosterPaused: boolean
  // The key cached on this device does not open what the account's other
  // GLANCE apps wrote: it came from a different passphrase. Sync is held (it
  // would only add rows nobody else can read) until the right one is entered.
  keyConflict: boolean
  // The last time this device read the shared roster, and how that went.
  // Null until the first read (multi-user off, or still waiting).
  rosterCheckedAt: string | null
  rosterError: string | null
  rosterSkipped: number
  // Rows that decrypted but were not a member (no name, or an id that is not theirs).
  rosterRejected: number
  skipped: number
  pending: number
  // Live push from the vault's event stream. 'off' means polling only, which
  // is always running underneath regardless.
  live: 'off' | 'connecting' | 'on' | 'stalled' | 'unsupported'
}

let state: SyncState = {
  phase: 'off', pro: false, lastSynced: null, errorCode: null, errorMessage: null,
  unsupported: false, keyConflict: false, rosterUnsupported: false, rosterPaused: false, rosterCheckedAt: null, rosterError: null, rosterSkipped: 0, rosterRejected: 0,
  skipped: 0, pending: 0, live: 'off',
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
// What the server's /healthz says about the roster's app. Null until asked,
// or when the server does not say.
let rosterAllowed: boolean | null = null

async function probeRoster(): Promise<void> {
  const cfg = getVaultConfig()
  if (!cfg) return
  const apps = await probeAllowedApps(cfg.vaultUrl)
  rosterAllowed = apps ? apps.includes(ROSTER_VAULT_APP) : null
  if (rosterAllowed !== null) set({ rosterUnsupported: !rosterAllowed })
}

// "Check again" in Settings: ask the server afresh, then read the roster.
export async function recheckRoster(): Promise<void> {
  // Bounded: a server that is slow to answer must not hold up the first sync.
  await Promise.race([probeRoster(), new Promise((resolve) => setTimeout(resolve, ROSTER_PROBE_WAIT_MS))])
  await roster?.dbSyncCycle().catch(() => { /* reported through onError */ })
}
let started = false

const CADENCE_MS = 5 * 60 * 1000
const ROSTER_PROBE_WAIT_MS = 4000

export function syncErrorText(code: string | null, message: string | null): string {
  switch (code) {
    case 'KEY_MISMATCH': return tr('sync.error.keyMismatch')
    case 'AUTH_FAILURE':
    case 'CREDENTIAL_INVALID': return tr('sync.error.credential')
    case 'FORBIDDEN': return tr('sync.error.forbidden')
    case 'NETWORK_ERROR': return tr('sync.error.network')
    case 'QUOTA_EXCEEDED': return tr('sync.error.quota')
    case 'RATE_LIMITED':
    case 'SYNC_SUPPRESSED': return tr('sync.error.pausing')
    case 'VERIFIER_UNSUPPORTED': return tr('sync.error.verifier')
    case 'UNKNOWN_APP': return tr('sync.error.unknownApp')
    case 'KEYSTORE_UNREADABLE': return tr('sync.error.keystore')
    default: return message || tr('sync.error.failed')
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
  if (!isVaultEnabled()) {
    // "Could not read the keystore" is not "not connected": say so, and leave
    // local edits to the hold in dirtyHold.ts until a launch that can read it.
    set(secretsUnreadable() ? { phase: 'error', errorCode: 'KEYSTORE_UNREADABLE', errorMessage: null } : { phase: 'off' })
    return
  }
  // Cursors left by another account (a change of connection that was cut
  // short) are dropped before any engine reads them.
  settleStreamOwner()
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
    onChecked: (o) => set({
      rosterUnsupported: false, rosterPaused: !o.ran && !o.error,
      rosterCheckedAt: o.ran || o.error ? new Date().toISOString() : state.rosterCheckedAt,
      rosterError: o.error, rosterSkipped: o.skipped, rosterRejected: o.rejected,
    }),
    allowed: () => rosterAllowed,
  })
  registerRosterDbEngine(roster)
  // Before the first cycle, so a server that refuses the roster is named as
  // such rather than discovered through a failed request.
  await probeRoster()

  set({ phase: 'idle', lastSynced: engine?.getLastSynced() ?? null, pending: engine?.getDirtySet().length ?? 0 })

  // Restore the cached root key; only ask for the passphrase when there is none.
  const hasRoot = hasDbRootKey() || (await initDbRootKey(dbCryptoConfig()).catch(() => false))
  if (!hasRoot && getSyncPassphrase() === null) set({ phase: 'locked' })
  else if (hasRoot && (await cachedKeyConflicts())) {
    // Remember that everything this device uploaded went up under the wrong
    // key, so it is uploaded again once the right passphrase is in.
    localStorage.setItem(REKEY_FLAG, '1')
    await clearDbRootKey(dbCryptoConfig()).catch(() => {})
    await clearIntentsRootKey().catch(() => {})
    setSyncPassphrase(null)
    set({ phase: 'locked', keyConflict: true })
  }

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
  const transport = detectSseTransport()
  if (transport === 'none') return

  // Inspectable in a packaged build with no devtools open: the same
  // `window.__glanceVaultSse` the sibling apps expose. Many connects with few
  // events is a reconnect storm; `stalled` is a buffering reverse proxy.
  const diag = { transport, state: 'idle' as SseClientState | 'idle', connects: 0, events: 0, drains: 0, lastEventSeq: null as number | null, lastError: null as string | null, lastConnectedAt: null as string | null }
  ;(window as unknown as Record<string, unknown>).__glanceVaultSse = diag

  const coalescer = createNudgeCoalescer({
    onDrain: () => { diag.drains += 1; void syncNow() },
    onDrainError: (err) => console.warn('[thingglance] live sync drain failed:', err),
  })

  // Both readers are given the same three things, so a nudge means the same
  // whichever one produced it.
  const getConnection = () => {
    const c = getVaultConfig()
    return c && c.vaultUrl && c.vaultToken && c.accountId ? { vaultUrl: c.vaultUrl, vaultToken: c.vaultToken, accountId: c.accountId } : null
  }
  const onEvent = (evt: unknown) => {
    diag.events += 1
    const seq = (evt as { seq?: number } | null)?.seq
    if (typeof seq === 'number') diag.lastEventSeq = seq
    // The first frame proves the path end to end; 'open' alone does not.
    if (state.live !== 'on') set({ live: 'on' })
    coalescer.handleEvent(evt)
  }
  const onStateChange = (s: SseClientState, detail?: unknown) => {
    diag.state = s
    if (s === 'connecting') { diag.connects += 1; if (state.live === 'off') set({ live: 'connecting' }) }
    else if (s === 'open') { if (transport === 'shell') diag.connects += 1; diag.lastConnectedAt = new Date().toISOString() }
    else if (s === 'stalled') {
      set({ live: 'stalled' })
      console.warn('[thingglance] live sync: the stream opened but nothing arrived. A reverse proxy is probably buffering /events; polling is covering.')
    } else if (s === 'unsupported-server') {
      set({ live: 'unsupported' })
    } else if (s === 'error') {
      const coded = detail && typeof detail === 'object' ? (detail as { code?: string; message?: string }) : null
      diag.lastError = coded ? `${coded.code}: ${coded.message ?? ''}` : detail instanceof Error ? detail.message : String(detail ?? 'error')
      // A coded error from a shell's reader is final: it has stopped. Polling
      // is covering, so this is "no live updates", not a sync failure.
      if (coded) set({ live: 'off' })
      else if (state.live === 'on') set({ live: 'connecting' })
    } else if (s === 'closed' && state.live === 'on') {
      set({ live: 'connecting' })
    } else if (s === 'stopped') {
      set({ live: 'off' })
    }
  }

  if (transport === 'shell') {
    // The shell holds the connection and decides when: it connects while the
    // app is on screen and drops in the background by itself. Here it is only
    // told the stream is wanted, once.
    const stream = shellBridge()?.eventStream
    if (!stream) return
    const client = createBridgeSseClient({
      getConnection, onEvent, onStateChange,
      startNative: (connection) => { void Promise.resolve(stream.start(connection)).catch((err) => onStateChange('error', err instanceof Error ? err.message : String(err))) },
      stopNative: () => { void Promise.resolve(stream.stop()).catch(() => {}) },
    })
    stream.listen(client.receive)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') coalescer.cancel() })
    client.start()
    return
  }

  const client = createVaultEventClient({ getConnection, openStream: openWebSseStream, onEvent, onStateChange })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') client.start()
    else { client.stop(); coalescer.cancel() }
  })
  if (document.visibilityState !== 'hidden') client.start()
}

// ── Is this the account's passphrase? ────────────────────────────────────────
// See keyCheck.ts for why the engine's own check is not enough.

// Set while this device's uploads are known to be under a wrong key.
const REKEY_FLAG = 'tg_rekey_pending'
// Once a sibling has confirmed the cached key for this account there is no
// need to ask the vault again on every start.
const CONFIRMED_KEY = 'tg_key_confirmed_for'
const accountTag = (): string => vaultAccountTag()

async function cachedKeyConflicts(): Promise<boolean> {
  if (localStorage.getItem(CONFIRMED_KEY) === accountTag()) return false
  try {
    const outcome = await checkKeyAgainstSiblings()
    if (outcome === 'match') localStorage.setItem(CONFIRMED_KEY, accountTag())
    return outcome === 'mismatch'
  } catch {
    return false // offline or refused: says nothing either way, try next start
  }
}


// Resolves to null on success, or a message to show under the passphrase field.
export async function submitPassphrase(typed: string): Promise<string | null> {
  if (!engine) return tr('sync.passphrase.notConnected')
  const rejected = async (): Promise<string> => {
    // The wrong key is cached now; drop it so the next attempt derives afresh.
    await clearDbRootKey(dbCryptoConfig()).catch(() => {})
    setSyncPassphrase(null)
    return tr('sync.passphrase.wrong')
  }

  // First against the other apps on the account, before thingGLANCE's own
  // namespace gets a say (or gets written to).
  let passphrase = typed
  let siblings: SiblingKeyCheck | 'fresh'
  try {
    siblings = await tryPassphrase(passphrase, dbCryptoConfig())
    // A pasted passphrase often carries a stray space or newline.
    if (siblings === 'mismatch' && typed.trim() !== typed && (await tryPassphrase(typed.trim(), dbCryptoConfig())) === 'match') {
      passphrase = typed.trim()
      siblings = 'match'
    }
  } catch (err) {
    return syncErrorText((err as { code?: string })?.code ?? 'NETWORK_ERROR', (err as Error)?.message ?? null)
  }
  if (siblings === 'mismatch') return rejected()

  setSyncPassphrase(passphrase)
  try {
    await engine.ensureRootKey()
  } catch (err) {
    const code = (err as { code?: string })?.code ?? null
    if (code !== 'KEY_MISMATCH') return syncErrorText(code, (err as Error)?.message ?? null)
    if (siblings !== 'match') return rejected()
    // The siblings accept this key, so it is the account's. thingGLANCE's own
    // verifier disagreeing means it was written under a wrong passphrase:
    // replace it, and upload this device's rows again under the right key.
    try {
      await rewriteOwnVerifier()
      localStorage.setItem(REKEY_FLAG, '1')
      await engine.ensureRootKey()
    } catch (again) {
      return syncErrorText((again as { code?: string })?.code ?? null, (again as Error)?.message ?? null)
    }
  }
  if (siblings === 'match') localStorage.setItem(CONFIRMED_KEY, accountTag())
  if (localStorage.getItem(REKEY_FLAG) === '1') {
    await markAllLocalEntitiesDirty(engine)
    // The intents key came from the same wrong passphrase.
    await clearIntentsRootKey().catch(() => {})
    localStorage.removeItem(REKEY_FLAG)
  }
  set({ phase: 'idle', keyConflict: false, errorCode: null, errorMessage: null })
  // Intents are encrypted with a key from the same passphrase and salt; derive
  // it now while the passphrase is in memory.
  if (!(await loadIntentsRootKey().catch(() => null))) {
    await setupIntentsEncryption(passphrase).catch((e) => console.warn('[thingglance] intents key setup failed:', e))
  }
  void syncNow()
  return null
}

export const hasPassphraseInMemory = (): boolean => getSyncPassphrase() !== null
