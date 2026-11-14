// Device-local household preferences: which member's things this device is
// looking at, and whether it has been asked who it belongs to.
//
// Which member this device belongs to is NOT here. It is a synced row
// (DeviceLink in core/types.ts) so the rest of the household knows who uses
// the app. There is no "multi-user" switch either: the household shows as soon
// as the roster has more than one member. v0.1 and v0.2 kept a switch, a
// Mine / Everyone choice and the device's member in localStorage; the take*
// functions hand those over once.

const FOCUS_KEY = 'tg_member_filter'
const ASKED_KEY = 'tg_who_asked'
const LEGACY_ENABLED_KEY = 'tg_multi_user_enabled'
const LEGACY_ME_KEY = 'tg_me_user_id'
const LEGACY_FILTER_KEY = 'tg_user_filter'

const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
export const subscribeHousehold = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn) }

// The member the views are filtered to, or null for everyone.
export const getFocusMemberId = (): string | null => localStorage.getItem(FOCUS_KEY) || null
export function setFocusMemberId(id: string | null): void {
  if (id) localStorage.setItem(FOCUS_KEY, id)
  else localStorage.removeItem(FOCUS_KEY)
  emit()
}

// "Which one are you?" is offered once per device, when a roster first shows
// up on a device nobody has claimed.
export const getWhoAsked = (): boolean => localStorage.getItem(ASKED_KEY) === '1'
export function setWhoAsked(): void { localStorage.setItem(ASKED_KEY, '1'); emit() }

export function takeLegacyMeId(): string | null {
  const id = localStorage.getItem(LEGACY_ME_KEY)
  if (id) localStorage.removeItem(LEGACY_ME_KEY)
  return id
}

// True when this device was set to "Mine" under the old switch.
export function takeLegacyMineFilter(): boolean {
  const mine = localStorage.getItem(LEGACY_FILTER_KEY) === 'mine'
  localStorage.removeItem(LEGACY_FILTER_KEY)
  localStorage.removeItem(LEGACY_ENABLED_KEY)
  return mine
}

// One snapshot string so useSyncExternalStore sees a stable value.
export const householdSnapshot = (): string => `${getFocusMemberId() ?? ''}|${getWhoAsked()}`
