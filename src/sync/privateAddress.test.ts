import { describe, expect, it, vi } from 'vitest'
import { blockedMessage, checkPrivateAddress, consentLabels, grantPrivateAddress } from './privateAddress'

describe('asking before a private address is tried', () => {
  it('is a no-op off the desktop', async () => {
    expect(await checkPrivateAddress('http://192.168.1.4:8791', null)).toBeNull()
  })

  it('says what is blocked and whether a grant could unlock it', async () => {
    const http = { inspect: vi.fn(async () => ({ blocked: true as const, canGrant: true as const, origin: 'http://192.168.1.4:8791', addresses: ['192.168.1.4'] })), grant: vi.fn() }
    expect(await checkPrivateAddress('http://192.168.1.4:8791', http)).toEqual({ origin: 'http://192.168.1.4:8791', canGrant: true })
  })

  it('lets a public address through, and never turns its own failure into a refusal', async () => {
    expect(await checkPrivateAddress('https://vault.example.com', { inspect: async () => ({ blocked: false }), grant: vi.fn() })).toBeNull()
    expect(await checkPrivateAddress('https://vault.example.com', { inspect: async () => { throw new Error('ipc') }, grant: vi.fn() })).toBeNull()
  })

  it('words a grantable address differently from a reserved one', () => {
    expect(blockedMessage({ origin: 'http://localhost:8791', canGrant: true })).toContain('needs your permission')
    expect(blockedMessage({ origin: 'http://169.254.1.1', canGrant: false })).toContain('will not connect')
  })
})

describe('allowing one', () => {
  it('sends the dialog\'s words and answers null once granted', async () => {
    const grant = vi.fn(async () => ({ ok: true }))
    expect(await grantPrivateAddress('http://localhost:8791', { inspect: vi.fn(), grant })).toBeNull()
    expect(grant).toHaveBeenCalledWith('http://localhost:8791', consentLabels())
    expect(Object.keys(consentLabels()).sort()).toEqual(['allow', 'cancel', 'question', 'resolvesTo', 'scope', 'title', 'warning', 'warningLoopback'])
  })

  it('answers the reason when declined, and a plain one when the call fails', async () => {
    expect(await grantPrivateAddress('http://localhost:8791', { inspect: vi.fn(), grant: async () => ({ ok: false, reason: 'Declined' }) })).toBe('Declined')
    expect(await grantPrivateAddress('http://localhost:8791', { inspect: vi.fn(), grant: async () => { throw new Error('ipc') } })).toBe('Could not allow this address.')
    expect(await grantPrivateAddress('http://localhost:8791', null)).toBe('Could not allow this address.')
  })
})
