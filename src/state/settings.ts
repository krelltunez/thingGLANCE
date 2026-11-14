// Device-local preferences (never synced).

import { useSyncExternalStore } from 'react'
import { defaultCurrency } from '@/core/money'
import { normalizeReminderPrefs, type ReminderPrefs } from '@/core/reminders'

export type ThemePref = 'system' | 'dark' | 'light'

export interface Settings {
  theme: ThemePref
  currency: string
  webLookup: boolean
  // When this device is reminded, and about what (core/reminders.ts). Nothing
  // on the web notifies yet; a shell reads these and offers the controls.
  reminders: ReminderPrefs
}

const KEY = 'tg_settings'
const listeners = new Set<() => void>()
let cache: Settings | null = null

function read(): Settings {
  if (cache) return cache
  let stored: Partial<Settings> = {}
  try { stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings> } catch { /* defaults */ }
  cache = { theme: 'system', currency: defaultCurrency(), webLookup: true, ...stored, reminders: normalizeReminderPrefs(stored.reminders) }
  return cache
}

export const getSettings = (): Settings => read()

export function updateSettings(patch: Partial<Settings>): void {
  cache = { ...read(), ...patch }
  if (patch.reminders) cache.reminders = normalizeReminderPrefs(patch.reminders)
  localStorage.setItem(KEY, JSON.stringify(cache))
  if (patch.theme) applyTheme()
  listeners.forEach((fn) => fn())
}

// For code outside React that mirrors a setting somewhere else.
export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useSettings(): Settings {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn) }, read)
}

const prefersDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

export function applyTheme(): void {
  const { theme } = read()
  const dark = theme === 'dark' || (theme === 'system' && prefersDark())
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#05081A' : '#EEF4FB')
}

export function watchSystemTheme(): void {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)
}
