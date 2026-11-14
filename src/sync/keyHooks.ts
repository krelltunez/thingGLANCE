// Where the vault's encryption root key is kept between launches.
//
// @glance-apps/sync caches it in IndexedDB by default, as raw bytes: the most
// sensitive thing in WebView storage. It also takes a pair of hooks that hand
// the storage to the app instead, and treats them as either/or with
// IndexedDB. When a shell supplies a secure store these are those hooks; on
// the web they are absent and the package keeps its own cache.
//
// Every place that touches the root key must use the same config
// (dbCryptoConfig), or one would read from the keystore while another wrote to
// IndexedDB.
//
// With a keystore, three things hold:
//   - The key is stored with the account it belongs to, and only handed back
//     for that account. A key left behind by a failed removal can never be
//     restored into a different account.
//   - Writes go through the same ordered, deadlined queue as every other
//     keystore call (secrets.ts: secureOp), and count towards
//     flushSecretWrites(), so a reload never overtakes one.
//   - Nothing is left in IndexedDB. A copy from before the keystore existed is
//     moved across at boot and deleted (settleKeyStorage).
//
// The key for tasks sent to dayGLANCE (src/intents/keyStore.ts) is derived
// from the same passphrase and salt and is the same 32 bytes, so with a
// keystore it is read from this entry too and never stored on its own.

import { secureStore } from '@/native/shell'
import { secureOp, trackSecureWrite } from './secrets'
import { vaultAccountTag } from './vaultConfig'

export const CRYPTO_DB_NAME = 'thingglance-crypto'
// The package appends "-db" to the name it is given.
const PACKAGE_DB = `${CRYPTO_DB_NAME}-db`
const PACKAGE_STORE = 'db-root-keys'
const PACKAGE_RECORD = 'db-root-key'
// The intents key's own database (src/intents/keyStore.ts).
export const INTENTS_CRYPTO_DB = 'thingglance-vault-intents-crypto'
const ROOT_KEY_ENTRY = 'crypto.db-root-key'

export interface DbCryptoConfig {
  cryptoDBName: string
  nativeGetSyncKey?: () => Promise<string | null>
  nativeStoreSyncKey?: (value: string | null) => void
}

// Which account a stored key is for.
const accountTag = (): string => vaultAccountTag()

interface KeptKey { for: string; key: string }

function parseKept(raw: string | null): KeptKey | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<KeptKey> | null
    return p && typeof p.for === 'string' && typeof p.key === 'string' ? { for: p.for, key: p.key } : null
  } catch {
    return null
  }
}

// The root key record the sync package wrote (base64 of JSON holding the raw
// bytes and the salt), or null: nothing stored, another account's, or the
// keystore did not answer. All three mean "ask for the passphrase".
export async function keptRootRecord(): Promise<string | null> {
  if (!secureStore()) return null
  try {
    const kept = parseKept(await secureOp((store) => store.get(ROOT_KEY_ENTRY)))
    if (!kept) return null
    const tag = accountTag()
    if (!tag || kept.for !== tag) {
      // Left behind by an earlier account. It must not outlive this launch.
      trackSecureWrite(secureOp((store) => store.remove(ROOT_KEY_ENTRY)))
      return null
    }
    return kept.key
  } catch {
    return null
  }
}

function keepRootRecord(value: string | null): void {
  const tag = accountTag()
  const write = value === null || !tag
    ? secureOp((store) => store.remove(ROOT_KEY_ENTRY))
    : secureOp((store) => store.set(ROOT_KEY_ENTRY, JSON.stringify({ for: tag, key: value } satisfies KeptKey)))
  // Not persisted on a refusal: this session still has the key in memory, and
  // the next launch asks for the passphrase.
  trackSecureWrite(write)
}

export function dbCryptoConfig(): DbCryptoConfig {
  if (!secureStore()) return { cryptoDBName: CRYPTO_DB_NAME }
  return {
    cryptoDBName: CRYPTO_DB_NAME,
    nativeGetSyncKey: keptRootRecord,
    // The package calls this without waiting; null means "forget it".
    nativeStoreSyncKey: keepRootRecord,
  }
}

// ── Nothing left in IndexedDB ────────────────────────────────────────────────

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name)
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    } catch {
      resolve()
    }
  })
}

// The package's own record, if it left one: { rootBytes, salt } as arrays.
function readPackageRecord(): Promise<{ rootBytes: number[]; salt: number[] } | null> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(PACKAGE_DB)
      open.onerror = () => resolve(null)
      open.onupgradeneeded = () => { open.transaction?.abort() } // it did not exist: do not create it
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains(PACKAGE_STORE)) { db.close(); resolve(null); return }
        const req = db.transaction(PACKAGE_STORE, 'readonly').objectStore(PACKAGE_STORE).get(PACKAGE_RECORD)
        req.onsuccess = () => {
          const r = req.result as { rootBytes?: unknown; salt?: unknown } | undefined
          db.close()
          resolve(r && Array.isArray(r.rootBytes) && Array.isArray(r.salt) ? { rootBytes: r.rootBytes as number[], salt: r.salt as number[] } : null)
        }
        req.onerror = () => { db.close(); resolve(null) }
      }
    } catch {
      resolve(null)
    }
  })
}

// Run once at boot, after hydrateSecrets(). With a keystore, a root key still
// in IndexedDB (from a launch before the keystore was wired, or one where it
// was unavailable) is moved into the keystore and both key databases are
// deleted. On the web it does nothing.
export async function settleKeyStorage(): Promise<void> {
  if (!secureStore() || typeof indexedDB === 'undefined') return
  try {
    const old = await readPackageRecord()
    if (old) {
      const kept = await keptRootRecord()
      if (!kept && accountTag()) {
        const record = btoa(JSON.stringify({ rootBytes: old.rootBytes, salt: old.salt }))
        // If the keystore refuses, the copy stays where it is for next time.
        await secureOp((store) => store.set(ROOT_KEY_ENTRY, JSON.stringify({ for: accountTag(), key: record } satisfies KeptKey)))
      }
    }
    await deleteDatabase(PACKAGE_DB)
    await deleteDatabase(INTENTS_CRYPTO_DB)
  } catch {
    // Left in place: this launch works as before and the next one tries again.
  }
}
