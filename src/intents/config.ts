// Cross-app intents over GLANCEvault (the `intents` endpoints). thingGLANCE
// has no WebDAV intents road: the vault is the only transport. The connection
// (url, token, account) is the sync connection; this module owns the opt-in
// flag, the app-owned RECEIVE cursor, and a small activity log for Settings.

import { formatSince, parseSince } from '@glance-apps/intents'
import { getVaultConfig } from '@/sync/vaultConfig'

export const SOURCE_APP = 'app.thingglance'

const CONFIG_KEY = 'tg_intents_config'
const CURSOR_KEY = 'tg_intents_receive_cursor'
const FAILURES_KEY = 'tg_intents_receive_failures'
const ACTIVITY_KEY = 'tg_intents_activity'

export interface IntentsConfig {
  enabled: boolean
  ttlMs: number
  pollIntervalMinutes: number
  // How many days before an event the dayGLANCE task should be due.
  leadDays: number
}

const DEFAULTS: IntentsConfig = { enabled: false, ttlMs: 30 * 24 * 60 * 60 * 1000, pollIntervalMinutes: 15, leadDays: 7 }

const listeners = new Set<() => void>()
const emit = () => { for (const fn of listeners) fn() }
export const subscribeIntents = (fn: () => void): (() => void) => { listeners.add(fn); return () => listeners.delete(fn) }

export function getIntentsConfig(): IntentsConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveIntentsConfig(config: IntentsConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  emit()
}

export function isIntentsEnabled(): boolean {
  if (!getIntentsConfig().enabled) return false
  const v = getVaultConfig()
  return !!(v && v.enabled && v.vaultUrl && v.vaultToken && v.accountId)
}

// ── Receive cursor. Only the receive loop moves it; sending never can. ───────

export const getReceiveCursor = (): number | null => parseSince(localStorage.getItem(CURSOR_KEY))
export const setReceiveCursor = (seq: number | null): void => localStorage.setItem(CURSOR_KEY, formatSince(seq))

// Per-seq consecutive failure counts for the bounded-retry drain.
type FailureMap = Record<string, number>
function readFailures(): FailureMap {
  try { return JSON.parse(localStorage.getItem(FAILURES_KEY) ?? '{}') as FailureMap } catch { return {} }
}
function writeFailures(map: FailureMap): void {
  if (Object.keys(map).length === 0) localStorage.removeItem(FAILURES_KEY)
  else localStorage.setItem(FAILURES_KEY, JSON.stringify(map))
}
export function recordReceiveFailure(seq: number): number {
  const map = readFailures()
  const next = (map[String(seq)] ?? 0) + 1
  map[String(seq)] = next
  writeFailures(map)
  return next
}
export function clearReceiveFailure(seq: number): void {
  const map = readFailures()
  if (map[String(seq)] === undefined) return
  delete map[String(seq)]
  writeFailures(map)
}

// ── Activity log ─────────────────────────────────────────────────────────────

export interface ActivityEntry { at: string; type: 'sent' | 'received' | 'warning' | 'error'; message: string; detail?: string }

export function getActivity(): ActivityEntry[] {
  try { return JSON.parse(localStorage.getItem(ACTIVITY_KEY) ?? '[]') as ActivityEntry[] } catch { return [] }
}

export function addActivity(entry: Omit<ActivityEntry, 'at'>): void {
  const next = [{ ...entry, at: new Date().toISOString() }, ...getActivity()].slice(0, 60)
  try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next)) } catch { /* storage full */ }
  emit()
}

export const intentsSnapshot = (): string => `${localStorage.getItem(CONFIG_KEY) ?? ''}|${getActivity()[0]?.at ?? ''}`
