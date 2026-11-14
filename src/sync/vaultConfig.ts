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
  ]
  for (const key of keys) {
    try { localStorage.removeItem(key) } catch { /* nothing to clear */ }
  }
}

export function vaultIdentityChanged(
  prev: Pick<VaultConfig, 'vaultUrl' | 'accountId'> | null | undefined,
  next: Pick<VaultConfig, 'vaultUrl' | 'accountId'> | null | undefined,
): boolean {
  if (!prev || !next) return false
  return prev.vaultUrl.trim() !== next.vaultUrl.trim() || prev.accountId.trim() !== next.accountId.trim()
}
