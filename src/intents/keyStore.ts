// The vault intents root key: derived from the sync passphrase and the
// account's vault salt (src/intents/setup.ts), cached non-extractably in its
// own IndexedDB database so the passphrase is not needed again. Any GLANCE app
// deriving from the same passphrase and salt gets the identical key, which is
// what lets dayGLANCE read what thingGLANCE sends.

const DB_NAME = 'thingglance-vault-intents-crypto'
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

export async function storeIntentsRootKey(key: CryptoKey): Promise<void> {
  cached = key
  await run('readwrite', (s) => s.put(key, KEY_ID))
}

export async function loadIntentsRootKey(): Promise<CryptoKey | null> {
  if (cached) return cached
  try {
    cached = ((await run('readonly', (s) => s.get(KEY_ID))) as CryptoKey | undefined) ?? null
  } catch {
    cached = null
  }
  return cached
}

export async function clearIntentsRootKey(): Promise<void> {
  cached = null
  try { await run('readwrite', (s) => s.delete(KEY_ID)) } catch { /* nothing cached */ }
}
