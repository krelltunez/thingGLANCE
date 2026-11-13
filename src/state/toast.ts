import { useSyncExternalStore } from 'react'

export interface Toast { id: number; title: string; body?: string; tone?: 'ok' | 'bad' | 'accent'; action?: { label: string; run: () => void } }

let toasts: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function toast(t: Omit<Toast, 'id'>, ms = 4200): void {
  const id = ++seq
  toasts = [...toasts, { ...t, id }]
  emit()
  setTimeout(() => dismissToast(id), t.action ? ms + 2500 : ms)
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function useToasts(): Toast[] {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn) }, () => toasts)
}
