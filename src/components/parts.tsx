// Domain-aware building blocks shared by the screens.

import { useState } from 'react'
import { Check, Send, Undo2 } from 'lucide-react'
import type { HorizonEvent, Thing } from '@/core/types'
import { VERDICTS, type Lifecycle, type Verdict } from '@/core/health'
import { EVENT_META } from '@/core/horizon'
import { daysBetween, fmtDay, today } from '@/core/dates'
import { money } from '@/core/money'
import { isIntentsEnabled } from '@/intents/config'
import { useSettings } from '@/state/settings'
import { Chip, TBadge } from './ui'
import { TONES, cx, severityTone, verdictTone } from './kit'
import { useEventActions } from './useEventActions'
import { EVENT_ICONS, categoryIcon } from './icons'

export function ThingAvatar({ thing, size = 40, className }: { thing: Pick<Thing, 'category' | 'imageUrl' | 'status'>; size?: number; className?: string }) {
  const Icon = categoryIcon(thing.category)
  const [broken, setBroken] = useState(false)
  return (
    <span
      className={cx('flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line/10', thing.imageUrl && !broken ? 'bg-white' : 'bg-accent/10 text-accent', thing.status === 'retired' && 'opacity-60 grayscale', className)}
      style={{ width: size, height: size }}
    >
      {thing.imageUrl && !broken
        ? <img src={thing.imageUrl} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-contain p-1" />
        : <Icon size={Math.round(size * 0.48)} strokeWidth={1.7} />}
    </span>
  )
}

export function VerdictChip({ verdict }: { verdict: Verdict }) {
  return <Chip tone={verdictTone(verdict)}><span className={cx('h-1.5 w-1.5 rounded-full', TONES[verdictTone(verdict)].solid)} />{VERDICTS[verdict].label}</Chip>
}

// The lifecycle in one line: purchase on the left, the end of its window on
// the right, filled up to today, with ticks where coverage and support end.
export function LifeBar({ life, tall = false }: { life: Lifecycle; tall?: boolean }) {
  if (!life.start || !life.lifeEnd) return <div className={cx('rounded-full bg-line/10', tall ? 'h-2' : 'h-1')} />
  const total = Math.max(1, daysBetween(life.start, life.lifeEnd))
  const pos = (d: string) => Math.min(100, Math.max(0, (daysBetween(life.start!, d) / total) * 100))
  const now = pos(today())
  const tone = verdictTone(life.verdict)
  return (
    <div className={cx('relative rounded-full bg-line/10', tall ? 'h-2' : 'h-1')}>
      <div className={cx('absolute inset-y-0 left-0 rounded-full', TONES[tone].bar)} style={{ width: `${now}%` }} />
      {life.warrantyEnd && life.warrantyEnd < life.lifeEnd && (
        <span className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded bg-ok" style={{ left: `${pos(life.warrantyEnd)}%` }} title={`Coverage ends ${fmtDay(life.warrantyEnd)}`} />
      )}
      {life.supportEnd && life.lifeEndReason === 'plan' && life.supportEnd > life.start && (
        <span className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded bg-accent" style={{ left: `${pos(life.supportEnd)}%` }} title={`Support ends ${fmtDay(life.supportEnd)}`} />
      )}
      <span className={cx('absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-panel', TONES[tone].solid)} style={{ left: `${now}%` }} />
    </div>
  )
}

export function EventRow({ event, compact = false }: { event: HorizonEvent; compact?: boolean }) {
  const { currency } = useSettings()
  const actions = useEventActions()
  const meta = EVENT_META[event.type]
  const Icon = EVENT_ICONS[event.type]
  const tone = severityTone(event.severity)
  const sent = event.decision?.state === 'sent'
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-line/10 bg-raised/40 px-3 py-2.5 transition hover:border-line/25 hover:bg-raised/70">
      <TBadge days={event.days} tone={tone} />
      <span className={cx('hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border sm:flex', TONES[meta.tone].soft)}><Icon size={15} /></span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => actions.openEvent(event)}>
        <span className="block truncate text-sm font-medium text-ink">{event.title}</span>
        <span className="block truncate text-xs text-dim">
          {event.detail} · {fmtDay(event.date, 'MMM D')}
          {event.amount != null && event.type !== 'replace' && <> · <span className="num">{money(event.amount, currency)}</span></>}
        </span>
      </button>
      {sent && <Chip tone="accent" icon={Send} className="hidden sm:inline-flex">In dayGLANCE</Chip>}
      {!compact && (
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
          {!sent && isIntentsEnabled() && (
            <button type="button" className="icon-btn h-8 w-8" title="Send to dayGLANCE as a task" onClick={() => void actions.send(event)}><Send size={14} /></button>
          )}
          <button type="button" className="icon-btn h-8 w-8 hover:!border-ok/40 hover:!text-ok" title="Done with this" onClick={() => void actions.dismiss(event)}><Check size={15} /></button>
        </div>
      )}
    </div>
  )
}

export function DecidedRow({ event }: { event: HorizonEvent }) {
  const actions = useEventActions()
  return (
    <div className="flex items-center gap-3 px-1 py-1.5 text-xs text-faint">
      <Check size={13} className="text-ok" />
      <span className="min-w-0 flex-1 truncate line-through decoration-line/30">{event.title} · {event.detail}</span>
      <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => void actions.restore(event)}><Undo2 size={12} /> Restore</button>
    </div>
  )
}
