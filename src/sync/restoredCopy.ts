// A note that this copy of the data arrived from another device's backup and
// was syncing there (deviceIdentity.ts). The vault connection never travels,
// so the copy is not syncing here, and nothing else would say so: the app
// simply looks like one that was never connected. The sync indicator shows the
// note until the device is connected again or the user says to leave it.
//
// It imports nothing, so the sync manager, the connect flow and the boot check
// can all read it.

const NOTICE_KEY = 'tg_restored_copy'

export function restoredCopyNotice(): boolean {
  try { return localStorage.getItem(NOTICE_KEY) === '1' } catch { return false }
}

export function setRestoredCopyNotice(): void {
  try { localStorage.setItem(NOTICE_KEY, '1') } catch { /* no note, at worst */ }
}

export function clearRestoredCopyNotice(): void {
  try { localStorage.removeItem(NOTICE_KEY) } catch { /* nothing to clear */ }
}
