import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SseUnsupportedError, createNudgeCoalescer, createVaultEventClient, drainSseBuffer, parseSseFrame,
  type SseClientState, type openWebSseStream,
} from './vaultEventStream'

describe('SSE parsing', () => {
  it('reads the data line and ignores the event name, comments and other fields', () => {
    expect(parseSseFrame('event: activity\ndata: {"seq":7}')).toEqual({ seq: 7 })
    expect(parseSseFrame('event: ready\r\nid: 3\r\ndata: {"seq":0}')).toEqual({ seq: 0 })
    expect(parseSseFrame(': heartbeat')).toBeNull()
    expect(parseSseFrame('data: not json')).toBeNull()
    expect(parseSseFrame('')).toBeNull()
  })
  it('emits only complete events and carries the remainder across chunks', () => {
    const seen: unknown[] = []
    let rest = drainSseBuffer('event: ready\ndata: {"seq":1}\n\nevent: activity\ndata: {"se', (e) => seen.push(e))
    expect(seen).toEqual([{ seq: 1 }])
    rest = drainSseBuffer(`${rest}q":2}\r\n\r\n: ping\n\n`, (e) => seen.push(e))
    expect(seen).toEqual([{ seq: 1 }, { seq: 2 }])
    expect(rest).toBe('')
  })
})

describe('nudge coalescer', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('turns a burst into one drain and ignores stale seqs', () => {
    const onDrain = vi.fn()
    const c = createNudgeCoalescer({ onDrain, debounceMs: 400 })
    expect(c.handleEvent({ seq: 5 })).toBe(true)
    expect(c.handleEvent({ seq: 6 })).toBe(true)
    expect(c.handleEvent({ seq: 6 })).toBe(false)
    expect(c.handleEvent({ seq: 2 })).toBe(false)
    expect(c.handleEvent({ nope: true })).toBe(false)
    vi.advanceTimersByTime(399)
    expect(onDrain).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onDrain).toHaveBeenCalledTimes(1)
    expect(c.getCursor()).toBe(6)
  })
  it('survives a drain that throws', () => {
    const onDrainError = vi.fn()
    const c = createNudgeCoalescer({ onDrain: () => { throw new Error('boom') }, onDrainError })
    c.handleEvent({ seq: 1 })
    vi.advanceTimersByTime(400)
    expect(onDrainError).toHaveBeenCalledTimes(1)
    expect(c.handleEvent({ seq: 2 })).toBe(true)
  })
})

describe('event client', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  const connection = { vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }
  type Open = typeof openWebSseStream

  it('stops for good on a server without /events', async () => {
    const states: SseClientState[] = []
    const openStream = vi.fn<Open>(async () => { throw new SseUnsupportedError() })
    const client = createVaultEventClient({ getConnection: () => connection, openStream, onEvent: () => {}, onStateChange: (s) => states.push(s) })
    client.start()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(openStream).toHaveBeenCalledTimes(1)
    expect(states).toContain('unsupported-server')
    expect(client.isRunning()).toBe(false)
  })

  it('reconnects with backoff after a drop', async () => {
    const openStream = vi.fn<Open>(async () => { throw new Error('network') })
    const client = createVaultEventClient({ getConnection: () => connection, openStream, onEvent: () => {}, random: () => 0.5 })
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(openStream).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000) // first backoff: base * 2^0, jitter factor 1.0
    expect(openStream).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1999)
    expect(openStream).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(openStream).toHaveBeenCalledTimes(3)
    client.stop()
  })

  it('reports a stream that opens but stays silent', async () => {
    const states: SseClientState[] = []
    const openStream = vi.fn<Open>(({ onOpen, signal }) => new Promise((_, reject) => {
      onOpen?.()
      signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const client = createVaultEventClient({ getConnection: () => connection, openStream, onEvent: () => {}, onStateChange: (s) => states.push(s), readyTimeoutMs: 5000 })
    client.start()
    await vi.advanceTimersByTimeAsync(5000)
    expect(states).toContain('stalled')
    client.stop()
  })

  // The tab is hidden while the client is waiting to reconnect, then shown
  // again. The wait must end with the stop, or the loop never runs again.
  it('restarts after being stopped during a backoff wait', async () => {
    const openStream = vi.fn<Open>(async () => { throw new Error('network') })
    const client = createVaultEventClient({ getConnection: () => connection, openStream, onEvent: () => {}, random: () => 0.5 })
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(openStream).toHaveBeenCalledTimes(1)
    client.stop() // mid-backoff
    await vi.advanceTimersByTimeAsync(10_000)
    expect(openStream).toHaveBeenCalledTimes(1)
    client.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(openStream).toHaveBeenCalledTimes(2)
    client.stop()
  })
})

// ── a shell reads the stream and passes it in ───────────────────────────────

describe('a stream read by a shell', async () => {
  const { createBridgeSseClient, detectSseTransport } = await import('./vaultEventStream')
  const { registerShell } = await import('@/native/shell')
  const connection = { vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'home' }

  function harness(over: { connection?: typeof connection | null } = {}) {
    const events: unknown[] = []
    const states: [string, unknown?][] = []
    const native = { started: [] as unknown[], stopped: 0 }
    let fire: (() => void) | null = null
    const client = createBridgeSseClient({
      getConnection: () => (over.connection === undefined ? connection : over.connection),
      startNative: (c) => native.started.push(c),
      stopNative: () => { native.stopped += 1 },
      onEvent: (e) => events.push(e),
      onStateChange: (s, d) => states.push(d === undefined ? [s] : [s, d]),
      readyTimeoutMs: 5000,
      setTimeoutFn: ((fn: () => void) => { fire = fn; return 1 }) as unknown as typeof setTimeout,
      clearTimeoutFn: (() => { fire = null }) as unknown as typeof clearTimeout,
    })
    return { client, events, states, native, timeout: () => fire?.() }
  }

  it('says the stream is wanted once, with the connection', () => {
    const h = harness()
    expect(h.client.start()).toBe(true)
    expect(h.client.start()).toBe(false)
    expect(h.native.started).toEqual([connection])
    expect(h.states).toEqual([['connecting']])
  })
  it('does not start with nothing to connect to', () => {
    const h = harness({ connection: null })
    expect(h.client.start()).toBe(false)
    expect(h.native.started).toEqual([])
  })
  it('turns the shell\'s frames into the same events the web reader produces', () => {
    const h = harness()
    h.client.start()
    h.client.receive({ type: 'open' })
    h.client.receive({ type: 'frame', block: 'event: activity\ndata: {"seq":7,"app":"thingglance"}' })
    h.client.receive(JSON.stringify({ type: 'frame', block: 'data: {"seq":8}' }))
    expect(h.events).toEqual([{ seq: 7, app: 'thingglance' }, { seq: 8 }])
  })
  it('drops what makes no sense, and anything arriving when it is not running', () => {
    const h = harness()
    h.client.receive({ type: 'frame', block: 'data: {"seq":1}' })
    h.client.start()
    for (const junk of [null, 42, 'not json', {}, { type: 'frame' }, { type: 'frame', block: 'data: not json' }, { type: 'unknown' }]) h.client.receive(junk)
    expect(h.events).toEqual([])
  })
  it('reports an open stream that stays silent as stalled, once a frame would have come', () => {
    const quiet = harness()
    quiet.client.start()
    quiet.client.receive({ type: 'open' })
    quiet.timeout()
    expect(quiet.states.map((s) => s[0])).toEqual(['connecting', 'open', 'stalled'])
    const healthy = harness()
    healthy.client.start()
    healthy.client.receive({ type: 'open' })
    healthy.client.receive({ type: 'frame', block: 'data: {"seq":1}' })
    healthy.timeout()
    expect(healthy.states.map((s) => s[0])).toEqual(['connecting', 'open'])
  })
  it('tells a final stop from a passing error', () => {
    const h = harness()
    h.client.start()
    h.client.receive({ type: 'error', message: 'read timed out' })
    h.client.receive({ type: 'closed' })
    h.client.receive({ type: 'error', code: 'auth', message: 'refused' })
    h.client.receive({ type: 'error', code: 'unsupported', message: 'no /events' })
    expect(h.states.slice(1)).toEqual([['error', 'read timed out'], ['closed'], ['error', { code: 'auth', message: 'refused' }], ['unsupported-server']])
  })
  it('tells the shell when the stream is no longer wanted', () => {
    const h = harness()
    h.client.start()
    h.client.stop()
    h.client.stop()
    expect(h.native.stopped).toBe(1)
    expect(h.client.isRunning()).toBe(false)
  })
  it('is chosen over the web reader whenever a shell offers one', () => {
    vi.stubGlobal('window', {})
    try {
      registerShell({ fetch: (async () => new Response('')) as typeof fetch })
      expect(detectSseTransport()).toBe('none')
      registerShell({ fetch: (async () => new Response('')) as typeof fetch, eventStream: { start: () => {}, stop: () => {}, listen: () => () => {} } })
      expect(detectSseTransport()).toBe('shell')
    } finally {
      registerShell(null)
      vi.unstubAllGlobals()
    }
  })
})
