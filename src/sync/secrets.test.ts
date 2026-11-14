import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerShell, type SecureStore } from '@/native/shell'
import { dbCryptoConfig } from './keyHooks'
import { SECURE_OP_TIMEOUT_MS, VAULT_CONFIG_KEY, flushSecretWrites, hydrateSecrets, readSecret, resetSecretsForTests, secretsUnreadable, secureOp, writeSecret } from './secrets'
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
afterEach(() => { registerShell(null); vi.unstubAllGlobals(); vi.useRealTimers() })

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

// What the keystore holds for a key: the value inside its revision envelope.
const kept = (m: Map<string, string>, key = VAULT_CONFIG_KEY) => {
  const raw = m.get(key)
  return raw === undefined ? undefined : (JSON.parse(raw) as { rev: number; value: string | null }).value
}
const PENDING = `${VAULT_CONFIG_KEY}.pending`
// The page going away and coming back: memory is gone, storage is not.
const reload = async () => { resetSecretsForTests(); await hydrateSecrets() }
const other = { ...config, vaultToken: 'tok-456', accountId: 'cabin' }

describe('in a shell with a keystore', () => {
  it('keeps the token out of localStorage', async () => {
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: store })
    await hydrateSecrets()
    setVaultConfig(config)
    expect(getVaultConfig()).toMatchObject(config)
    await flushSecretWrites()
    expect([...plain.m.values()].join(' ')).not.toContain('tok-123')
    expect(JSON.parse(kept(m)!)).toMatchObject({ vaultToken: 'tok-123' })
  })
  it('has the connection ready the moment boot has hydrated', async () => {
    const { store, m } = fakeKeystore()
    m.set(VAULT_CONFIG_KEY, JSON.stringify({ rev: 5, value: JSON.stringify(config) }))
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
    expect(JSON.parse(kept(m)!)).toMatchObject({ vaultToken: 'tok-123' })
    expect(getVaultConfig()?.vaultToken).toBe('tok-123')
  })
  it('keeps working as before when the keystore refuses, and never wipes the settings', async () => {
    plain.m.set(VAULT_CONFIG_KEY, JSON.stringify(config))
    const { store } = fakeKeystore({ set: async () => { throw new Error('keystore locked') } })
    registerShell({ secureStore: store })
    await hydrateSecrets()
    expect(getVaultConfig()?.vaultToken).toBe('tok-123')
    expect(plain.m.has(VAULT_CONFIG_KEY)).toBe(true)
    expect(secretsUnreadable()).toBe(false)
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
    expect(plain.m.has(PENDING)).toBe(false)
  })
  it('waits for the keystore before a reload', async () => {
    let finish = () => {}
    const { store, m } = fakeKeystore({ set: (k, v) => new Promise<void>((resolve) => { finish = () => { m.set(k, v); resolve() } }) })
    registerShell({ secureStore: store })
    await hydrateSecrets()
    writeSecret(VAULT_CONFIG_KEY, 'x')
    let flushed = false
    const flushing = flushSecretWrites().then(() => { flushed = true })
    await new Promise((r) => setTimeout(r, 5))
    expect(flushed).toBe(false)
    finish()
    await flushing
    expect(flushed).toBe(true)
    expect(kept(m)).toBe('x')
  })
  it('answers from the old place if asked before boot has hydrated', () => {
    plain.m.set(VAULT_CONFIG_KEY, 'legacy')
    registerShell({ secureStore: fakeKeystore().store })
    expect(readSecret(VAULT_CONFIG_KEY)).toBe('legacy')
  })
})

describe('a keystore that misbehaves', () => {
  it('does not mistake "could not read" for "not connected"', async () => {
    const { store } = fakeKeystore({ get: async () => { throw new Error('keystore busy') } })
    registerShell({ secureStore: store })
    await hydrateSecrets()
    expect(isVaultEnabled()).toBe(false)
    expect(secretsUnreadable()).toBe(true)
    // Connecting again settles what the value is.
    setVaultConfig(config)
    expect(secretsUnreadable()).toBe(false)
  })
  it('tries a refused read again before giving up', async () => {
    let calls = 0
    const { store, m } = fakeKeystore()
    m.set(VAULT_CONFIG_KEY, JSON.stringify({ rev: 1, value: JSON.stringify(config) }))
    registerShell({ secureStore: { ...store, get: async (k) => { if (++calls === 1) throw new Error('busy'); return store.get(k) } } })
    await hydrateSecrets()
    expect(calls).toBe(2)
    expect(isVaultEnabled()).toBe(true)
    expect(secretsUnreadable()).toBe(false)
  })
  it('gives up on a read that never answers, and boot goes on', async () => {
    vi.useFakeTimers()
    registerShell({ secureStore: fakeKeystore({ get: () => new Promise<string | null>(() => {}) }).store })
    let done = false
    const boot = hydrateSecrets().then(() => { done = true })
    await vi.advanceTimersByTimeAsync(SECURE_OP_TIMEOUT_MS - 1)
    expect(done).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await boot
    expect(done).toBe(true)
    expect(secretsUnreadable()).toBe(true)
  })
  it('never lets a write that hangs hold up the reload', async () => {
    vi.useFakeTimers()
    registerShell({ secureStore: fakeKeystore({ set: () => new Promise<void>(() => {}) }).store })
    await hydrateSecrets()
    setVaultConfig(config)
    let flushed = false
    const flushing = flushSecretWrites().then(() => { flushed = true })
    await vi.advanceTimersByTimeAsync(SECURE_OP_TIMEOUT_MS + 1)
    await flushing
    expect(flushed).toBe(true)
    // Kept in the old place, so the page that comes back is still connected.
    expect(plain.m.has(PENDING)).toBe(true)
  })
  it('keeps a connection the keystore refused, through the reload, and moves it next time', async () => {
    let refuse = true
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: { ...store, set: async (k, v) => { if (refuse) throw new Error('locked'); return store.set(k, v) } } })
    await hydrateSecrets()
    setVaultConfig(config)
    await flushSecretWrites()
    expect(m.has(VAULT_CONFIG_KEY)).toBe(false)
    await reload()
    expect(getVaultConfig()?.vaultToken).toBe('tok-123')
    refuse = false
    await reload()
    expect(getVaultConfig()?.vaultToken).toBe('tok-123')
    expect(JSON.parse(kept(m)!)).toMatchObject({ vaultToken: 'tok-123' })
    expect(plain.m.has(PENDING)).toBe(false)
  })
  it('never lets an older copy overwrite a newer connection', async () => {
    // The first move fails, so the plaintext copy stays. The user then
    // connects to another account, which the keystore accepts.
    plain.m.set(VAULT_CONFIG_KEY, JSON.stringify(config))
    let refuse = true
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: { ...store, set: async (k, v) => { if (refuse) throw new Error('locked'); return store.set(k, v) } } })
    await hydrateSecrets()
    refuse = false
    setVaultConfig(other)
    await flushSecretWrites()
    await reload()
    expect(getVaultConfig()).toMatchObject(other)
    expect(JSON.parse(kept(m)!)).toMatchObject({ vaultToken: 'tok-456' })
    expect(plain.m.has(VAULT_CONFIG_KEY)).toBe(false)
  })
  it('stays disconnected when the keystore refuses the removal, and removes it next time', async () => {
    let refuse = false
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: { ...store, remove: async (k) => { if (refuse) throw new Error('locked'); return store.remove(k) } } })
    await hydrateSecrets()
    setVaultConfig(config)
    await flushSecretWrites()
    refuse = true
    setVaultConfig(null)
    await flushSecretWrites()
    expect(m.has(VAULT_CONFIG_KEY)).toBe(true) // the keystore still has it
    await reload()
    expect(getVaultConfig()).toBeNull()
    expect(isVaultEnabled()).toBe(false)
    refuse = false
    await reload()
    expect(m.has(VAULT_CONFIG_KEY)).toBe(false)
    expect(plain.m.has(PENDING)).toBe(false)
    expect(getVaultConfig()).toBeNull()
  })
  it('runs keystore calls one at a time, in the order they were asked', async () => {
    // A store that finishes a removal slowly and a write quickly.
    const m = new Map<string, string>()
    const slow: SecureStore = {
      get: async (k) => m.get(k) ?? null,
      set: async (k, v) => { m.set(k, v) },
      remove: (k) => new Promise<void>((resolve) => setTimeout(() => { m.delete(k); resolve() }, 20)),
    }
    registerShell({ secureStore: slow })
    void secureOp((s) => s.remove('k'))
    await secureOp((s) => s.set('k', 'kept'))
    expect(m.get('k')).toBe('kept')
  })
})

describe('the root key in a keystore', () => {
  const ENTRY = 'crypto.db-root-key'
  it('goes through the sync package\'s hooks, and reloads wait for it', async () => {
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: store })
    await hydrateSecrets()
    setVaultConfig(config)
    const cfg = dbCryptoConfig()
    expect(await cfg.nativeGetSyncKey!()).toBeNull()
    cfg.nativeStoreSyncKey!('root-key-blob')
    await flushSecretWrites()
    expect(JSON.parse(m.get(ENTRY)!)).toEqual({ for: 'https://vault.example|home', key: 'root-key-blob' })
    expect(await cfg.nativeGetSyncKey!()).toBe('root-key-blob')
    cfg.nativeStoreSyncKey!(null)
    await flushSecretWrites()
    expect(m.has(ENTRY)).toBe(false)
  })
  it('lands a clear-then-store in that order, whatever the keystore does', async () => {
    const m = new Map<string, string>()
    registerShell({ secureStore: {
      get: async (k) => m.get(k) ?? null,
      set: async (k, v) => { m.set(k, v) },
      remove: (k) => new Promise<void>((resolve) => setTimeout(() => { m.delete(k); resolve() }, 20)),
    } })
    await hydrateSecrets()
    setVaultConfig(config)
    const cfg = dbCryptoConfig()
    cfg.nativeStoreSyncKey!(null)
    cfg.nativeStoreSyncKey!('new-key')
    await flushSecretWrites()
    expect(await cfg.nativeGetSyncKey!()).toBe('new-key')
  })
  it('never hands one account\'s key to another', async () => {
    const { store, m } = fakeKeystore()
    registerShell({ secureStore: store })
    await hydrateSecrets()
    setVaultConfig(config)
    dbCryptoConfig().nativeStoreSyncKey!('home-key')
    await flushSecretWrites()
    // The account changes and the removal of the old key is lost.
    setVaultConfig(other)
    await flushSecretWrites()
    expect(await dbCryptoConfig().nativeGetSyncKey!()).toBeNull()
    await flushSecretWrites()
    expect(m.has(ENTRY)).toBe(false)
  })
  it('treats a keystore that throws on read as no key, so the passphrase is asked for', async () => {
    registerShell({ secureStore: fakeKeystore({ get: async () => { throw new Error('locked') } }).store })
    expect(await dbCryptoConfig().nativeGetSyncKey!()).toBeNull()
  })
})
