// HTTP for a headless run, on the shell's own stack
// (HeadlessBridge.httpRequestAsync). The shell runs each request on a worker
// thread and answers through window.__tgHeadlessHttpDone({ id, result }),
// result being { status, body, headers } or { error }. Ported from lastGLANCE.

import type { HeadlessBridge } from './headlessMode'

interface HttpResult { status: number; body: string; headers: Record<string, string> }
interface Pending { resolve: (r: HttpResult) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
type DoneMessage = { id?: string; result?: Partial<HttpResult> & { error?: string } }

// A reply that never comes must not hold the run: the worker gives the whole
// run two minutes.
const RESULT_TIMEOUT_MS = 90_000
let seq = 0
const pending = new Map<string, Pending>()

declare global {
  interface Window {
    __tgHeadlessHttpDone?: (msg: DoneMessage) => void
  }
}

function onDone(msg: DoneMessage): void {
  const entry = msg?.id ? pending.get(msg.id) : undefined
  if (!entry || !msg.id) return
  pending.delete(msg.id)
  clearTimeout(entry.timer)
  const r = msg.result
  if (!r || typeof r.status !== 'number') { entry.reject(new Error(r?.error || 'no response')); return }
  entry.resolve({ status: r.status, body: typeof r.body === 'string' ? r.body : '', headers: r.headers ?? {} })
}

function request(bridge: HeadlessBridge, method: string, url: string, headers: Record<string, string>, body: string | null): Promise<HttpResult> {
  window.__tgHeadlessHttpDone = onDone
  return new Promise((resolve, reject) => {
    const id = `h${++seq}`
    const timer = setTimeout(() => { if (pending.delete(id)) reject(new Error(`no response within ${RESULT_TIMEOUT_MS / 1000} s`)) }, RESULT_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    try {
      bridge.httpRequestAsync(id, method, url, JSON.stringify(headers), body)
    } catch (e) {
      pending.delete(id)
      clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

// Statuses whose Response may not carry a body.
const NULL_BODY = new Set([204, 205, 304])

// A fetch on the shell's stack. String bodies only: the vault speaks JSON.
export function headlessFetch(bridge: HeadlessBridge): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value })
    const body = init?.body
    if (body != null && typeof body !== 'string') throw new TypeError('headless fetch: only string bodies')
    const res = await request(bridge, method, url, headers, body ?? null)
    return new Response(NULL_BODY.has(res.status) ? null : res.body, { status: res.status, headers: res.headers })
  }
}
