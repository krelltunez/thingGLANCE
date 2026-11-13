// Device-local multi-user preferences: whether this device shows the household
// at all, and whether it is looking at everyone's things or just its own.
//
// Which member this device belongs to is NOT here. It is a synced row
// (DeviceLink in core/types.ts) so the rest of the household knows who uses
// the app. v0.1 kept it in localStorage; takeLegacyMeId() hands that over once.

const ENABLED_KEY = 'tg_multi_user_enabled'
const ME_KEY = 'tg_me_user_id'
const FILTER_KEY = 'tg_user_filter'

export type UserFilter = 'all' | 'mine'

const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
export const subscribeMultiUser = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn) }

export const getMultiUserEnabled = (): boolean => localStorage.getItem(ENABLED_KEY) === 'true'
export function setMultiUserEnabled(on: boolean): void { localStorage.setItem(ENABLED_KEY, String(on)); emit() }

export function takeLegacyMeId(): string | null {
  const id = localStorage.getItem(ME_KEY)
  if (id) localStorage.removeItem(ME_KEY)
  return id
}

export const getUserFilter = (): UserFilter => (localStorage.getItem(FILTER_KEY) === 'mine' ? 'mine' : 'all')
export function setUserFilter(f: UserFilter): void { localStorage.setItem(FILTER_KEY, f); emit() }

// One snapshot string so useSyncExternalStore sees a stable value.
export const multiUserSnapshot = (): string => `${getMultiUserEnabled()}|${getUserFilter()}`
