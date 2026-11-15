import { describe, expect, it, vi } from 'vitest'
import { HEADLESS_BRIDGE_METHODS, HEADLESS_OUTCOMES, headlessSecureStore, isHeadlessRequest, type HeadlessBridge } from './headlessMode'
import { headlessFetch } from './headlessHttp'
import { headlessSurface, runHeadlessRefresh, type HeadlessDeps, type HeadlessRoad } from './headlessRefresh'

// A bridge that records what was asked of it, in order.
function fakeBridge(over: Partial<HeadlessBridge> = {}) {
  const calls: string[] = []
  const reports: unknown[] = []
  const bridge: HeadlessBridge = {
    secureGet: () => '{"value":null}',
    secureSet: () => '{"value":null}',
    secureDelete: () => '{"value":null}',
    httpRequestAsync: () => {},
    updateSnapshot: () => { calls.push('updateSnapshot') },
    pendingWrites: () => '[]',
    acknowledgeWrites: () => { calls.push('acknowledgeWrites') },
    shouldAbort: () => false,
    done: (json) => { calls.push('done'); reports.push(JSON.parse(json)) },
    ...over,
  }
  return { bridge, calls, reports }
}

function run(over: Partial<HeadlessDeps> = {}, bridgeOver: Partial<HeadlessBridge> = {}) {
  const b = fakeBridge(bridgeOver)
  const steps: string[] = []
  const road = (name: string, fail?: string): HeadlessRoad => ({ name, run: async () => { steps.push(`sync:${name}`); if (fail) throw new Error(fail) } })
  const deps: HeadlessDeps = {
    bridge: b.bridge,
    prepare: async () => { steps.push('prepare') },
    buildRoads: async () => [road('vault'), road('roster')],
    applyWrites: async (_surface, after) => { steps.push('apply'); await after(); return 0 },
    pushSnapshot: async () => { steps.push('push') },
    now: () => 1000,
    ...over,
  }
  return { ...b, steps, road, result: runHeadlessRefresh(deps) }
}

describe('a background refresh', () => {
  it('syncs, applies what was done on the home screen, and hands over a snapshot', async () => {
    const r = run()
    expect(await r.result).toMatchObject({ outcome: HEADLESS_OUTCOMES.RAN, synced: ['vault', 'roster'], applied: 0 })
    expect(r.steps).toEqual(['prepare', 'sync:vault', 'sync:roster', 'apply', 'push'])
    expect(r.reports).toHaveLength(1)
  })
  it('syncs a second time when something was applied, to push it, and pushes the snapshot after', async () => {
    const r = run({ applyWrites: async (_s, after) => { await after(); return 2 } })
    expect(await r.result).toMatchObject({ outcome: 'ran', applied: 2 })
    // prepare, first sync, (apply pushes once before acknowledging), second sync, final push.
    expect(r.steps).toEqual(['prepare', 'sync:vault', 'sync:roster', 'push', 'sync:vault', 'sync:roster', 'push'])
  })
  it('still refreshes the home screen on a device with no vault', async () => {
    const r = run({ buildRoads: async () => [], applyWrites: async () => 0 })
    expect(await r.result).toMatchObject({ outcome: 'ran', synced: [] })
    expect(r.steps).toEqual(['prepare', 'push'])
  })
  it('reports a road that failed, and still does the rest', async () => {
    const r = run({ buildRoads: async () => [{ name: 'vault', run: async () => { throw new Error('offline') } }] })
    expect(await r.result).toMatchObject({ outcome: 'failed', reason: 'vault: offline' })
    expect(r.steps).toContain('push')
  })
  it('reports what a road said through its error callback', async () => {
    const r = run({ buildRoads: async (report) => { report('vault', 'locked'); return [] } })
    expect(await r.result).toMatchObject({ outcome: 'failed', reason: 'vault: locked' })
  })
  it('stops between steps when the app is opened', async () => {
    let opened = false
    const r = run({ applyWrites: async () => { opened = true; return 0 } }, { shouldAbort: () => opened })
    expect(await r.result).toMatchObject({ outcome: 'aborted', reason: 'app opened' })
    expect(r.steps).not.toContain('push')
    const early = run({}, { shouldAbort: () => true })
    expect(await early.result).toMatchObject({ outcome: 'aborted' })
    expect(early.steps).toEqual([])
  })
  it('never throws, whatever goes wrong inside it', async () => {
    const r = run({ prepare: async () => { throw new Error('boom') } })
    expect(await r.result).toMatchObject({ outcome: 'failed', reason: 'boom' })
    const deaf = run({}, { done: () => { throw new Error('bridge gone') } })
    expect((await deaf.result).outcome).toBe('ran')
  })
})

describe('what a run may ask of the shell', () => {
  it('only uses methods on the allowlist', async () => {
    const used = new Set<string>()
    const { bridge } = fakeBridge()
    const watched = new Proxy(bridge, { get: (target, prop: string) => { used.add(prop); return target[prop as keyof HeadlessBridge] } })
    const surface = headlessSurface(watched)
    await surface.updateSnapshot('{}'); await surface.pendingWrites(); await surface.acknowledgeWrites(['a'], {})
    const store = headlessSecureStore(watched)
    await store.get('k'); await store.set('k', 'v'); await store.remove('k')
    vi.stubGlobal('window', {})
    try {
      void headlessFetch(watched)('https://vault.example/x').catch(() => {})
      await Promise.resolve()
    } finally {
      vi.unstubAllGlobals()
    }
    watched.shouldAbort(); watched.done('{}')
    expect([...used].sort()).toEqual([...HEADLESS_BRIDGE_METHODS].sort())
  })
  it('tells "nothing stored" from "could not read" in the keystore', async () => {
    const store = headlessSecureStore(fakeBridge({ secureGet: (k) => (k === 'held' ? '{"value":"x"}' : k === 'broken' ? '{"error":"the keystore is unavailable"}' : '{"value":null}') }).bridge)
    expect(await store.get('held')).toBe('x')
    expect(await store.get('absent')).toBeNull()
    await expect(store.get('broken')).rejects.toThrow('unavailable')
  })
  it('acknowledges writes by id, and says how each went', async () => {
    const acknowledged = vi.fn()
    await headlessSurface(fakeBridge({ acknowledgeWrites: acknowledged }).bridge).acknowledgeWrites(['widget:1', 'notification:x:done'], { 'widget:1': { success: true, event_key: 'k' } })
    expect(JSON.parse(acknowledged.mock.calls[0][0])).toEqual(['widget:1', 'notification:x:done'])
    // The second argument is what an automation app is answered with.
    expect(JSON.parse(acknowledged.mock.calls[0][1])).toEqual({ 'widget:1': { success: true, event_key: 'k' } })
  })
})

describe('the headless request', () => {
  it('is recognised only by its own query', () => {
    expect(isHeadlessRequest('?headless=refresh')).toBe(true)
    expect(isHeadlessRequest('?headless=refresh&x=1')).toBe(true)
    for (const no of ['', '?headless=1', '?link=thing/abc', null, undefined]) expect(isHeadlessRequest(no)).toBe(false)
  })
})

describe('http for a headless run', () => {
  it('goes out through the bridge and comes back as a Response', async () => {
    vi.stubGlobal('window', {})
    try {
      const sent: unknown[] = []
      const { bridge } = fakeBridge({ httpRequestAsync: (id, method, url, headers, body) => {
        sent.push({ method, url, headers: JSON.parse(headers), body })
        queueMicrotask(() => (window as unknown as { __tgHeadlessHttpDone: (m: unknown) => void }).__tgHeadlessHttpDone({ id, result: { status: 200, body: '{"rows":[]}', headers: { 'content-type': 'application/json' } } }))
      } })
      const res = await headlessFetch(bridge)('https://vault.example/sync/thingglance/batch', { method: 'post', headers: { Authorization: 'Bearer tok' }, body: '{"a":1}' })
      expect(sent).toEqual([{ method: 'POST', url: 'https://vault.example/sync/thingglance/batch', headers: { authorization: 'Bearer tok' }, body: '{"a":1}' }])
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ rows: [] })
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('turns a transport error into a rejection, and a 204 into an empty Response', async () => {
    vi.stubGlobal('window', {})
    try {
      const answer = (result: unknown) => fakeBridge({ httpRequestAsync: (id) => queueMicrotask(() => (window as unknown as { __tgHeadlessHttpDone: (m: unknown) => void }).__tgHeadlessHttpDone({ id, result })) }).bridge
      await expect(headlessFetch(answer({ error: 'unreachable' }))('https://vault.example/x')).rejects.toThrow('unreachable')
      const empty = await headlessFetch(answer({ status: 204, body: '', headers: {} }))('https://vault.example/x')
      expect(empty.status).toBe(204)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('a send that could not go out', async () => {
  const { isUnsentSend } = await import('@/native/widgetBridge')
  it('stays queued when the vault could not be reached, so the task is not lost', () => {
    expect(isUnsentSend({ action: 'send', clientId: 'w' }, { success: false, code: 'failed', error: 'Could not reach GLANCEvault' })).toBe(true)
  })
  it('is finished with in every other case', () => {
    // Sent, or sent before.
    expect(isUnsentSend({ action: 'send', clientId: 'w' }, { success: true })).toBe(false)
    expect(isUnsentSend({ action: 'send', clientId: 'w' }, { success: true, deduped: true })).toBe(false)
    // dayGLANCE was switched off, or the date is gone: trying again cannot help.
    expect(isUnsentSend({ action: 'send', clientId: 'w' }, { success: false, code: 'unavailable' })).toBe(false)
    expect(isUnsentSend({ action: 'send', clientId: 'w' }, { success: false, code: 'not_found' })).toBe(false)
    // A "done" never waits on the network.
    expect(isUnsentSend({ action: 'decide', clientId: 'w' }, { success: false, code: 'failed' })).toBe(false)
  })
})
