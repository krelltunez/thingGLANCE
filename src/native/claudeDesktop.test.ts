import { describe, expect, it } from 'vitest'
import { claudeSetupNote, offersClaudeDesktopSetup } from './claudeDesktop'

describe('Set up Claude Desktop, on the page', () => {
  it('is offered on direct builds for macOS and Windows only', () => {
    expect(offersClaudeDesktopSetup('darwin', false)).toBe(true)
    expect(offersClaudeDesktopSetup('win32', false)).toBe(true)
    expect(offersClaudeDesktopSetup('linux', false)).toBe(false)
    expect(offersClaudeDesktopSetup('darwin', true)).toBe(false)
  })

  it('says what happened, and mentions the copy that was kept', () => {
    const made = claudeSetupNote({ ok: true, action: 'created', path: '/c', backupPath: null })
    const merged = claudeSetupNote({ ok: true, action: 'merged', path: '/c', backupPath: '/c.bak' })
    expect(made).toMatchObject({ manual: null, bad: false })
    expect(merged).toMatchObject({ manual: null, bad: false })
    expect(made.text).toMatch(/Restart Claude Desktop/)
    expect(merged.text).not.toBe(made.text)
  })

  it('hands over the lines to paste when the settings could not be changed', () => {
    for (const reason of ['unreadable', 'unparseable', 'write_failed', 'unsupported_platform'] as const) {
      expect(claudeSetupNote({ ok: false, reason, path: '/c', manualEntry: '{}' })).toMatchObject({ manual: '{}', bad: true })
    }
    expect(claudeSetupNote({ ok: false, reason: 'unparseable' }).manual).toBeNull()
  })

  it('has no lines to paste when the build did not bring the connector, or the window may not ask', () => {
    const missing = claudeSetupNote({ ok: false, reason: 'bridge_missing', path: '/c' })
    const refused = claudeSetupNote({ ok: false, reason: 'invalid_sender' })
    expect(missing).toMatchObject({ manual: null, bad: true })
    expect(refused).toMatchObject({ manual: null, bad: true })
    expect(missing.text).not.toBe(refused.text)
  })
})
