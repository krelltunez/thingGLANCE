// The vault intents root key: derived from the sync passphrase and the
// account's vault salt (src/intents/setup.ts). Any GLANCE app deriving from
// the same passphrase and salt gets the identical key, which is what lets
// dayGLANCE read what thingGLANCE sends.
//
// It is also the same 32 bytes as the vault's root key (same derivation, same
// inputs). So where it is kept follows the root key:
//   - On the web it is cached non-extractably in its own IndexedDB database,
//     so the passphrase is not needed again.
//   - With a shell's keystore it is never stored at all. It is rebuilt from
//     the root key record in the keystore (src/sync/keyHooks.ts), so there is
//     one copy of the key on the device and it is in the keystore.

import { secureStore } from '@/native/shell'
import { INTENTS_CRYPTO_DB, keptRootRecord } from '@/sync/keyHooks'

const DB_NAME = INTENTS_CRYPTO_DB
const STORE = 'keys'
const KEY_ID = 'root-key'

let cached: CryptoKey | null = null

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((idb) => new Promise<T>((resolve, reject) => {
    const tx = idb.transaction(STORE, mode)
    const req = op(tx.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => idb.close()
  }))
}

// The root key record as the sync package writes it: base64 of JSON holding
// the raw bytes. Imported exactly as deriveIntentsRootKey() imports its own.
async function fromRootRecord(record: string): Promise<CryptoKey | null> {
  try {
    const parsed = JSON.parse(atob(record)) as { rootBytes?: unknown }
    if (!Array.isArray(parsed.rootBytes) || parsed.rootBytes.length !== 32) return null
    return await crypto.subtle.importKey('raw', new Uint8Array(parsed.rootBytes as number[]), 'HKDF', false, ['deriveKey'])
  } catch {
    return null
  }
}

export async function storeIntentsRootKey(key: CryptoKey): Promise<void> {
  cached = key
  // With a keystore the root key record is the stored copy.
  if (secureStore()) return
  await run('readwrite', (s) => s.put(key, KEY_ID))
}

export async function loadIntentsRootKey(): Promise<CryptoKey | null> {
  if (cached) return cached
  if (secureStore()) {
    const record = await keptRootRecord()
    cached = record ? await fromRootRecord(record) : null
    return cached
  }
  try {
    cached = ((await run('readonly', (s) => s.get(KEY_ID))) as CryptoKey | undefined) ?? null
  } catch {
    cached = null
  }
  return cached
}

export async function clearIntentsRootKey(): Promise<void> {
  cached = null
  // With a keystore there is nothing of its own to clear: it goes when the
  // root key does.
  if (secureStore()) return
  try { await run('readwrite', (s) => s.delete(KEY_ID)) } catch { /* nothing cached */ }
}
