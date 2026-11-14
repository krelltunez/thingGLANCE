// GLANCEvault live push: the web half of lastGLANCE's
// src/sync/vaultEventStream.ts (itself a port of dayGLANCE's), kept
// behaviour-for-behaviour so the family's clients treat a vault the same way.
//
// WIRE CONTRACT: GET {vaultUrl}/events?accountId= is an authenticated,
// per-account SSE stream. It emits `event: ready` once per connection and
// `event: activity` whenever the account's seq advances, each with data
// {"seq":N}, plus comment-line heartbeats. A nudge says only "something
// changed": sync writes and intent landings share the one counter, so the only
// correct response is to drain everything.
//
// CORE INVARIANT: push is an optimisation; POLLING IS THE CORRECTNESS BACKSTOP.
// Nothing here stops or slows the manager's cadence (interval, focus, online).
// A nudge only adds an instant drain on top, and every drain is idempotent.
//
// TRANSPORT: the browser's EventSource cannot send an Authorization header and
// the vault authenticates with a Bearer token, so this reads a fetch streaming
// body. Native shells cannot stream through CapacitorHttp and the desktop CSP
// gives the renderer no network: when those shells arrive they will own the
// socket and feed raw SSE blocks through parseSseFrame, as lastGLANCE's
// createBridgeSseClient does. Until then a shell falls back to polling.

import { shell } from '@/native/platform'
import { hasShellTransport, shellBridge } from '@/native/shell'

// ─── SSE frame parsing ───────────────────────────────────────────────────────

/**
 * Parse ONE SSE event block into its JSON data, or null when the block carries
 * none (a heartbeat comment, or unparseable data). The event name is ignored on
 * purpose: `ready` and `activity` carry the same instruction.
 */
export function parseSseFrame(block: string): unknown | null {
  if (!block) return null
  const dataLines: string[] = []
  for (const rawLine of block.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (!line || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1) // SSE strips one leading space
    if (field === 'data') dataLines.push(value)
  }
  if (dataLines.length === 0) return null
  try {
    return JSON.parse(dataLines.join('\n'))
  } catch {
    return null
  }
}

/**
 * Feed a growing text buffer, emit each COMPLETE event (delimited by a blank
 * line) and return the unconsumed remainder for the next chunk.
 */
export function drainSseBuffer(buffer: string, onEvent: (evt: unknown) => void): string {
  let buf = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  let idx: number
  while ((idx = buf.indexOf('\n\n')) !== -1) {
    const block = buf.slice(0, idx)
    buf = buf.slice(idx + 2)
    const evt = parseSseFrame(block)
    if (evt) onEvent(evt)
  }
  return buf
}

// ─── transport ───────────────────────────────────────────────────────────────

// 'web': the page reads the stream itself. 'shell': a shell reads it and
// passes the messages in (native/shell.ts: eventStream). 'none': polling only.
export type SseTransport = 'web' | 'shell' | 'none'

export function detectSseTransport(): SseTransport {
  if (typeof window === 'undefined') return 'none'
  if (shellBridge()?.eventStream) return 'shell'
  // The web reader streams a response on the page's own fetch, which a shell
  // either forbids or cannot stream. A shell with no reader of its own polls.
  if (shell() !== 'web' || hasShellTransport()) return 'none'
  return typeof fetch === 'function' && typeof ReadableStream !== 'undefined' ? 'web' : 'none'
}

export interface VaultSseConnection {
  vaultUrl: string
  vaultToken: string
  accountId: string
}

// GET /events answered 404: the server predates the endpoint. Terminal, because
// reconnecting cannot grow a route. Every other status may clear and is retried.
export class SseUnsupportedError extends Error {
  code = 'SSE_UNSUPPORTED' as const
  constructor() {
    super('vault SSE connect failed: 404 (this GLANCEvault server predates /events)')
  }
}

/**
 * Open the stream and pump parsed nudges to onEvent until it ends or the signal
 * aborts. Resolves on a clean server close; rejects on connect failure, network
 * error or abort, and with SseUnsupportedError on 404.
 *
 * `credentials: 'omit'` is load-bearing: the vault's CORS layer never sets
 * Access-Control-Allow-Credentials, so an include-credentials fetch is refused.
 */
export async function openWebSseStream({ connection, signal, onOpen, onEvent, fetchImpl }: {
  connection: VaultSseConnection
  signal?: AbortSignal
  onOpen?: () => void
  onEvent: (evt: unknown) => void
  fetchImpl?: typeof fetch
}): Promise<void> {
  const doFetch = fetchImpl || globalThis.fetch
  const url = `${connection.vaultUrl.replace(/\/+$/, '')}/events?accountId=${encodeURIComponent(connection.accountId)}`
  const res = await doFetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${connection.vaultToken}`, Accept: 'text/event-stream' },
    credentials: 'omit',
    signal,
  })
  if (res && res.status === 404) throw new SseUnsupportedError()
  if (!res || !res.ok || !res.body) throw new Error(`vault SSE connect failed: ${res ? res.status : 'no response'}`)
  onOpen?.()

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      buffer = drainSseBuffer(buffer, onEvent)
    }
  } finally {
    try { reader.releaseLock() } catch { /* ignore */ }
  }
}

// ─── nudge coalescer ─────────────────────────────────────────────────────────

export interface NudgeCoalescer {
  handleEvent: (evt: unknown) => boolean
  getCursor: () => number
  cancel: () => void
}

/**
 * Turns nudges into debounced drains. The account seq is one monotonic counter,
 * so a single cursor is right: a nudge matters only when its seq is higher than
 * the last one acted on. A burst within debounceMs becomes one drain.
 */
export function createNudgeCoalescer({ onDrain, debounceMs = 400, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, onDrainError }: {
  onDrain: () => void
  debounceMs?: number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  onDrainError?: (err: unknown) => void
}): NudgeCoalescer {
  let lastSeq = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null

  const flush = () => {
    timer = null
    // A throwing drain must never break the timer or the stream loop.
    try { onDrain() } catch (err) { onDrainError?.(err) }
  }

  return {
    handleEvent(evt) {
      const seq = (evt as { seq?: unknown } | null)?.seq
      if (typeof seq !== 'number' || Number.isNaN(seq)) return false
      if (seq <= lastSeq) return false // stale or duplicate
      lastSeq = seq
      if (timer) clearTimeoutFn(timer)
      timer = setTimeoutFn(flush, debounceMs)
      return true
    },
    getCursor: () => lastSeq,
    cancel: () => { if (timer) { clearTimeoutFn(timer); timer = null } },
  }
}

// ─── connection client (reconnect + backoff) ─────────────────────────────────

export type SseClientState = 'connecting' | 'open' | 'closed' | 'error' | 'stalled' | 'unsupported-server' | 'stopped'

export interface VaultEventClient {
  start: () => void
  stop: () => void
  isRunning: () => boolean
}

/**
 * Connect, pump events, and on any drop reconnect with capped, jittered
 * exponential backoff. The hardening is lastGLANCE's, each item earned:
 *   - Jitter (±25%), so a fleet of reconnecting devices does not synchronise
 *     into bursts against the vault's per-IP limiter.
 *   - A 404 is terminal ('unsupported-server').
 *   - A stream that opens but delivers no frame within readyTimeoutMs reports
 *     'stalled' once. The server sends `ready` immediately, so a silent open
 *     stream almost always means a buffering reverse proxy, the one failure
 *     polling would otherwise hide completely.
 *   - Backoff resets only after a connection stayed open for minStableMs, so
 *     an open-then-drop endpoint cannot cause a reconnect storm.
 */
export function createVaultEventClient({
  getConnection, openStream, onEvent,
  backoffBaseMs = 1000, backoffMaxMs = 30000, minStableMs = 5000, readyTimeoutMs = 5000,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, now = () => Date.now(), random = Math.random, onStateChange,
}: {
  getConnection: () => VaultSseConnection | null
  openStream: typeof openWebSseStream
  onEvent: (evt: unknown) => void
  backoffBaseMs?: number
  backoffMaxMs?: number
  minStableMs?: number
  readyTimeoutMs?: number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
  now?: () => number
  random?: () => number
  onStateChange?: (state: SseClientState, detail?: unknown) => void
}): VaultEventClient {
  let stopped = true
  let looping = false
  let attempt = 0
  let abortController: AbortController | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  // Resolves the backoff wait early. Without it, a stop() during the wait
  // would clear the timer and leave the loop suspended for good, so a later
  // start() would find it "still looping" and never reconnect.
  let wake: (() => void) | null = null

  const clearReadyTimer = () => { if (readyTimer) { clearTimeoutFn(readyTimer); readyTimer = null } }

  const loop = async () => {
    if (looping) return
    looping = true
    while (!stopped) {
      const connection = getConnection()
      if (!connection) break
      abortController = new AbortController()
      onStateChange?.('connecting')
      const startedAt = now()
      try {
        await openStream({
          connection,
          signal: abortController.signal,
          onOpen: () => {
            onStateChange?.('open')
            clearReadyTimer()
            readyTimer = setTimeoutFn(() => { readyTimer = null; onStateChange?.('stalled') }, readyTimeoutMs)
          },
          onEvent: (evt) => { clearReadyTimer(); onEvent(evt) },
        })
        onStateChange?.('closed')
      } catch (err) {
        if ((err as { code?: string } | null)?.code === 'SSE_UNSUPPORTED') {
          onStateChange?.('unsupported-server', err)
          stopped = true
          break
        }
        if (!stopped) onStateChange?.('error', err)
      } finally {
        clearReadyTimer()
      }
      if (stopped) break
      if (now() - startedAt >= minStableMs) attempt = 0
      const delay = Math.min(backoffMaxMs, backoffBaseMs * 2 ** attempt) * (0.75 + random() * 0.5)
      attempt += 1
      await new Promise<void>((resolve) => { wake = resolve; reconnectTimer = setTimeoutFn(resolve, delay) })
      wake = null
      reconnectTimer = null
    }
    looping = false
  }

  return {
    start() {
      stopped = false
      if (!looping) { attempt = 0; void loop() }
    },
    stop() {
      stopped = true
      clearReadyTimer()
      if (abortController) { try { abortController.abort() } catch { /* ignore */ } abortController = null }
      if (reconnectTimer) { clearTimeoutFn(reconnectTimer); reconnectTimer = null }
      wake?.()
      onStateChange?.('stopped')
    },
    isRunning: () => !stopped,
  }
}

// ─── shell-fed client (the shell owns the socket) ────────────────────────────

export interface BridgeSseClient {
  // Fed every message the shell's reader produces.
  receive: (message: unknown) => void
  start: () => boolean
  stop: () => void
  isRunning: () => boolean
}

/**
 * The page's half when a shell reads the stream (ported from the sibling
 * apps). The shell owns the socket and all of its life: it connects while the
 * app is on screen, drops in the background, and reconnects with backoff. This
 * only says "wanted" or "not wanted" with the connection, and feeds the raw
 * blocks the shell passes in through the same parseSseFrame and onEvent the
 * web reader uses. There is no reconnect loop here on purpose: one owner per
 * transport.
 *
 * A message with a `code` means the reader stopped for good ('auth',
 * 'insecure', 'unsupported') and is reported once. As on the web, a stream
 * that opens and delivers nothing within readyTimeoutMs is reported 'stalled':
 * the vault sends a frame at once, so silence means something in between is
 * holding the response back.
 */
export function createBridgeSseClient({
  getConnection, startNative, stopNative, onEvent, onStateChange,
  readyTimeoutMs = 5000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
}: {
  getConnection: () => VaultSseConnection | null
  startNative: (connection: VaultSseConnection) => void
  stopNative: () => void
  onEvent: (evt: unknown) => void
  onStateChange?: (state: SseClientState, detail?: unknown) => void
  readyTimeoutMs?: number
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}): BridgeSseClient {
  let running = false
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  const clearReady = () => { if (readyTimer) { clearTimeoutFn(readyTimer); readyTimer = null } }

  const receive = (message: unknown) => {
    // A shell that stringifies its messages is handled too. Never throws: a
    // message that makes no sense is dropped.
    if (typeof message === 'string') {
      try { message = JSON.parse(message) } catch { return }
    }
    if (!running || !message || typeof message !== 'object') return
    const m = message as { type?: string; block?: string; message?: string; code?: string }
    switch (m.type) {
      case 'open':
        onStateChange?.('open')
        clearReady()
        readyTimer = setTimeoutFn(() => { readyTimer = null; onStateChange?.('stalled') }, readyTimeoutMs)
        break
      case 'frame': {
        clearReady()
        if (typeof m.block !== 'string') break
        const evt = parseSseFrame(m.block)
        if (evt) onEvent(evt)
        break
      }
      case 'closed':
        clearReady()
        onStateChange?.('closed')
        break
      case 'error':
        clearReady()
        if (m.code === 'unsupported') onStateChange?.('unsupported-server')
        else onStateChange?.('error', m.code ? { message: m.message, code: m.code } : m.message)
        break
    }
  }

  return {
    receive,
    start() {
      if (running) return false
      const connection = getConnection()
      if (!connection) return false
      running = true
      onStateChange?.('connecting')
      try {
        startNative(connection)
      } catch (err) {
        onStateChange?.('error', err instanceof Error ? err.message : String(err))
      }
      return true
    },
    stop() {
      if (!running) return
      running = false
      clearReady()
      try { stopNative() } catch { /* stopping must not throw */ }
      onStateChange?.('stopped')
    },
    isRunning: () => running,
  }
}
