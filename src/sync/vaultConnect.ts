// Connecting, testing and disconnecting a vault. Two ways in, as in the
// sibling apps: a GLANCEvault Pro account key (one paste, the app enrolls this
// device), or a self-hosted server's URL + device token + account id.
//
// Every caller reloads afterwards so the engines are rebuilt from clean state.

import { clearDbRootKey, createVaultClient } from '@glance-apps/sync'
import { getDeviceId } from './deviceId'
import { DB_CRYPTO_CONFIG } from './dbEngine'
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
  await clearDbRootKey(DB_CRYPTO_CONFIG).catch(() => { /* nothing cached */ })
  await clearIntentsRootKey().catch(() => { /* nothing cached */ })
}

// ── Test before saving ───────────────────────────────────────────────────────

export type VaultTestOutcome =
  | { ok: true; fresh: boolean; appAllowed: boolean | null }
  | { ok: false; code: 'AUTH_FAILURE' | 'FORBIDDEN' | 'NETWORK_ERROR' }

// Does this server accept the `thingglance` app? /healthz lists the allowed
// apps on current servers; null when it does not say.
async function probeAppAllowed(vaultUrl: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${vaultUrl.replace(/\/+$/, '')}/healthz`, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return null
    const body = (await res.json()) as { allowedApps?: unknown }
    return Array.isArray(body.allowedApps) ? body.allowedApps.includes(APP_ID) : null
  } catch {
    return null
  }
}

// A read-only reachability + auth check (GET /salt/:accountId). A fresh account
// with no salt yet is fine: the first sync registers one.
export async function testVaultConnection(input: Pick<VaultConfig, 'vaultUrl' | 'vaultToken' | 'accountId'>): Promise<VaultTestOutcome> {
  try {
    const client = createVaultClient({ vaultUrl: input.vaultUrl, vaultToken: input.vaultToken, brake: false })
    const [salt, appAllowed] = await Promise.all([client.getSalt(input.accountId), probeAppAllowed(input.vaultUrl)])
    return { ok: true, fresh: !salt || salt.length === 0, appAllowed }
  } catch (err) {
    const status = (err as { status?: unknown })?.status
    if (status === 401) return { ok: false, code: 'AUTH_FAILURE' }
    if (status === 403) return { ok: false, code: 'FORBIDDEN' }
    return { ok: false, code: 'NETWORK_ERROR' }
  }
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
  if (!key) throw new ProEnrollError('KEY_REJECTED', 'No account key entered.')
  let res: Response
  try {
    res = await fetch(`${vaultUrl.replace(/\/+$/, '')}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountKey: key, deviceId: getDeviceId() }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch {
    throw new ProEnrollError('UNAVAILABLE', 'Could not reach GLANCEvault Pro.')
  }
  if (res.status === 401 || res.status === 403) throw new ProEnrollError('KEY_REJECTED', 'That account key was not accepted.')
  if (res.status === 404) throw new ProEnrollError('UNAVAILABLE', 'This server does not offer enrollment.')
  if (res.status !== 200 && res.status !== 201) throw new ProEnrollError('SERVER_ERROR', `Enrollment failed (status ${res.status}).`)
  const body = (await res.json().catch(() => null)) as { credential?: unknown; accountId?: unknown } | null
  if (typeof body?.credential !== 'string' || !body.credential || typeof body?.accountId !== 'string' || !body.accountId) {
    throw new ProEnrollError('SERVER_ERROR', 'The enrollment reply was missing the credential.')
  }
  await applyConnection({ enabled: true, vaultUrl, vaultToken: body.credential, accountId: body.accountId, pro: true })
  // Pro turns on intents too, as in the sibling apps.
  saveIntentsConfig({ ...getIntentsConfig(), enabled: true })
}
