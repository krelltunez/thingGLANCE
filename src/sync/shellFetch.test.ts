import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { registerShell } from '@/native/shell'
import { SHELL_REQUEST_TIMEOUT_MS, netFetch, shellFetchImpl } from './shellFetch'

afterEach(() => { registerShell(null); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('the way out to the network', () => {
  it('uses the platform fetch when no shell supplies one', async () => {
    const platform = vi.fn(async () => new Response('web'))
    vi.stubGlobal('fetch', platform)
    expect(shellFetchImpl()).toBeUndefined()
    expect(await (await netFetch('https://vault.example/healthz')).text()).toBe('web')
    expect(platform).toHaveBeenCalledOnce()
  })
  it('uses the shell\'s transport once one is registered, for both callers', async () => {
    const platform = vi.fn(async () => new Response('web'))
    const shell = vi.fn(async () => new Response('shell'))
    vi.stubGlobal('fetch', platform)
    registerShell({ fetch: shell as unknown as typeof fetch })
    expect(await (await shellFetchImpl()!('https://vault.example/salt/home')).text()).toBe('shell')
    expect(await (await netFetch('https://vault.example/healthz')).text()).toBe('shell')
    expect(shell).toHaveBeenCalledTimes(2)
    expect(platform).not.toHaveBeenCalled()
  })
})

// A native transport may ignore the signal it is handed (Capacitor's does).
// The app's timeouts must hold anyway.
describe('deadlines do not depend on the transport', () => {
  const deaf = () => vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch

  it('settles a request by its own signal, even on a transport that ignores it', async () => {
    registerShell({ fetch: deaf() })
    const controller = new AbortController()
    const request = netFetch('https://vault.example/healthz', { signal: controller.signal })
    controller.abort(new Error('gave up'))
    await expect(request).rejects.toThrow('gave up')
  })
  it('refuses at once when the signal has already fired', async () => {
    const shell = deaf()
    registerShell({ fetch: shell })
    await expect(netFetch('https://vault.example/healthz', { signal: AbortSignal.abort(new Error('too late')) })).rejects.toThrow('too late')
    expect(shell).not.toHaveBeenCalled()
  })
  it('puts a ceiling on a shell request that carries no deadline of its own', async () => {
    vi.useFakeTimers()
    registerShell({ fetch: deaf() })
    let failed: unknown = null
    const request = shellFetchImpl()!('https://vault.example/sync').catch((err) => { failed = err })
    await vi.advanceTimersByTimeAsync(SHELL_REQUEST_TIMEOUT_MS - 1)
    expect(failed).toBeNull()
    await vi.advanceTimersByTimeAsync(2)
    await request
    expect((failed as Error).name).toBe('TimeoutError')
  })
  it('adds no ceiling of its own in the browser', async () => {
    vi.useFakeTimers()
    let answer: (r: Response) => void = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { answer = resolve })))
    const request = netFetch('https://vault.example/healthz')
    await vi.advanceTimersByTimeAsync(SHELL_REQUEST_TIMEOUT_MS * 3)
    answer(new Response('slow'))
    expect(await (await request).text()).toBe('slow')
  })
})

// A request made any other way is one a shell cannot see or carry: in the
// desktop app it would be blocked outright, and in a headless refresh it would
// go out on the wrong stack. This reads the source so that cannot creep in.
describe('nothing goes round it', () => {
  const root = join(__dirname, '..')
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
  const sources = files(root).map((path) => ({ file: relative(root, path), text: readFileSync(path, 'utf8') }))
  // Comments talk about fetch; only code counts.
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '')

  it('has no bare fetch() outside the seam and the web event stream', () => {
    const allowed = new Set(['sync/shellFetch.ts', 'sync/vaultEventStream.ts'])
    const offenders = sources.filter((s) => !allowed.has(s.file) && /(?<![.\w])fetch\(/.test(code(s.text))).map((s) => s.file)
    expect(offenders).toEqual([])
  })
  it('gives every vault client and sync engine the shell\'s fetch', () => {
    const offenders: string[] = []
    for (const s of sources) {
      const text = code(s.text)
      for (const m of text.matchAll(/\b(createVaultClient|createDbSyncEngine)\(\{/g)) {
        // The options object: from the call to its closing brace at depth 0.
        let depth = 0
        let end = m.index! + m[0].length - 1
        for (let i = end; i < text.length; i++) {
          if (text[i] === '{') depth++
          else if (text[i] === '}' && --depth === 0) { end = i; break }
        }
        if (!/\bfetchImpl\b/.test(text.slice(m.index!, end))) offenders.push(`${s.file}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })
  it('scans the files it thinks it does', () => {
    expect(sources.length).toBeGreaterThan(40)
    expect(sources.some((s) => s.file === 'sync/dbEngine.ts')).toBe(true)
  })
})
