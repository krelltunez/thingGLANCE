// The Horizon: every thing as a lane on one time axis. Coverage, support and
// your own replacement plan are bars; renewals are dots; today is the line
// everything moves toward.

import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { Telescope } from 'lucide-react'
import type { HorizonEvent, Subscription, Thing } from '@/core/types'
import { DAY, daysBetween, fmtDay, fmtMonth, today } from '@/core/dates'
import { cycleShort, isBilling, money, renewalsBetween } from '@/core/money'
import { useData } from '@/state/data'
import { useSettings } from '@/state/settings'
import { useUI } from '@/state/ui'
import { Empty, Segmented } from '@/components/ui'
import { cx } from '@/components/kit'
import { EventRow, ThingAvatar } from '@/components/parts'

type Range = '1y' | '2y' | '3y' | '5y'
const RANGES: Record<Range, { months: number; px: number }> = {
  '1y': { months: 12, px: 86 },
  '2y': { months: 24, px: 54 },
  '3y': { months: 36, px: 40 },
  '5y': { months: 60, px: 27 },
}
const LEAD_IN_MONTHS = 2
const ROW = 64
const SUB_ROW = 40
const HEAD = 44

export function HorizonView() {
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const [range, setRange] = useState<Range>('2y')

  const { months, px } = RANGES[range]
  const start = dayjs().startOf('month').subtract(LEAD_IN_MONTHS, 'month')
  const totalMonths = months + LEAD_IN_MONTHS
  const end = start.add(totalMonths, 'month')
  const startDay = start.format(DAY)
  const endDay = end.format(DAY)
  const totalDays = end.diff(start, 'day')
  const ref = today()

  // Percent along the track, clamped so a bar that began years ago starts at
  // the left edge instead of off-screen.
  const pos = (day: string) => Math.min(100, Math.max(0, (daysBetween(startDay, day) / totalDays) * 100))
  const inView = (day: string) => day >= startDay && day <= endDay
  const bar = (from: string, to: string) => ({ left: `${pos(from)}%`, width: `${Math.max(0, pos(to) - pos(from))}%` })

  const things = useMemo(
    () => [...d.activeThings].sort((a, b) => (d.life.get(a.id)?.daysLeft ?? 1e9) - (d.life.get(b.id)?.daysLeft ?? 1e9)),
    [d.activeThings, d.life],
  )
  const loose = d.visibleSubs.filter((s) => s.status !== 'cancelled' && !s.coversThingIds.some((id) => d.thingById.get(id)))
    .sort((a, b) => b.amount * (b.cycle === 'yearly' ? 1 : 12) - a.amount * (a.cycle === 'yearly' ? 1 : 12))

  const agenda = useMemo(() => {
    const list = d.events.filter((e) => e.date <= endDay && (e.days >= 0 || e.attention) && !e.quiet && !e.repeat)
    const groups = new Map<string, HorizonEvent[]>()
    for (const e of list.slice(0, 80)) {
      const key = e.days < 0 ? 'overdue' : dayjs(e.date).startOf('month').format(DAY)
      groups.set(key, [...(groups.get(key) ?? []), e])
    }
    return [...groups.entries()].sort(([a], [b]) => (a === 'overdue' ? -1 : b === 'overdue' ? 1 : a < b ? -1 : 1))
  }, [d.events, endDay])

  if (d.ready && things.length === 0 && loose.length === 0) {
    return <div className="panel hud mx-auto mt-10 max-w-xl"><Empty icon={Telescope} title="The horizon is empty" body="Add a thing with a purchase date and its lifecycle shows up here as a lane." /></div>
  }

  const renewalDots = (s: Subscription) => (isBilling(s) || s.status === 'trial') && s.cycle !== 'monthly' && s.cycle !== 'weekly'
    ? renewalsBetween(s, ref > startDay ? ref : startDay, endDay)
    : []

  const lane = (t: Thing) => {
    const life = d.life.get(t.id)!
    const covs = d.coveragesFor(t.id)
    const subs = d.subsFor(t.id).filter((s) => s.status !== 'cancelled')
    return (
      <div key={t.id} className="relative border-b border-line/[0.06]" style={{ height: ROW }}>
        {covs.map((c) => {
          const from = c.startDate ?? t.purchaseDate ?? startDay
          if (c.endDate < startDay) return null
          const lapsed = c.endDate < ref
          return (
            <div key={c.id} title={`${c.name} · until ${fmtDay(c.endDate)}`}
              className={cx('absolute top-[11px] flex h-[15px] items-center overflow-hidden rounded-[5px] border px-1.5', lapsed ? 'border-line/15 bg-line/10' : 'border-ok/40 bg-ok/20')}
              style={bar(from, c.endDate)}>
              <span className={cx('truncate font-mono text-[9px] font-medium uppercase tracking-wider', lapsed ? 'text-faint' : 'text-ok')}>{c.name}</span>
            </div>
          )
        })}
        {life.supportEnd && life.supportEnd >= startDay && (
          <>
            <div className={cx('absolute top-[33px] h-[4px] rounded-full', t.supportBasis === 'estimate' ? 'bg-[repeating-linear-gradient(90deg,rgb(var(--accent)/0.75)_0_6px,transparent_6px_10px)]' : 'bg-accent/70')}
              style={bar(life.start ?? startDay, life.supportEnd)} />
            {inView(life.supportEnd) && (
              <span title={`${t.supportBasis === 'estimate' ? 'Updates likely end' : 'Security updates end'} ${fmtDay(life.supportEnd)}`}
                className="absolute top-[29px] h-3 w-3 -translate-x-1/2 rounded-sm border-2 border-accent bg-bg" style={{ left: `${pos(life.supportEnd)}%` }} />
            )}
          </>
        )}
        {life.replaceBy && life.replaceBy >= startDay && (
          <>
            <div className="absolute top-[49px] h-px bg-line/25" style={bar(life.start ?? startDay, life.replaceBy)} />
            {inView(life.replaceBy) && (
              <span title={`Planned replacement ${fmtDay(life.replaceBy)}`}
                className="absolute top-[44px] h-[11px] w-[11px] -translate-x-1/2 rotate-45 rounded-[2px] bg-warn shadow-[0_0_10px_rgb(var(--warn)/0.6)]" style={{ left: `${pos(life.replaceBy)}%` }} />
            )}
          </>
        )}
        {subs.flatMap((s) => renewalDots(s).map((day) => (
          <span key={s.id + day} title={`${s.name} renews ${fmtDay(day)} · ${money(s.amount, currency)}`}
            className="absolute top-[46px] h-[7px] w-[7px] -translate-x-1/2 rounded-full bg-sub ring-2 ring-panel" style={{ left: `${pos(day)}%` }} />
        )))}
      </div>
    )
  }

  const subLane = (s: Subscription) => {
    const dots = renewalDots(s)
    const until = s.status === 'trial' && s.trialEnd ? s.trialEnd : null
    return (
      <div key={s.id} className="relative border-b border-line/[0.06]" style={{ height: SUB_ROW }}>
        {isBilling(s) && <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-sub/30" style={bar(ref, endDay)} />}
        {until && inView(until) && (
          <span title={`Trial converts ${fmtDay(until)}`} className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bad bg-bg" style={{ left: `${pos(until)}%` }} />
        )}
        {dots.map((day) => (
          <span key={day} title={`${s.name} renews ${fmtDay(day)} · ${money(s.amount, currency)}`}
            className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sub ring-2 ring-panel" style={{ left: `${pos(day)}%` }} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Horizon</h1>
          <p className="text-sm text-dim">Every date ahead of you, on one axis.</p>
        </div>
        <Segmented value={range} onChange={setRange} options={[{ id: '1y', label: '1 yr' }, { id: '2y', label: '2 yr' }, { id: '3y', label: '3 yr' }, { id: '5y', label: '5 yr' }]} />
      </div>

      <section className="panel hud overflow-hidden">
        <div className="flex">
          {/* Lane labels */}
          <div className="w-[132px] shrink-0 border-r border-line/10 bg-panel/60 sm:w-[220px]">
            <div className="flex items-end border-b border-line/10 px-3 pb-2" style={{ height: HEAD }}><span className="label">Things</span></div>
            {things.map((t) => (
              <button key={t.id} type="button" onClick={() => ui.openThing(t.id)} style={{ height: ROW }}
                className="flex w-full items-center gap-2.5 border-b border-line/[0.06] px-3 text-left transition hover:bg-line/5">
                <ThingAvatar thing={t} size={32} className="hidden !rounded-lg sm:flex" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{t.name}</span>
                  <span className="block truncate text-[11px] text-faint">{t.brand ?? '—'}</span>
                </span>
              </button>
            ))}
            {loose.length > 0 && <div className="flex items-end border-b border-line/10 px-3 pb-2 pt-4"><span className="label">Plans</span></div>}
            {loose.map((s) => (
              <button key={s.id} type="button" onClick={() => ui.open({ type: 'subscription', id: s.id })} style={{ height: SUB_ROW }}
                className="flex w-full items-center justify-between gap-2 border-b border-line/[0.06] px-3 text-left transition hover:bg-line/5">
                <span className="truncate text-[13px] text-ink">{s.name}</span>
                <span className="num hidden shrink-0 text-[11px] text-faint sm:inline">{money(s.amount, currency)}/{cycleShort(s.cycle)}</span>
              </button>
            ))}
          </div>

          {/* Track */}
          <div className="scrollbar-thin flex-1 overflow-x-auto">
            <div className="relative" style={{ width: totalMonths * px, minWidth: '100%' }}>
              {Array.from({ length: totalMonths }, (_, i) => {
                const m = start.add(i, 'month')
                const jan = m.month() === 0
                return (
                  <div key={i} className={cx('absolute inset-y-0 border-l', jan ? 'border-line/20' : 'border-line/[0.06]')} style={{ left: `${pos(m.format(DAY))}%` }}>
                    {(jan || i === 0) && <span className="num absolute left-1.5 top-2 text-[11px] font-semibold text-dim">{m.format('YYYY')}</span>}
                    {(px >= 50 || m.month() % 3 === 0) && <span className="label absolute left-1.5 top-[26px] !text-[9px]">{m.format('MMM')}</span>}
                  </div>
                )
              })}
              <div className="pointer-events-none absolute inset-y-0 left-0 bg-bg/45" style={{ width: `${pos(ref)}%` }} />
              <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-accent" style={{ left: `${pos(ref)}%` }}>
                <span className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b-md bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-accent-ink">Today</span>
              </div>

              <div className="border-b border-line/10" style={{ height: HEAD }} />
              {things.map(lane)}
              {loose.length > 0 && <div className="border-b border-line/10" style={{ height: 41 }} />}
              {loose.map(subLane)}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-line/10 px-4 py-3 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-[3px] border border-ok/40 bg-ok/20" />Coverage</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded-full bg-accent/70" />Security updates</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1 w-5 rounded-full bg-[repeating-linear-gradient(90deg,rgb(var(--accent)/0.75)_0_4px,transparent_4px_7px)]" />Estimated</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 rounded-[1px] bg-warn" />Planned replacement</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sub" />Renewal</span>
        </div>
      </section>

      <section className="panel p-4 lg:p-5">
        <h2 className="text-[15px] font-semibold text-ink">Agenda</h2>
        <p className="mb-4 text-xs text-dim">The same dates as a list. Monthly plans appear once, and only if you asked to review them.</p>
        <div className="gap-x-8 lg:columns-2">
          {agenda.map(([key, list]) => (
            <div key={key} className="mb-5 break-inside-avoid">
              <p className={cx('label mb-2', key === 'overdue' && '!text-bad')}>{key === 'overdue' ? 'Past due' : fmtMonth(key)}</p>
              <div className="space-y-2">{list.map((e) => <EventRow key={e.key} event={e} compact={!e.attention} />)}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
