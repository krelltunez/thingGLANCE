import { shellFetchImpl } from '@/sync/shellFetch'
import { deriveIntentsRootKey } from '@glance-apps/intents'
import { createVaultClient } from '@glance-apps/sync'
import { getVaultConfig } from '@/sync/vaultConfig'
import { tr } from '@/core/text'
import { storeIntentsRootKey } from './keyStore'

// Derives and caches the intents root key: deriveIntentsRootKey(passphrase,
// vault salt), byte-identical to the sibling apps' vault intents setup. The
// salt is never invented here: it is registered by the first vault sync, and a
// key from a made-up salt is one no other app could reproduce.
export async function setupIntentsEncryption(passphrase: string): Promise<void> {
  const v = getVaultConfig()
  if (!v || !v.vaultUrl || !v.vaultToken || !v.accountId) throw new Error(tr('intents.notConnected'))
  const client = createVaultClient({ vaultUrl: v.vaultUrl, vaultToken: v.vaultToken, fetchImpl: shellFetchImpl() })
  const salt = await client.getSalt(v.accountId)
  if (!salt) throw new Error(tr('intents.noSalt'))
  await storeIntentsRootKey(await deriveIntentsRootKey(passphrase, new Uint8Array(salt)))
}
