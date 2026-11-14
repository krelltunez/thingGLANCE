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
// No shell has shipped yet, so there is no older IndexedDB copy to carry
// across. If a shell build ever ships before its keystore is wired, the first
// launch with one simply asks for the passphrase again.

import { secureStore } from '@/native/shell'

export const CRYPTO_DB_NAME = 'thingglance-crypto'
const ROOT_KEY_ENTRY = 'crypto.db-root-key'

export interface DbCryptoConfig {
  cryptoDBName: string
  nativeGetSyncKey?: () => Promise<string | null>
  nativeStoreSyncKey?: (value: string | null) => void
}

export function dbCryptoConfig(): DbCryptoConfig {
  const store = secureStore()
  if (!store) return { cryptoDBName: CRYPTO_DB_NAME }
  return {
    cryptoDBName: CRYPTO_DB_NAME,
    nativeGetSyncKey: async () => {
      try { return await store.get(ROOT_KEY_ENTRY) } catch { return null }
    },
    // The package calls this without waiting; null means "forget it".
    nativeStoreSyncKey: (value) => {
      void (value === null ? store.remove(ROOT_KEY_ENTRY) : store.set(ROOT_KEY_ENTRY, value)).catch(() => {
        // Not persisted: this session still has the key in memory, and the
        // next launch asks for the passphrase.
      })
    },
  }
}
