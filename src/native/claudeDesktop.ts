// "Set up Claude Desktop" (docs/mcp.md, "Connecting an assistant"), the part
// of it the page decides: which builds offer the button, and what to say once
// it has been pressed. The work is the main process's
// (electron/mcpDesktopSetup.ts).

import { tr } from '@/core/text'
import type { DesktopClaudeSetupResult } from './desktop'

// Connecting each kind of client, in the bridge's README.
export const CLAUDE_SETUP_GUIDE_URL = 'https://github.com/glance-apps/mcp-bridge#thingglance'

// Direct builds on the platforms Claude Desktop runs on. The Mac App Store
// build may not write another app's settings, and Linux has no Claude Desktop.
export function offersClaudeDesktopSetup(platform: string, isMAS: boolean): boolean {
  return !isMAS && (platform === 'darwin' || platform === 'win32')
}

export interface ClaudeSetupNote {
  text: string
  // The lines to paste by hand, when the settings could not be changed.
  manual: string | null
  bad: boolean
}

export function claudeSetupNote(result: DesktopClaudeSetupResult): ClaudeSetupNote {
  if (result.ok) {
    return { text: result.backupPath ? tr('settings.local.claudeDesktopDoneBackup') : tr('settings.local.claudeDesktopDone'), manual: null, bad: false }
  }
  switch (result.reason) {
    case 'bridge_missing':
      return { text: tr('settings.local.claudeDesktopBridgeMissing'), manual: null, bad: true }
    case 'unreadable':
    case 'unparseable':
    case 'write_failed':
    case 'unsupported_platform':
      return { text: tr('settings.local.claudeDesktopManual'), manual: result.manualEntry ?? null, bad: true }
    default:
      return { text: tr('settings.local.errorGeneric'), manual: null, bad: true }
  }
}
