// Device-local preferences (never synced).

import { useSyncExternalStore } from 'react'
import { defaultCurrency } from '@/core/money'

export type ThemePref = 'system' | 'dark' | 'light'

export interface Settings {
  theme: ThemePref
  currency: string
  webLookup: boolean
}

const KEY = 'tg_settings'
const listeners = new Set<() => void>()
let cache: Settings | null = null

function read(): Settings {
  if (cache) return cache
  let stored: Partial<Settings> = {}
  try { stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings> } catch { /* defaults */ }
  cache = { theme: 'system', currency: defaultCurrency(), webLookup: true, ...stored }
  return cache
}

export const getSettings = (): Settings => read()

export function updateSettings(patch: Partial<Settings>): void {
  cache = { ...read(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(cache))
  if (patch.theme) applyTheme()
  listeners.forEach((fn) => fn())
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
