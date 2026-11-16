import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerShell, type SecureStore } from '@/native/shell'
import { DEVICE_ID_KEY, getDeviceId } from './deviceId'
import { DEVICE_ENTRY, resetDeviceIdentityForTests, settleDeviceIdentity } from './deviceIdentity'
import { restoredCopyNotice } from './restoredCopy'
import { VAULT_CONFIG_KEY, flushSecretWrites, hydrateSecrets, resetSecretsForTests } from './secrets'
import { isVaultEnabled } from './vaultConfig'
import { connectSelfHosted } from './vaultConnect'

// The one thing here that needs the database: who held the old device.
const inherit = vi.hoisted(() => ({ link: vi.fn(async (_from: string) => {}) }))
vi.mock('@/db/queries', () => ({ inheritDeviceLink: inherit.link }))

function fakeStorage(seed: Record<string, string> = {}) {
  const m = new Map<string, string>(Object.entries(seed))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}
function fakeKeystore(seed: Record<string, string> = {}, over: Partial<SecureStore> = {}) {
  const m = new Map<string, string>(Object.entries(seed))
  const store: SecureStore = { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v), remove: async (k) => void m.delete(k), ...over }
  return { store, m }
}

const STREAM_OWNER = 'tg_stream_for'
const ASKED = 'tg_notify_asked'
const CAME_FROM = 'tg_device_came_from'
const connection = { vaultUrl: 'https://vault.example', vaultToken: 'tok-123', accountId: 'home' }
// A connection as the keystore holds it: the value in its revision envelope.
const keptConnection = JSON.stringify({ rev: 5, value: JSON.stringify({ enabled: true, ...connection }) })

let page: ReturnType<typeof fakeStorage>
// The app on a phone: this page's storage, this Keychain.
function phone(storage: Record<string, string>, keychain: Record<string, string>, over: Partial<SecureStore> = {}, bound = true) {
  page = fakeStorage(storage)
  vi.stubGlobal('localStorage', page)
  const k = fakeKeystore(keychain, over)
  registerShell({ secureStore: k.store, deviceBoundKeystore: bound })
  resetSecretsForTests()
  resetDeviceIdentityForTests()
  return k
}
// The boot order of main.tsx.
const boot = async () => { const outcome = await settleDeviceIdentity(); await hydrateSecrets(); await flushSecretWrites(); return outcome }

beforeEach(() => { inherit.link.mockClear(); vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { registerShell(null); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('a shell whose keystore travels with the storage, or the web', () => {
  it('leaves the device id where it is', async () => {
    const { m } = phone({ [DEVICE_ID_KEY]: 'phone-a' }, {}, {}, false)
    expect(await boot()).toBe('not-bound')
    expect(getDeviceId()).toBe('phone-a')
    expect(m.has(DEVICE_ENTRY)).toBe(false)
  })
})

describe('on its own device', () => {
  it('a new install takes an id and keeps it in both places', async () => {
    const { m } = phone({}, {})
    expect(await boot()).toBe('new')
    expect(m.get(DEVICE_ENTRY)).toBeTruthy()
    expect(getDeviceId()).toBe(m.get(DEVICE_ENTRY))
    expect(inherit.link).not.toHaveBeenCalled()
  })
  it('changes nothing on an ordinary start, and stays connected', async () => {
    const { m } = phone({ [DEVICE_ID_KEY]: 'phone-a', [STREAM_OWNER]: 'x', [ASKED]: '1' }, { [DEVICE_ENTRY]: 'phone-a', [VAULT_CONFIG_KEY]: keptConnection })
    expect(await boot()).toBe('same')
    expect(getDeviceId()).toBe('phone-a')
    expect(isVaultEnabled()).toBe(true)
    expect(m.has(VAULT_CONFIG_KEY)).toBe(true)
    expect(page.m.get(ASKED)).toBe('1')
    expect(restoredCopyNotice()).toBe(false)
  })
  it('puts the id back when the page lost its storage', async () => {
    phone({}, { [DEVICE_ENTRY]: 'phone-a', [VAULT_CONFIG_KEY]: keptConnection })
    expect(await boot()).toBe('put-back')
    expect(getDeviceId()).toBe('phone-a')
    expect(isVaultEnabled()).toBe(true)
  })
  it('a connected build from before the check keeps its id', async () => {
    const { m } = phone({ [DEVICE_ID_KEY]: 'phone-a', [STREAM_OWNER]: 'x' }, { [VAULT_CONFIG_KEY]: keptConnection })
    expect(await boot()).toBe('kept')
    expect(m.get(DEVICE_ENTRY)).toBe('phone-a')
    expect(getDeviceId()).toBe('phone-a')
    expect(isVaultEnabled()).toBe(true)
    expect(restoredCopyNotice()).toBe(false)
  })
  it('does nothing when the keystore does not answer, and asks again next time', async () => {
    const { m } = phone({ [DEVICE_ID_KEY]: 'phone-a', [STREAM_OWNER]: 'x' }, {}, { get: async () => { throw new Error('locked') } })
    expect(await boot()).toBe('unknown')
    expect(getDeviceId()).toBe('phone-a')
    expect(m.size).toBe(0)
    expect(page.m.has(STREAM_OWNER)).toBe(true)
    expect(restoredCopyNotice()).toBe(false)
  })
})

describe('storage that came from another device', () => {
  // What a backup of a connected phone carries: its id, its cursors, the
  // answer to "may I notify". Not its Keychain.
  const backup = { [DEVICE_ID_KEY]: 'phone-a', [STREAM_OWNER]: 'https://vault.example|home', 'thingglance-db-sync-hwm': '41', [ASKED]: '1' }

  it('takes a new id, keeps the data\'s member, and says it is not syncing', async () => {
    const { m } = phone(backup, {})
    expect(await boot()).toBe('restored')
    const id = getDeviceId()
    expect(id).not.toBe('phone-a')
    expect(m.get(DEVICE_ENTRY)).toBe(id)
    expect(inherit.link).toHaveBeenCalledExactlyOnceWith('phone-a')
    expect(page.m.has(CAME_FROM)).toBe(false)
    expect(isVaultEnabled()).toBe(false)
    expect(restoredCopyNotice()).toBe(true)
    // The other device's cursors and its answer about notifications are not this one's.
    expect(page.m.has('thingglance-db-sync-hwm')).toBe(false)
    expect(page.m.has(ASKED)).toBe(false)
  })
  it('is settled: the next start changes nothing more', async () => {
    const { m } = phone(backup, {})
    await boot()
    const id = getDeviceId()
    inherit.link.mockClear()
    resetSecretsForTests(); resetDeviceIdentityForTests()
    expect(await boot()).toBe('same')
    expect(getDeviceId()).toBe(id)
    expect(m.get(DEVICE_ENTRY)).toBe(id)
    expect(inherit.link).not.toHaveBeenCalled()
    expect(restoredCopyNotice()).toBe(true)
  })
  it('says nothing about syncing when the copy never synced', async () => {
    phone({ [DEVICE_ID_KEY]: 'phone-a' }, {})
    expect(await boot()).toBe('restored')
    expect(getDeviceId()).not.toBe('phone-a')
    expect(restoredCopyNotice()).toBe(false)
  })
  it('drops a credential the old device had left in the page\'s storage', async () => {
    // The old device's keystore refused a write, so the token was waiting in
    // localStorage when the backup was made (secrets.ts).
    const pending = JSON.stringify({ rev: 9, value: JSON.stringify({ enabled: true, ...connection }) })
    const { m } = phone({ ...backup, [`${VAULT_CONFIG_KEY}.pending`]: pending }, {})
    await boot()
    expect(isVaultEnabled()).toBe(false)
    expect(m.has(VAULT_CONFIG_KEY)).toBe(false)
    expect([...page.m.values()].join(' ')).not.toContain('tok-123')
  })
  it('onto a device that already has an id: that id, and none of what its Keychain held', async () => {
    // An earlier install's Keychain items outlive the app, and a backup brings
    // the "first run done" flag that would have cleared them.
    const { m } = phone(backup, { [DEVICE_ENTRY]: 'phone-b', [VAULT_CONFIG_KEY]: keptConnection, 'crypto.db-root-key': '{"for":"x","key":"y"}' })
    expect(await boot()).toBe('restored')
    expect(getDeviceId()).toBe('phone-b')
    expect(m.get(DEVICE_ENTRY)).toBe('phone-b')
    expect(m.has(VAULT_CONFIG_KEY)).toBe(false)
    expect(m.has('crypto.db-root-key')).toBe(false)
    expect(isVaultEnabled()).toBe(false)
    expect(inherit.link).toHaveBeenCalledExactlyOnceWith('phone-a')
  })
  it('a start cut short after the keystore took the new id is finished by the next', async () => {
    // The keystore commits at once; the page's storage may not have been
    // written when the process ended. What is left looks like the case above.
    const { m } = phone(backup, { [DEVICE_ENTRY]: 'phone-new' })
    expect(await boot()).toBe('restored')
    expect(getDeviceId()).toBe('phone-new')
    expect(m.get(DEVICE_ENTRY)).toBe('phone-new')
    expect(inherit.link).toHaveBeenCalledExactlyOnceWith('phone-a')
    expect(restoredCopyNotice()).toBe(true)
  })
  it('carries the member over at a later start when it could not the first time', async () => {
    phone(backup, {})
    inherit.link.mockRejectedValueOnce(new Error('the database is not ready'))
    expect(await boot()).toBe('restored')
    expect(page.m.get(CAME_FROM)).toBe('phone-a')
    resetSecretsForTests(); resetDeviceIdentityForTests()
    expect(await boot()).toBe('same')
    expect(inherit.link).toHaveBeenLastCalledWith('phone-a')
    expect(page.m.has(CAME_FROM)).toBe(false)
  })
  it('the note goes when the device is connected again', async () => {
    phone(backup, {})
    await boot()
    expect(restoredCopyNotice()).toBe(true)
    await connectSelfHosted(connection)
    expect(restoredCopyNotice()).toBe(false)
    expect(isVaultEnabled()).toBe(true)
  })
})

describe('asked twice in one start', () => {
  it('answers with the first run', async () => {
    const get = vi.fn(async () => null)
    phone({}, {}, { get })
    const [a, b] = await Promise.all([settleDeviceIdentity(), settleDeviceIdentity()])
    expect([a, b]).toEqual(['new', 'new'])
    expect(get).toHaveBeenCalledTimes(1)
  })
})
