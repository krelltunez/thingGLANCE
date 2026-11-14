import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deriveEnvelopeKey, deriveIntentsRootKey } from '@glance-apps/intents'
import { clearDbRootKey, setupDbRootKey } from '@glance-apps/sync'
import { registerShell, type SecureStore } from '@/native/shell'
import { dbCryptoConfig } from '@/sync/keyHooks'
import { flushSecretWrites, hydrateSecrets, resetSecretsForTests } from '@/sync/secrets'
import { setVaultConfig } from '@/sync/vaultConfig'
import { clearIntentsRootKey, loadIntentsRootKey, storeIntentsRootKey } from './keyStore'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}
const config = { enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'home' }
const PASS = 'correct horse battery staple'
const SALT = new Uint8Array(16).fill(7)

let kept: Map<string, string>
beforeEach(async () => {
  vi.stubGlobal('localStorage', fakeStorage())
  // Any use of IndexedDB here would be the key being stored outside the keystore.
  vi.stubGlobal('indexedDB', { open: () => { throw new Error('IndexedDB must not be used when a keystore is present') }, deleteDatabase: () => ({}) })
  resetSecretsForTests()
  kept = new Map()
  const store: SecureStore = { get: async (k) => kept.get(k) ?? null, set: async (k, v) => void kept.set(k, v), remove: async (k) => void kept.delete(k) }
  registerShell({ secureStore: store })
  await hydrateSecrets()
  setVaultConfig(config)
  await clearIntentsRootKey()
})
afterEach(async () => { await clearDbRootKey(dbCryptoConfig()).catch(() => {}); registerShell(null); vi.unstubAllGlobals() })

// Two keys are the same key if what one seals the other opens.
async function sameKey(a: CryptoKey, b: CryptoKey): Promise<boolean> {
  const salt = new Uint8Array(16).fill(3)
  const iv = new Uint8Array(12).fill(5)
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await deriveEnvelopeKey(a, salt), new TextEncoder().encode('hello'))
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await deriveEnvelopeKey(b, salt), sealed)) === 'hello'
  } catch {
    return false
  }
}

describe('the key for dayGLANCE tasks, with a keystore', () => {
  it('is not there until the passphrase has been entered', async () => {
    expect(await loadIntentsRootKey()).toBeNull()
  })
  it('is rebuilt from the root key in the keystore, and is the key the sibling apps derive', async () => {
    await setupDbRootKey(PASS, SALT, dbCryptoConfig())
    await flushSecretWrites()
    const fromKeystore = await loadIntentsRootKey()
    expect(fromKeystore).not.toBeNull()
    expect(await sameKey(fromKeystore!, await deriveIntentsRootKey(PASS, SALT))).toBe(true)
    expect(await sameKey(fromKeystore!, await deriveIntentsRootKey('another passphrase', SALT))).toBe(false)
  })
  it('is never stored on its own: one copy of the key, in the keystore', async () => {
    // storeIntentsRootKey would throw here if it reached for IndexedDB.
    await storeIntentsRootKey(await deriveIntentsRootKey(PASS, SALT))
    await flushSecretWrites()
    expect([...kept.keys()].filter((k) => k.includes('intents'))).toEqual([])
  })
  it('goes when the root key goes', async () => {
    await setupDbRootKey(PASS, SALT, dbCryptoConfig())
    await flushSecretWrites()
    expect(await loadIntentsRootKey()).not.toBeNull()
    await clearDbRootKey(dbCryptoConfig())
    await clearIntentsRootKey()
    await flushSecretWrites()
    expect(await loadIntentsRootKey()).toBeNull()
  })
})
