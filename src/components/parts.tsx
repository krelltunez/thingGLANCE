// Domain-aware building blocks shared by the screens.

import { useState } from 'react'
import dayjs from 'dayjs'
import { Check, Hand, Send, Undo2 } from 'lucide-react'
import type { HorizonEvent, Thing } from '@/core/types'
import { VERDICTS, type Lifecycle, type Verdict } from '@/core/health'
import { EVENT_META } from '@/core/horizon'
import { daysBetween, fmtDay, fmtMonth, today } from '@/core/dates'
import { money, type ForecastMonth } from '@/core/money'
import { isIntentsEnabled } from '@/intents/config'
import { useData } from '@/state/data'
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
  const d = useData()
  // In a household, say who each date falls to. One that falls to nobody
  // says nothing here (the queue notes how many there are) and offers a
  // one-tap "I'll deal with this" instead.
  const handler = d.multiUser ? d.handlerOf(event) : null
  const canTake = !compact && d.needsSomeone(event) && !!d.meId && d.userIds.has(d.meId)
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
      {handler && <Chip tone={handler === d.meId ? 'accent' : 'dim'} className="hidden sm:inline-flex">{handler === d.meId ? 'You' : d.memberName(handler)}</Chip>}
      {!compact && (
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
          {!sent && isIntentsEnabled() && (
            <button type="button" className="icon-btn h-8 w-8" title="Send to dayGLANCE as a task" onClick={() => void actions.send(event)}><Send size={14} /></button>
          )}
          {canTake && (
            <button type="button" className="icon-btn h-8 w-8 hover:!border-accent/40 hover:!text-accent" title="I'll deal with this" aria-label="I'll deal with this" onClick={() => void actions.take(event)}><Hand size={14} /></button>
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

// Plan charges for the months ahead: one bar per month with what leaves the
// account written above it. The Glance and Plans pages share it so the two
// charts cannot drift. The parent sets the height (a fixed one, or flex-1).
export function ChargesChart({ months, className }: { months: ForecastMonth[]; className?: string }) {
  const { currency } = useSettings()
  const max = Math.max(1, ...months.map((m) => m.total))
  // On a phone there is no room to label twelve bars, so only the spikes
  // (annual renewals standing clear of a normal month) keep theirs, or this
  // month's when the year is flat.
  const sorted = months.map((m) => m.total).sort((a, b) => a - b)
  const usual = sorted[Math.floor(sorted.length / 2)] ?? 0
  const isSpike = (total: number) => total > 0 && total >= usual * 1.4 && total > usual
  const flat = !months.some((m) => isSpike(m.total))
  return (
    <div className={cx('flex items-end gap-1.5 sm:gap-2', className)}>
      {months.map((m, i) => {
        const keep = isSpike(m.total) || (flat && i === 0)
        return (
          <div key={m.month} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <div className="pointer-events-none absolute -top-1 z-10 hidden w-max max-w-[230px] -translate-y-full rounded-lg border border-line/15 bg-raised px-2.5 py-2 text-left shadow-xl group-hover:block">
              <p className="text-xs font-semibold text-ink">{fmtMonth(m.month)} · <span className="num">{money(m.total, currency)}</span></p>
              {m.items.slice(0, 5).map((it) => <p key={it.id + it.date} className="truncate text-[11px] text-dim">{it.name} <span className="num text-faint">{money(it.amount, currency)}</span></p>)}
              {m.items.length > 5 && <p className="text-[11px] text-faint">+{m.items.length - 5} more</p>}
            </div>
            {m.total > 0 && (
              <span className={cx('num whitespace-nowrap text-[10px] leading-none', isSpike(m.total) ? 'text-dim' : 'text-faint', !keep && 'hidden sm:block')}>
                {money(Math.round(m.total), currency)}
              </span>
            )}
            {/* The bar scales into what is left once the two labels have their room. */}
            <div
              className={cx('w-full rounded-t-md transition-all duration-700 group-hover:brightness-125', i === 0 ? 'bg-sub' : 'bg-sub/35')}
              style={{ height: `max(3px, calc((100% - 2.5rem) * ${m.total / max}))` }}
            />
            <span className="label !text-[9px] leading-none">{dayjs(m.month).format('MMM')}</span>
          </div>
        )
      })}
    </div>
  )
}

// An amount split by member (null is the household), as a row of chips. Used
// for the upgrade fund by owner and plan costs by payer. This device's own
// member reads "You" and stands out: "what I pay" is the question asked most.
export function MemberSplit({ split, suffix = '/mo' }: { split: Map<string | null, number>; suffix?: string }) {
  const d = useData()
  const { currency } = useSettings()
  const rows = [...split.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  if (rows.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {rows.map(([id, amount]) => (
        <Chip key={id ?? 'household'} tone={id && id === d.meId ? 'accent' : 'dim'}>
          {id === null ? 'Household' : id === d.meId ? 'You' : d.memberName(id) ?? 'Someone removed'}
          <span className="num font-semibold">{money(amount, currency, { cents: false })}{suffix}</span>
        </Chip>
      ))}
    </div>
  )
}
