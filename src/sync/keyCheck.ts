// Proving a passphrase against the rest of the account.
//
// The sync engine proves a key against a verifier row in the app's OWN vault
// namespace, and writes that row when it is missing. For the first GLANCE app
// on an account that is right. For thingGLANCE joining an account the other
// apps already use it is a hole: its namespace is empty, so any passphrase is
// accepted and becomes "the" key for thingGLANCE's rows. Sync then looks
// healthy while the shared roster (glance-users) cannot be decrypted and
// dayGLANCE cannot read the tasks sent to it.
//
// So before a key is trusted it is tried against the verifier the sibling
// apps left behind. Read-only: nothing is written to a namespace that is not
// thingGLANCE's.

import {
  KEYCHECK_ENTITY_ID, KEYCHECK_PAYLOAD, clearDbRootKey, createVaultClient, decryptEntity, encryptEntity, setupDbRootKey,
} from '@glance-apps/sync'
import type { DbCryptoConfig } from './keyHooks'
import { shellFetchImpl } from './shellFetch'
import { APP_ID, getVaultConfig } from './vaultConfig'

// Every namespace another GLANCE app may have left a verifier in, the shared
// roster first: it is the one thingGLANCE itself reads.
export const SIBLING_APPS = ['glance-users', 'dayglance', 'lastglance', 'lifeglance', 'lastglance-people'] as const

// 'match': a sibling's verifier decrypts under the current root key.
// 'mismatch': siblings have verifiers and none of them does.
// 'none': no sibling has written one (thingGLANCE may be first on the account).
export type SiblingKeyCheck = 'match' | 'mismatch' | 'none'

const client = () => {
  const cfg = getVaultConfig()
  if (!cfg) throw new Error('The vault is not connected.')
  return { vault: createVaultClient({ vaultUrl: cfg.vaultUrl, vaultToken: cfg.vaultToken, brake: false, fetchImpl: shellFetchImpl() }), accountId: cfg.accountId }
}

const isAnswer = (err: unknown): boolean => {
  const status = Number((err as { status?: unknown })?.status)
  // 400 is the server refusing an app it does not list; 404 a missing route.
  // Either says "no verifier here". Anything else is not an answer at all.
  return status === 400 || status === 404
}

// Uses the root key currently in the sync package's module state.
export async function checkKeyAgainstSiblings(): Promise<SiblingKeyCheck> {
  const { vault, accountId } = client()
  let found = false
  for (const app of SIBLING_APPS) {
    let row: Awaited<ReturnType<typeof vault.getRow>>
    try {
      row = await vault.getRow(app, KEYCHECK_ENTITY_ID, accountId)
    } catch (err) {
      if (isAnswer(err)) continue
      throw err
    }
    const envelope = row && !row.deleted ? row.envelope : null
    if (!envelope) continue
    found = true
    try {
      await decryptEntity(envelope, KEYCHECK_ENTITY_ID)
      return 'match'
    } catch { /* this one does not open; another sibling's may */ }
  }
  return found ? 'mismatch' : 'none'
}

// Derives the root key for `passphrase` on this account and tries it against
// the siblings. 'fresh' when the account has no salt yet: nothing to prove
// against, and the engine registers the salt on its first cycle. On anything
// but a mismatch the derived key is left cached, ready for the engine.
export async function tryPassphrase(passphrase: string, crypto: DbCryptoConfig): Promise<SiblingKeyCheck | 'fresh'> {
  const { vault, accountId } = client()
  const salt = await vault.getSalt(accountId)
  if (!salt || salt.length === 0) return 'fresh'
  await clearDbRootKey(crypto).catch(() => { /* nothing cached */ })
  await setupDbRootKey(passphrase, salt, crypto)
  const outcome = await checkKeyAgainstSiblings()
  if (outcome === 'mismatch') await clearDbRootKey(crypto).catch(() => {})
  return outcome
}

// Rewrites thingGLANCE's own verifier under the current root key. Only for a
// key the siblings have just confirmed: it is the account's key, so a verifier
// that disagrees with it was written under a wrong passphrase.
export async function rewriteOwnVerifier(): Promise<void> {
  const { vault, accountId } = client()
  const envelope = await encryptEntity(KEYCHECK_PAYLOAD, KEYCHECK_ENTITY_ID)
  await vault.batch(APP_ID, { accountId, rows: [{ entityId: KEYCHECK_ENTITY_ID, envelope, createdAt: Date.now() }] })
}
