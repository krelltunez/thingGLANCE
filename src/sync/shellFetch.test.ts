import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { registerShell } from '@/native/shell'
import { netFetch, shellFetchImpl } from './shellFetch'

afterEach(() => { registerShell(null); vi.unstubAllGlobals() })

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
    expect(shellFetchImpl()).toBe(shell)
    expect(await (await netFetch('https://vault.example/healthz')).text()).toBe('shell')
    expect(platform).not.toHaveBeenCalled()
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
