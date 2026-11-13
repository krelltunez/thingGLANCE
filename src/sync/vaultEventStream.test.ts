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
