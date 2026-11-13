// Non-component helpers for the component kit. Kept apart from ui.tsx so that
// file exports components only, which is what React fast refresh needs.

import { useEffect, useRef } from 'react'
import type { Severity } from '@/core/types'
import { VERDICTS, type Verdict } from '@/core/health'

export type Tone = 'ok' | 'accent' | 'warn' | 'bad' | 'sub' | 'dim'

// Full class names so Tailwind can see them.
export const TONES: Record<Tone, { text: string; soft: string; solid: string; stroke: string; bar: string }> = {
  ok: { text: 'text-ok', soft: 'border-ok/25 bg-ok/10 text-ok', solid: 'bg-ok', stroke: 'stroke-ok', bar: 'bg-ok/70' },
  accent: { text: 'text-accent', soft: 'border-accent/25 bg-accent/10 text-accent', solid: 'bg-accent', stroke: 'stroke-accent', bar: 'bg-accent/70' },
  warn: { text: 'text-warn', soft: 'border-warn/25 bg-warn/10 text-warn', solid: 'bg-warn', stroke: 'stroke-warn', bar: 'bg-warn/70' },
  bad: { text: 'text-bad', soft: 'border-bad/30 bg-bad/10 text-bad', solid: 'bg-bad', stroke: 'stroke-bad', bar: 'bg-bad/70' },
  sub: { text: 'text-sub', soft: 'border-sub/25 bg-sub/10 text-sub', solid: 'bg-sub', stroke: 'stroke-sub', bar: 'bg-sub/70' },
  dim: { text: 'text-dim', soft: 'border-line/15 bg-line/5 text-dim', solid: 'bg-faint', stroke: 'stroke-faint', bar: 'bg-faint/60' },
}

// The household part of a form, as the form holds it: '' is the household (or
// "anyone"), since a <select> cannot carry null.
export interface WhoDraft {
  holder: string
  responsible: string
  isPrivate: boolean
}

// Draft -> the three stored fields. Private only sticks when there is someone
// for it to be private to.
export const whoFields = (w: WhoDraft): { holder: string | null; responsibleMemberId: string | null; visibility: 'shared' | 'private' } => ({
  holder: w.holder || null,
  responsibleMemberId: w.responsible || null,
  visibility: w.isPrivate && w.holder ? 'private' : 'shared',
})

export const severityTone = (s: Severity): Tone => (s === 'past' || s === 'urgent' ? 'bad' : s === 'soon' ? 'warn' : 'dim')

export const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ')

export const verdictTone = (v: Verdict): Tone => VERDICTS[v].tone

// Escape closes the topmost layer only.
const escStack: (() => void)[] = []
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && escStack.length) { e.preventDefault(); escStack[escStack.length - 1]() }
  })
}
export function useEscape(onClose: () => void): void {
  const ref = useRef(onClose)
  useEffect(() => { ref.current = onClose })
  useEffect(() => {
    const fn = () => ref.current()
    escStack.push(fn)
    return () => { const i = escStack.indexOf(fn); if (i >= 0) escStack.splice(i, 1) }
  }, [])
}

// Parses a money / number field; '' -> undefined.
export const num = (v: string): number | undefined => {
  const n = parseFloat(v.replace(/[^0-9.,-]/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : undefined
}
