// The background refresh: what the Android shell runs, with no screen, a few
// times a day and whenever something was done on the home screen while the
// app was closed.
//
// It does what opening the app does, in order: sync with the vault, apply
// what was ticked on widgets and notifications, sync again to push those,
// then hand the home screen a fresh snapshot, from which the native side
// redraws the widgets and re-plans the reminders. A device with no vault still
// gets the last two: dates move into their windows whether or not anything
// syncs.
//
// An allowlist, not App with features switched off. Nothing here renders, and
// nothing initialises that the list above does not need. The native side
// holds the same line: HeadlessBridge.kt has only HEADLESS_BRIDGE_METHODS.
//
// If the app is opened during a run, the shell destroys this page before the
// app's own loads, and the run also asks `shouldAbort` between steps. Nothing
// is lost: a write is taken off the native queue only after it has been
// applied and the home screen updated, and whatever was applied but not yet
// pushed is pushed by the app's own first sync.

import { hasDbRootKey, initDbRootKey } from '@glance-apps/sync'
import type { DbSyncEngine } from '@glance-apps/sync'
import { i18nReady } from '@/i18n'
import { drainIntentsNow } from '@/intents/receive'
import { createRosterDbEngine } from '@/multiuser/rosterVault'
import { registerRosterDbEngine } from '@/multiuser/rosterDirtyTracker'
import { collectWidgetWrites, noteSynced, pushPayloadNow, type NativeSurface } from '@/native/widgetBridge'
import { createDbEngine } from '@/sync/dbEngine'
import { registerDbEngine } from '@/sync/dirtyTracker'
import { dbCryptoConfig, settleKeyStorage } from '@/sync/keyHooks'
import { hydrateSecrets, secretsUnreadable } from '@/sync/secrets'
import { isVaultEnabled, settleStreamOwner } from '@/sync/vaultConfig'
import { HEADLESS_OUTCOMES, type HeadlessBridge, type HeadlessOutcome } from './headlessMode'

// One thing a run syncs: its name in the outcome, and one cycle.
export interface HeadlessRoad { name: string; run: () => Promise<unknown> }
// Engines report failures through callbacks; a road reports its latest
// message (null clears it, as each cycle does at its start).
export type ReportError = (road: string, message: string | null) => void

export interface HeadlessDeps {
  bridge: HeadlessBridge
  // Credentials and language in memory, as main.tsx does before rendering.
  prepare?: () => Promise<void>
  buildRoads?: (report: ReportError) => Promise<HeadlessRoad[]>
  // Applies what was done on the home screen; resolves with how many writes
  // changed something. `afterApplying` runs before they are acknowledged.
  applyWrites?: (surface: NativeSurface, afterApplying: () => Promise<void>) => Promise<number>
  pushSnapshot?: (surface: NativeSurface) => Promise<void>
  now?: () => number
}

export interface HeadlessResult {
  outcome: HeadlessOutcome
  reason?: string
  // What the run did: which roads it synced and how many writes it applied.
  synced: string[]
  applied: number
  durationMs: number
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))

// The native side through the bridge, in the shape the app's own widget
// bridge takes (native/widgetBridge.ts), so both run the same code.
export function headlessSurface(bridge: HeadlessBridge): NativeSurface {
  return {
    updateSnapshot: async (json) => { bridge.updateSnapshot(json) },
    pendingWrites: async () => bridge.pendingWrites(),
    acknowledgeWrites: async (clientIds, results) => { bridge.acknowledgeWrites(JSON.stringify(clientIds), JSON.stringify(results)) },
  }
}

async function prepareRun(): Promise<void> {
  await hydrateSecrets()
  await settleKeyStorage()
  await i18nReady.catch(() => {})
}

// The vault roads, built the way the app builds them (sync/manager.ts) with
// every callback reduced to the error report. With no vault, none. Engines
// are registered with the dirty trackers, so a write applied during the run
// is marked for upload and anything held from an earlier launch is handed
// over (sync/dirtyHold.ts).
export async function buildSyncRoads(report: ReportError): Promise<HeadlessRoad[]> {
  if (secretsUnreadable()) { report('vault', 'the keystore could not be read'); return [] }
  if (!isVaultEnabled()) return []
  settleStreamOwner()
  const unlocked = hasDbRootKey() || (await initDbRootKey(dbCryptoConfig()).catch(() => false))
  // No key on this device yet: the app has to be opened once for the passphrase.
  if (!unlocked) { report('vault', 'locked: the passphrase has not been entered on this device'); return [] }

  const roads: HeadlessRoad[] = []
  const vault: DbSyncEngine | null = createDbEngine({
    onError: (message, code) => { if (message || code) report('vault', code === 'SYNC_SUPPRESSED' || code === 'RATE_LIMITED' ? null : message ?? String(code)) },
  })
  if (vault) {
    registerDbEngine(vault)
    // The launcher reads when the vault last answered from the snapshot this
    // run hands over: what it was before the run, then what the run made it.
    noteSynced(vault.getLastSynced())
    roads.push({ name: 'vault', run: async () => { await vault.dbSyncCycle(); noteSynced(vault.getLastSynced()) } })
  }
  const roster = createRosterDbEngine({ onError: (message) => report('roster', message) })
  if (roster) {
    registerRosterDbEngine(roster)
    roads.push({ name: 'roster', run: () => roster.dbSyncCycle() })
  }
  // Tasks completed in dayGLANCE clear their dates here.
  roads.push({ name: 'intents', run: () => drainIntentsNow() })
  return roads
}

// One run. Reports through `bridge.done` and resolves with the same record;
// never throws.
export async function runHeadlessRefresh(deps: HeadlessDeps): Promise<HeadlessResult> {
  const {
    bridge, prepare = prepareRun, buildRoads = buildSyncRoads,
    applyWrites = (surface, after) => collectWidgetWrites(after, surface),
    pushSnapshot = pushPayloadNow, now = Date.now,
  } = deps
  const started = now()
  const errors = new Map<string, string | null>()
  const report: ReportError = (road, message) => { errors.set(road, message || null) }
  let synced: string[] = []
  let applied = 0
  const done = (outcome: HeadlessOutcome, reason?: string): HeadlessResult => {
    const result: HeadlessResult = { outcome, synced, applied, durationMs: now() - started, ...(reason ? { reason } : {}) }
    try { bridge.done(JSON.stringify(result)) } catch { /* the worker decides on its own cap */ }
    return result
  }
  const aborted = () => { try { return bridge.shouldAbort() } catch { return false } }
  const surface = headlessSurface(bridge)

  try {
    if (aborted()) return done(HEADLESS_OUTCOMES.ABORTED, 'app opened')
    await prepare()
    if (aborted()) return done(HEADLESS_OUTCOMES.ABORTED, 'app opened')
    const roads = await buildRoads(report)
    synced = roads.map((r) => r.name)
    const runRoads = () => Promise.all(roads.map((road) => road.run().catch((e: unknown) => report(road.name, messageOf(e)))))
    await runRoads()
    if (aborted()) return done(HEADLESS_OUTCOMES.ABORTED, 'app opened')

    // After the pull, so a write is applied to what the household has now.
    // The snapshot is pushed before the writes are acknowledged; with none to
    // apply, it is pushed on its own below.
    let pushed = false
    applied = await applyWrites(surface, async () => { await pushSnapshot(surface); pushed = true }).catch(() => 0)
    if (aborted()) return done(HEADLESS_OUTCOMES.ABORTED, 'app opened')
    if (applied > 0 && roads.length) {
      await runRoads()
      if (aborted()) return done(HEADLESS_OUTCOMES.ABORTED, 'app opened')
    }
    // Whatever the roads did: a pull may have brought a date in, and with no
    // vault at all the calendar still moved.
    if (!pushed || applied > 0) await pushSnapshot(surface)

    const failed = [...errors].filter((entry): entry is [string, string] => !!entry[1])
    if (failed.length) return done(HEADLESS_OUTCOMES.FAILED, failed.map(([road, message]) => `${road}: ${message}`).join('; '))
    return done(HEADLESS_OUTCOMES.RAN)
  } catch (e) {
    return done(HEADLESS_OUTCOMES.FAILED, messageOf(e))
  }
}
