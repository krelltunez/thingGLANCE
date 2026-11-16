import { describe, expect, it, vi } from 'vitest'
import { DESKTOP_BRIDGE_METHODS, desktopBridge } from './desktop'
import { desktopFetch, installDesktopWake, menuLabels } from './desktopShell'
import type { DesktopHttpResult } from './desktop'

const http = (result: DesktopHttpResult) => ({ request: vi.fn(async () => result) })

describe('desktopFetch: the app\'s fetch, made by the main process', () => {
  it('sends the method, headers and string body, and hands back a Response', async () => {
    const h = http({ status: 200, statusText: 'OK', body: '{"ok":true}', headers: { 'content-type': 'application/json' } })
    const res = await desktopFetch(h)('https://vault.example.com/sync', { method: 'post', headers: { Authorization: 'Bearer t' }, body: '{"a":1}' })
    expect(h.request).toHaveBeenCalledWith('POST', 'https://vault.example.com/sync', { authorization: 'Bearer t' }, '{"a":1}')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('defaults to GET with no body, and takes a URL or a Request', async () => {
    const h = http({ status: 200, statusText: 'OK', body: '', headers: {} })
    await desktopFetch(h)(new URL('https://vault.example.com/healthz'))
    expect(h.request).toHaveBeenCalledWith('GET', 'https://vault.example.com/healthz', {}, null)
  })

  it('rejects like fetch when no response came', async () => {
    await expect(desktopFetch(http({ error: 'Private/reserved address' }))('http://192.168.1.4/')).rejects.toThrow(TypeError)
  })

  it('builds a bodiless Response for the statuses that may not carry one', async () => {
    const res = await desktopFetch(http({ status: 204, statusText: 'No Content', body: '', headers: {} }))('https://vault.example.com/x', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })

  it('refuses a body it cannot send as text', async () => {
    await expect(desktopFetch(http({ status: 200, statusText: 'OK', body: '', headers: {} }))('https://vault.example.com/x', { method: 'POST', body: new Uint8Array(2) })).rejects.toThrow(TypeError)
  })
})

describe('the wake signal', () => {
  it('replays visibilitychange, which is what sync and the intents poll kick on', () => {
    let wake: (why: unknown) => void = () => {}
    const off = vi.fn()
    const doc = { dispatchEvent: vi.fn(() => true) }
    const stop = installDesktopWake({ shell: { onWake: (l: (why: unknown) => void) => { wake = l; return off } } as never }, doc)
    wake('resume')
    expect(doc.dispatchEvent).toHaveBeenCalledTimes(1)
    expect((doc.dispatchEvent.mock.calls[0] as unknown as [Event])[0].type).toBe('visibilitychange')
    stop()
    expect(off).toHaveBeenCalled()
  })
})

describe('the bridge', () => {
  it('is absent anywhere but the desktop app', () => {
    expect(desktopBridge()).toBeNull()
  })

  it('lists each method once', () => {
    expect(new Set(DESKTOP_BRIDGE_METHODS).size).toBe(DESKTOP_BRIDGE_METHODS.length)
  })

  it('has a word for every menu label the main process needs', () => {
    const labels = menuLabels()
    expect(Object.values(labels).every((v) => typeof v === 'string' && v.length > 0)).toBe(true)
    expect(labels.quit).toBe('Quit')
  })
})
