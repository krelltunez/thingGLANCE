// Device-local multi-user preferences. The roster itself (who is in the
// household) is shared data; which member THIS device belongs to, and whether
// it is looking at everyone's things or just its own, is not.

const ENABLED_KEY = 'tg_multi_user_enabled'
const ME_KEY = 'tg_me_user_id'
const FILTER_KEY = 'tg_user_filter'

export type UserFilter = 'all' | 'mine'

const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
export const subscribeMultiUser = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn) }

export const getMultiUserEnabled = (): boolean => localStorage.getItem(ENABLED_KEY) === 'true'
export function setMultiUserEnabled(on: boolean): void { localStorage.setItem(ENABLED_KEY, String(on)); emit() }

export const getMeUserId = (): string | null => localStorage.getItem(ME_KEY)
export function setMeUserId(id: string | null): void {
  if (id) localStorage.setItem(ME_KEY, id)
  else localStorage.removeItem(ME_KEY)
  emit()
}

export const getUserFilter = (): UserFilter => (localStorage.getItem(FILTER_KEY) === 'mine' ? 'mine' : 'all')
export function setUserFilter(f: UserFilter): void { localStorage.setItem(FILTER_KEY, f); emit() }

// One snapshot string so useSyncExternalStore sees a stable value.
export const multiUserSnapshot = (): string => `${getMultiUserEnabled()}|${getMeUserId() ?? ''}|${getUserFilter()}`
