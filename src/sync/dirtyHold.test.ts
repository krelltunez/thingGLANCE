import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DbSyncEngine } from '@glance-apps/sync'
import { registerShell } from '@/native/shell'
import { markDirty, registerDbEngine } from './dirtyTracker'
import { hydrateSecrets, resetSecretsForTests } from './secrets'
import { resetVaultSyncState, setVaultConfig, settleStreamOwner } from './vaultConfig'

function fakeStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}
const fakeEngine = () => ({ markDirty: vi.fn(), dbSyncCycle: vi.fn(async () => undefined) }) as unknown as DbSyncEngine & { markDirty: ReturnType<typeof vi.fn> }
const config = { enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'home' }
const HELD = 'tg_dirty_waiting'

let plain: ReturnType<typeof fakeStorage>
beforeEach(() => { plain = fakeStorage(); vi.stubGlobal('localStorage', plain); resetSecretsForTests(); registerDbEngine(null) })
afterEach(() => { registerDbEngine(null); registerShell(null); vi.unstubAllGlobals() })

describe('a change made before the sync engine is up', () => {
  it('is dropped when no vault is connected (connecting later uploads everything)', async () => {
    await hydrateSecrets()
    markDirty('t1')
    expect(plain.m.has(HELD)).toBe(false)
  })
  it('waits for the engine when a vault is connected, and is handed over once', async () => {
    await hydrateSecrets()
    setVaultConfig(config)
    // A widget tap landing before the app has mounted.
    markDirty('t1'); markDirty('t2'); markDirty('t1')
    expect(JSON.parse(plain.m.get(HELD)!)).toEqual(['t1', 't2'])
    const engine = fakeEngine()
    registerDbEngine(engine)
    expect(engine.markDirty.mock.calls.map((c) => c[0])).toEqual(['t1', 't2'])
    expect(plain.m.has(HELD)).toBe(false)
    markDirty('t3')
    expect(engine.markDirty).toHaveBeenLastCalledWith('t3')
    expect(plain.m.has(HELD)).toBe(false)
  })
  it('survives a launch where the keystore could not be read', async () => {
    registerShell({ secureStore: { get: async () => { throw new Error('busy') }, set: async () => {}, remove: async () => {} } })
    await hydrateSecrets()
    // This session cannot tell it is connected, so no engine ever registers.
    markDirty('edited-while-blind')
    expect(JSON.parse(plain.m.get(HELD)!)).toEqual(['edited-while-blind'])
    // The next launch reads the keystore and starts its engine.
    const engine = fakeEngine()
    registerDbEngine(engine)
    expect(engine.markDirty).toHaveBeenCalledWith('edited-while-blind')
  })
  it('is forgotten with the stream it belonged to', async () => {
    await hydrateSecrets()
    setVaultConfig(config)
    markDirty('t1')
    resetVaultSyncState()
    expect(plain.m.has(HELD)).toBe(false)
  })
})

describe('stream state belongs to one account', () => {
  const CURSOR = 'thingglance-db-sync-hwm'
  it('adopts the account on a device that has no owner recorded', async () => {
    await hydrateSecrets()
    setVaultConfig(config)
    plain.m.set(CURSOR, '42')
    expect(settleStreamOwner()).toBe(false)
    expect(plain.m.get(CURSOR)).toBe('42')
    expect(plain.m.get('tg_stream_for')).toBe('https://vault.example|home')
    expect(settleStreamOwner()).toBe(false)
  })
  it('drops cursors left by another account', async () => {
    await hydrateSecrets()
    setVaultConfig(config)
    settleStreamOwner()
    plain.m.set(CURSOR, '42')
    // The token changed account, and the reset that goes with it was lost.
    setVaultConfig({ ...config, accountId: 'cabin' })
    expect(settleStreamOwner()).toBe(true)
    expect(plain.m.has(CURSOR)).toBe(false)
    expect(plain.m.get('tg_stream_for')).toBe('https://vault.example|cabin')
  })
})
