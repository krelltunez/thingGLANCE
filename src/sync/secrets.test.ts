import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerShell, type SecureStore } from '@/native/shell'
import { dbCryptoConfig } from './keyHooks'
import { VAULT_CONFIG_KEY, flushSecretWrites, hydrateSecrets, readSecret, resetSecretsForTests, writeSecret } from './secrets'
import { getVaultConfig, isVaultEnabled, setVaultConfig } from './vaultConfig'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}
function fakeKeystore(over: Partial<SecureStore> = {}) {
  const m = new Map<string, string>()
  const store: SecureStore = { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k), ...over }
  return { store, m }
}

let plain: ReturnType<typeof fakeStorage>
beforeEach(() => { plain = fakeStorage(); vi.stubGlobal('localStorage', plain); resetSecretsForTests() })
afterEach(() => { registerShell(null); vi.unstubAllGlobals() })

const config = { enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok-123', accountId: 'home' }

describe('on the web', () => {
  it('keeps the connection in localStorage, exactly as before', async () => {
    await hydrateSecrets()
    setVaultConfig(config)
    expect(JSON.parse(plain.m.get(VAULT_CONFIG_KEY)!)).toMatchObject({ vaultToken: 'tok-123' })
    expect(getVaultConfig()).toMatchObject(config)
    setVaultConfig(null)
    expect(plain.m.has(VAULT_CONFIG_KEY)).toBe(false)
    expect(isVaultEnabled()).toBe(false)
  })
  it('leaves the root key to the sync package\'s own cache', () => {
    expect(dbCryptoConfig()).toEqual({ cryptoDBName: 'thingglance-crypto' })
  })
})

describe('in a shell with a keystore', () => {
  it('keeps the token out of localStorage', async () => {
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: store })
    await hydrateSecrets()
    setVaultConfig(config)
    expect(getVaultConfig()).toMatchObject(config)
    await flushSecretWrites()
    expect(plain.m.has(VAULT_CONFIG_KEY)).toBe(false)
    expect([...plain.m.values()].join(' ')).not.toContain('tok-123')
    expect(JSON.parse(m.get(VAULT_CONFIG_KEY)!)).toMatchObject({ vaultToken: 'tok-123' })
  })
  it('has the connection ready the moment boot has hydrated', async () => {
    const { store, m } = fakeKeystore()
    m.set(VAULT_CONFIG_KEY, JSON.stringify(config))
    registerShell({ secureStore: store })
    await hydrateSecrets()
    expect(isVaultEnabled()).toBe(true)
    expect(getVaultConfig()?.vaultToken).toBe('tok-123')
  })
  it('moves a plaintext copy across once, and removes it only after the keystore has it', async () => {
    plain.m.set(VAULT_CONFIG_KEY, JSON.stringify(config))
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: store })
    await hydrateSecrets()
    expect(plain.m.has(VAULT_CONFIG_KEY)).toBe(false)
    expect(m.has(VAULT_CONFIG_KEY)).toBe(true)
    expect(getVaultConfig()?.vaultToken).toBe('tok-123')
  })
  it('keeps working as before when the keystore refuses, and never wipes the settings', async () => {
    plain.m.set(VAULT_CONFIG_KEY, JSON.stringify(config))
    const { store } = fakeKeystore({ set: async () => { throw new Error('keystore locked') } })
    registerShell({ secureStore: store })
    await hydrateSecrets()
    expect(getVaultConfig()?.vaultToken).toBe('tok-123')
    expect(plain.m.has(VAULT_CONFIG_KEY)).toBe(true)
  })
  it('forgets the connection everywhere on disconnect', async () => {
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: store })
    await hydrateSecrets()
    setVaultConfig(config)
    setVaultConfig(null)
    await flushSecretWrites()
    expect(getVaultConfig()).toBeNull()
    expect(m.has(VAULT_CONFIG_KEY)).toBe(false)
  })
  it('waits for the keystore before a reload', async () => {
    let finish = () => {}
    const { store, m } = fakeKeystore({ set: (k, v) => new Promise<void>((resolve) => { finish = () => { m.set(k, v); resolve() } }) })
    registerShell({ secureStore: store })
    await hydrateSecrets()
    writeSecret(VAULT_CONFIG_KEY, 'x')
    let flushed = false
    const flushing = flushSecretWrites().then(() => { flushed = true })
    await Promise.resolve()
    expect(flushed).toBe(false)
    finish()
    await flushing
    expect(flushed).toBe(true)
    expect(m.get(VAULT_CONFIG_KEY)).toBe('x')
  })
  it('answers from the old place if asked before boot has hydrated', () => {
    plain.m.set(VAULT_CONFIG_KEY, 'legacy')
    registerShell({ secureStore: fakeKeystore().store })
    expect(readSecret(VAULT_CONFIG_KEY)).toBe('legacy')
  })
  it('hands the root key to the keystore through the sync package\'s hooks', async () => {
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: store })
    const cfg = dbCryptoConfig()
    expect(await cfg.nativeGetSyncKey!()).toBeNull()
    cfg.nativeStoreSyncKey!('root-key-blob')
    await Promise.resolve()
    expect(m.get('crypto.db-root-key')).toBe('root-key-blob')
    expect(await cfg.nativeGetSyncKey!()).toBe('root-key-blob')
    cfg.nativeStoreSyncKey!(null)
    await Promise.resolve()
    expect(m.has('crypto.db-root-key')).toBe(false)
  })
  it('treats a keystore that throws on read as no key, so the passphrase is asked for', async () => {
    registerShell({ secureStore: fakeKeystore({ get: async () => { throw new Error('locked') } }).store })
    expect(await dbCryptoConfig().nativeGetSyncKey!()).toBeNull()
  })
})
