// Connecting, testing and disconnecting a vault. Two ways in, as in the
// sibling apps: a GLANCEvault Pro account key (one paste, the app enrolls this
// device), or a self-hosted server's URL + device token + account id.
//
// Every caller reloads afterwards so the engines are rebuilt from clean state.

import { clearDbRootKey, createVaultClient } from '@glance-apps/sync'
import { tr } from '@/core/text'
import { getDeviceId } from './deviceId'
import { dbCryptoConfig } from './keyHooks'
import { flushSecretWrites } from './secrets'
import { netFetch, shellFetchImpl } from './shellFetch'
import {
  APP_ID, PRO_VAULT_URL, clearCredentialHalt, getVaultConfig, resetVaultSyncState,
  setVaultConfig, vaultIdentityChanged, type VaultConfig,
} from './vaultConfig'
import { clearIntentsRootKey } from '@/intents/keyStore'
import { getIntentsConfig, saveIntentsConfig } from '@/intents/config'

// Both cached keys derive from the account's salt, so a key cached for another
// account would encrypt this one's rows wrongly. Drop them on any identity
// change; the app then asks for the passphrase again.
export async function clearCachedVaultKeys(): Promise<void> {
  await clearDbRootKey(dbCryptoConfig()).catch(() => { /* nothing cached */ })
  await clearIntentsRootKey().catch(() => { /* nothing cached */ })
}

// The shared roster's vault app. Named here as well as in rosterVault.ts so
// this module does not have to import the engine.
const ROSTER_APP = 'glance-users'

// ── Test before saving ───────────────────────────────────────────────────────

export type VaultTestOutcome =
  // `rosterAllowed` is about the shared household roster (glance-users): a
  // server that leaves it out still syncs things, but no GLANCE app can share
  // members through it.
  | { ok: true; fresh: boolean; appAllowed: boolean | null; rosterAllowed: boolean | null }
  | { ok: false; code: 'AUTH_FAILURE' | 'FORBIDDEN' | 'NETWORK_ERROR' }

// Which apps this server accepts. /healthz lists them on current servers
// (no credential needed); null when it does not say or cannot be reached.
export async function probeAllowedApps(vaultUrl: string): Promise<string[] | null> {
  try {
    const res = await netFetch(`${vaultUrl.replace(/\/+$/, '')}/healthz`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { allowedApps?: unknown }
    return Array.isArray(body.allowedApps) ? body.allowedApps.filter((a): a is string => typeof a === 'string') : null
  } catch {
    return null
  }
}

// A read-only reachability + auth check (GET /salt/:accountId). A fresh account
// with no salt yet is fine: the first sync registers one.
export async function testVaultConnection(input: Pick<VaultConfig, 'vaultUrl' | 'vaultToken' | 'accountId'>): Promise<VaultTestOutcome> {
  try {
    const client = createVaultClient({ vaultUrl: input.vaultUrl, vaultToken: input.vaultToken, brake: false, fetchImpl: shellFetchImpl() })
    const [salt, apps] = await Promise.all([client.getSalt(input.accountId), probeAllowedApps(input.vaultUrl)])
    return { ok: true, fresh: !salt || salt.length === 0, appAllowed: apps ? apps.includes(APP_ID) : null, rosterAllowed: apps ? apps.includes(ROSTER_APP) : null }
  } catch (err) {
    const status = (err as { status?: unknown })?.status
    if (status === 401) return { ok: false, code: 'AUTH_FAILURE' }
    if (status === 403) return { ok: false, code: 'FORBIDDEN' }
    return { ok: false, code: 'NETWORK_ERROR' }
  }
}

// A connection change ends in a reload (the sync package keeps its root key in
// module state). Wait for the credentials to reach the secure store first, or
// the page that comes back finds nothing.
export async function reloadAfterConfigChange(): Promise<void> {
  await flushSecretWrites()
  window.location.reload()
}

// ── Save / disconnect ────────────────────────────────────────────────────────

async function applyConnection(next: VaultConfig): Promise<void> {
  const prev = getVaultConfig()
  const sameStream = !!prev && !!prev.vaultToken && !vaultIdentityChanged(prev, next)
  setVaultConfig(next)
  if (sameStream) {
    // A rotated token on the same stream keeps its cursors and keys.
    clearCredentialHalt()
  } else {
    resetVaultSyncState()
    await clearCachedVaultKeys()
  }
}

export async function connectSelfHosted(input: { vaultUrl: string; vaultToken: string; accountId: string }): Promise<void> {
  await applyConnection({
    enabled: true,
    vaultUrl: input.vaultUrl.trim().replace(/\/+$/, ''),
    vaultToken: input.vaultToken.trim(),
    accountId: input.accountId.trim(),
  })
}

export async function disconnectVault(): Promise<void> {
  setVaultConfig(null)
  resetVaultSyncState()
  saveIntentsConfig({ ...getIntentsConfig(), enabled: false })
  await clearCachedVaultKeys()
}

// ── GLANCEvault Pro ──────────────────────────────────────────────────────────

export type ProEnrollCode = 'KEY_REJECTED' | 'UNAVAILABLE' | 'SERVER_ERROR'

export class ProEnrollError extends Error {
  constructor(readonly code: ProEnrollCode, message: string) {
    super(message)
    this.name = 'ProEnrollError'
  }
}

// Exchanges the account key for this device's own credential (POST /enroll on
// an account-key server). The key is sent once and never stored.
export async function connectVaultPro(accountKey: string, vaultUrl = PRO_VAULT_URL): Promise<void> {
  const key = accountKey.trim()
  if (!key) throw new ProEnrollError('KEY_REJECTED', tr('sync.enroll.noKey'))
  let res: Response
  try {
    res = await netFetch(`${vaultUrl.replace(/\/+$/, '')}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountKey: key, deviceId: getDeviceId() }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new ProEnrollError('UNAVAILABLE', tr('sync.enroll.unreachable'))
  }
  if (res.status === 401 || res.status === 403) throw new ProEnrollError('KEY_REJECTED', tr('sync.enroll.rejected'))
  if (res.status === 404) throw new ProEnrollError('UNAVAILABLE', tr('sync.enroll.notOffered'))
  if (res.status !== 200 && res.status !== 201) throw new ProEnrollError('SERVER_ERROR', tr('sync.enroll.status', { status: res.status }))
  const body = (await res.json().catch(() => null)) as { credential?: unknown; accountId?: unknown } | null
  if (typeof body?.credential !== 'string' || !body.credential || typeof body?.accountId !== 'string' || !body.accountId) {
    throw new ProEnrollError('SERVER_ERROR', tr('sync.enroll.noCredential'))
  }
  await applyConnection({ enabled: true, vaultUrl, vaultToken: body.credential, accountId: body.accountId, pro: true })
  // Pro turns on intents too, as in the sibling apps.
  saveIntentsConfig({ ...getIntentsConfig(), enabled: true })
}
