// The one way out to the network.
//
// Every request the app makes goes through here, so a shell can substitute
// its own transport in one place (native/shell.ts) and nothing is left making
// requests the shell cannot see or is not allowed to make:
//
//   shellFetchImpl()  what the vault client and the sync engines are given as
//                     `fetchImpl`. Undefined when no shell supplies one, which
//                     leaves them on the platform's fetch, as on the web.
//   netFetch()        for the app's own direct requests.
//
// shellFetch.test.ts fails if a bare fetch() or an engine built without
// `fetchImpl` appears anywhere else.
//
// The one exception is the vault's event stream on the web
// (sync/vaultEventStream.ts): it needs a response that streams, which a shell
// transport that hands back whole bodies cannot give. It only runs when there
// is no shell (detectSseTransport), and a shell brings its own reader.
//
// Deadlines are enforced here, not left to the transport. The browser's fetch
// honours an AbortSignal; a native transport may not (Capacitor's patched
// fetch never reads it), and the vault client sets no timeout of its own. So:
//   - a request that carries a signal is settled by that signal, whatever the
//     transport does with it;
//   - a request on a shell's transport that carries none gets a ceiling, so
//     one stalled request can never hold up sync for good.

import { shellBridge } from '@/native/shell'

// Generous: a first upload can be large and a phone's link slow. It only has
// to be finite.
export const SHELL_REQUEST_TIMEOUT_MS = 60_000

const timedOut = (): Error => {
  try { return new DOMException('The request timed out', 'TimeoutError') } catch { return new Error('The request timed out') }
}
const aborted = (signal: AbortSignal): unknown => signal.reason ?? timedOut()

export function bounded(impl: typeof fetch, ceilingMs: number | null): typeof fetch {
  return (input, init) => {
    const signal = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null)
    if (signal?.aborted) return Promise.reject(aborted(signal))
    const request = impl(input, init)
    if (!signal && ceilingMs === null) return request
    return new Promise<Response>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => { settle(); reject(aborted(signal!)) }
      const settle = () => { if (timer !== undefined) clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (!signal && ceilingMs !== null) timer = setTimeout(() => { settle(); reject(timedOut()) }, ceilingMs)
      request.then((res) => { settle(); resolve(res) }, (err) => { settle(); reject(err) })
    })
  }
}

export function shellFetchImpl(): typeof fetch | undefined {
  const own = shellBridge()?.fetch
  return own ? bounded(own, SHELL_REQUEST_TIMEOUT_MS) : undefined
}

export const netFetch: typeof fetch = (input, init) => (shellFetchImpl() ?? bounded(globalThis.fetch, null))(input, init)
