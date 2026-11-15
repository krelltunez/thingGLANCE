import { describe, expect, it } from 'vitest'
import { ownedSince, ownershipId, ownershipRow } from './ownership'
import { readOwnership } from './shape'
import type { Ownership } from './types'

const NOW = '2026-11-16T09:00:00.000Z'
const fact = { since: '2026-11-15T18:00:00.000Z', store: 'play', version: '1.0.0' }

describe('the record that the app was bought', () => {
  it('is one row per device, named for the device', () => {
    const row = ownershipRow(undefined, 'dev-1', fact, NOW)
    expect(row).toEqual({ id: 'owned:dev-1', kind: 'owned', deviceId: 'dev-1', since: fact.since, store: 'play', version: '1.0.0', createdAt: NOW, updatedAt: NOW })
    expect(ownershipId('dev-1')).toBe('owned:dev-1')
  })

  it('writes nothing when the shell reports what is already held', () => {
    const held = ownershipRow(undefined, 'dev-1', fact, NOW)!
    expect(ownershipRow(held, 'dev-1', fact, '2026-12-01T00:00:00.000Z')).toBeNull()
  })

  it('only ever moves a device\'s date earlier', () => {
    const held = ownershipRow(undefined, 'dev-1', fact, NOW)!
    // A reinstall reports a later first install: the purchase is as old as it was.
    expect(ownershipRow(held, 'dev-1', { since: '2027-03-01T00:00:00.000Z', store: 'play', version: '1.4.0' }, NOW)).toBeNull()
    // An older record turns up (restored from the phone's backup): it wins, whole.
    const older = ownershipRow(held, 'dev-1', { since: '2026-11-01T00:00:00.000Z', store: 'play', version: '0.9.0' }, '2026-12-01T00:00:00.000Z')!
    expect(older).toMatchObject({ since: '2026-11-01T00:00:00.000Z', version: '0.9.0', createdAt: NOW, updatedAt: '2026-12-01T00:00:00.000Z' })
  })

  it('answers the household\'s earliest purchase', () => {
    const a = ownershipRow(undefined, 'a', fact, NOW)!
    const b = ownershipRow(undefined, 'b', { ...fact, since: '2026-11-10T00:00:00.000Z' }, NOW)!
    expect(ownedSince([a, b])?.deviceId).toBe('b')
    expect(ownedSince([])).toBeNull()
  })
})

describe('an ownership row arriving from a vault or a backup', () => {
  const row: Ownership = ownershipRow(undefined, 'dev-1', fact, NOW)!

  it('is kept as it is, with a store this build has not heard of', () => {
    expect(readOwnership(row)).toEqual(row)
    expect(readOwnership({ ...row, store: 'appstore' })?.store).toBe('appstore')
  })

  it('is not a record without its date, its device or its kind', () => {
    expect(readOwnership({ ...row, since: '' })).toBeNull()
    expect(readOwnership({ ...row, since: 'soon' })).toBeNull()
    expect(readOwnership({ ...row, deviceId: undefined })).toBeNull()
    expect(readOwnership({ ...row, kind: 'device' })).toBeNull()
    expect(readOwnership(null)).toBeNull()
  })
})
