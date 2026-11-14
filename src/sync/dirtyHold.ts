// Changes made while no sync engine is listening, kept for the one that will.
//
// The dirty trackers used to drop a change when no engine was registered,
// which is right when the vault is off (connecting later uploads everything)
// and wrong in two cases a shell makes real:
//
//   - A write from outside (a widget tap, a notification action) lands before
//     the app has mounted and started its engines.
//   - The keystore could not be read at boot, so this session cannot tell that
//     the device is connected. The next launch can, and by then the engine's
//     "upload everything once" has long since run.
//
// So when a vault is expected, the ids wait here, on disk, until an engine
// registers and takes them.

import { secretsUnreadable } from './secrets'
import { isVaultEnabled } from './vaultConfig'

export const DIRTY_HOLD_KEYS = ['tg_dirty_waiting', 'tg_roster_dirty_waiting'] as const

// Connected, or possibly connected: either way an engine will want these.
export const vaultExpected = (): boolean => isVaultEnabled() || secretsUnreadable()

export interface DirtyHold {
  add(id: string): void
  // Hands over everything held and forgets it.
  take(): string[]
}

export function createDirtyHold(storageKey: (typeof DIRTY_HOLD_KEYS)[number]): DirtyHold {
  const read = (): string[] => {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return {
    add(id) {
      const ids = read()
      if (ids.includes(id)) return
      try { localStorage.setItem(storageKey, JSON.stringify([...ids, id])) } catch { /* storage unavailable: lost with the session */ }
    },
    take() {
      const ids = read()
      if (ids.length) { try { localStorage.removeItem(storageKey) } catch { /* nothing to clear */ } }
      return ids
    },
  }
}
