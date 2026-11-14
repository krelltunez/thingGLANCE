// GLANCEvault connection config. thingGLANCE syncs through the vault ONLY (no
// WebDAV, iCloud or Direct Access roads), so this is the whole sync setup.
// Same shape and semantics as lastGLANCE's src/sync/vaultConfig.ts.

import { VAULT_CONFIG_KEY, readSecret, writeSecret } from './secrets'

export const APP_ID = 'thingglance'

export interface VaultConfig {
  enabled: boolean
  vaultUrl: string
  vaultToken: string // device bearer token (shared mode) or enrolled credential (Pro)
  accountId: string
  pro?: boolean
}

export function getVaultConfig(): VaultConfig | null {
  try {
    // The token is a credential: it is kept wherever secrets.ts says.
    const raw = readSecret(VAULT_CONFIG_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<VaultConfig>
    return {
      enabled: !!p.enabled,
      vaultUrl: p.vaultUrl ?? '',
      vaultToken: p.vaultToken ?? '',
      accountId: p.accountId ?? '',
      ...(p.pro ? { pro: true } : {}),
    }
  } catch {
    return null
  }
}

export function setVaultConfig(config: VaultConfig | null): void {
  writeSecret(VAULT_CONFIG_KEY, config ? JSON.stringify(config) : null)
}

export function isVaultEnabled(): boolean {
  const c = getVaultConfig()
  return !!(c && c.enabled && c.vaultUrl && c.vaultToken && c.accountId)
}

// GLANCEvault Pro: the hosted vault. One pasted account key enrolls the device.
export const PRO_VAULT_URL = 'https://sync.glancevault.com'

export function clearCredentialHalt(): void {
  for (const prefix of [APP_ID, `${APP_ID}-glance-users`]) {
    try { localStorage.removeItem(`${prefix}-db-sync-credential-halt`) } catch { /* storage unavailable */ }
  }
}

// Everything that belongs to one account's data stream, for both vault engines
// (things and the household roster). Key names follow @glance-apps/sync's
// `${storageKeyPrefix}-db-sync-*` plus the wrapper's one-shot seed flag. The
// device id deliberately survives: it names the device, not the stream.
const streamKeys = (prefix: string) => [
  `${prefix}-db-sync-snapshot-seeded`,
  `${prefix}-db-sync-config`,
  `${prefix}-db-sync-hwm`,
  `${prefix}-db-sync-push-ack`,
  `${prefix}-db-sync-dirty`,
  `${prefix}-db-sync-quarantine`,
  `${prefix}-db-sync-last-synced`,
  `${prefix}-db-sync-credential-halt`,
]

// Cursors from one account must never be applied to another: a stale pull
// cursor would hide the new account's low-seq rows, and a latched seed flag
// would keep this device's existing data from ever uploading.
export function resetVaultSyncState(): void {
  const keys = [
    ...streamKeys(APP_ID),
    ...streamKeys(`${APP_ID}-glance-users`),
    'tg_intents_receive_cursor',
    'tg_intents_receive_failures',
    // Changes held for an engine belong to the stream they were made on.
    'tg_dirty_waiting',
    'tg_roster_dirty_waiting',
    STREAM_OWNER_KEY,
  ]
  for (const key of keys) {
    try { localStorage.removeItem(key) } catch { /* nothing to clear */ }
  }
}

// Which account the stream state above belongs to. The token can live in a
// keystore that commits at once, while these keys live in localStorage, which
// a WebView flushes lazily: a process killed between the two would otherwise
// come back with one account's token and another's cursors. Checked at every
// start; a mismatch is treated as the account change it is.
const STREAM_OWNER_KEY = 'tg_stream_for'

export const vaultAccountTag = (c: Pick<VaultConfig, 'vaultUrl' | 'accountId'> | null = getVaultConfig()): string =>
  c ? `${c.vaultUrl.trim()}|${c.accountId.trim()}` : ''

// Answers true when the stream state was left by a different account and has
// been cleared. A device with no owner recorded yet (every install from before
// this check) simply adopts the current account.
export function settleStreamOwner(): boolean {
  const tag = vaultAccountTag()
  if (!tag) return false
  let owner: string | null = null
  try { owner = localStorage.getItem(STREAM_OWNER_KEY) } catch { return false }
  const stale = owner !== null && owner !== tag
  if (stale) resetVaultSyncState()
  if (owner !== tag) { try { localStorage.setItem(STREAM_OWNER_KEY, tag) } catch { /* storage unavailable */ } }
  return stale
}

export function vaultIdentityChanged(
  prev: Pick<VaultConfig, 'vaultUrl' | 'accountId'> | null | undefined,
  next: Pick<VaultConfig, 'vaultUrl' | 'accountId'> | null | undefined,
): boolean {
  if (!prev || !next) return false
  return prev.vaultUrl.trim() !== next.vaultUrl.trim() || prev.accountId.trim() !== next.accountId.trim()
}
