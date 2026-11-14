// The Glance: the one screen that answers "is there anything I should be
// thinking about?" in a couple of seconds.

import { useMemo } from 'react'
import dayjs from 'dayjs'
import { ArrowRight, CircleCheck, PiggyBank, Plus, Radar, Sparkles } from 'lucide-react'
import type { HorizonEvent } from '@/core/types'
import { DAY, addDays, daysBetween, fmtDay, relative, span, today } from '@/core/dates'
import { EVENT_META } from '@/core/horizon'
import { replacementFund } from '@/core/health'
import { fundByOwner } from '@/core/household'
import { forecast, money, monthlyCost, renewalsBetween } from '@/core/money'
import { useData } from '@/state/data'
import { useSettings } from '@/state/settings'
import { useUI } from '@/state/ui'
import { Empty, Ring, TBadge } from '@/components/ui'
import { TONES, cx } from '@/components/kit'
import { ChargesChart, DecidedRow, EventRow, LifeBar, MemberSplit, ThingAvatar, VerdictChip } from '@/components/parts'
import { verdictTone } from '@/components/kit'
import { useEventActions } from '@/components/useEventActions'

// The Fleet card shows the things closest to the end of their window, and says
// so when there are more.
const FLEET_SHOWN = 7

function Stat({ label, value, sub, i }: { label: string; value: string; sub: string; i: number }) {
  return (
    <div className="animate-rise rounded-xl border border-line/10 bg-bg/50 px-3.5 py-3" style={{ animationDelay: `${i * 50}ms` }}>
      <p className="label">{label}</p>
      <p className="num mt-1.5 text-[22px] font-semibold leading-none text-ink">{value}</p>
      <p className="mt-1.5 truncate text-xs text-dim">{sub}</p>
    </div>
  )
}

// The strip's backdrop: faint circuit traces in three groups, each breathing
// in and out on its own slow clock so the panel feels live without anything
// travelling across it. Purely decorative, and kept above the month labels.
const TRACES: { d: string; nodes: [number, number][]; seconds: number; delay: number }[] = [
  {
    d: 'M0 14H88l10 10h74l8-8h96 M214 46h62l10-10h118l8 8h70 M640 20h54l12 12h92 M930 46h84l10-10h66l8 8h102',
    nodes: [[276, 16], [482, 44], [798, 32], [1200, 44]], seconds: 9, delay: 0,
  },
  {
    d: 'M120 38h70l10 10h58 M372 12h88l8 8h110l10-10h48 M742 44h96l10-10h60 M1040 18h70l10 10h80',
    nodes: [[120, 38], [258, 48], [646, 10], [908, 34], [1040, 18]], seconds: 12, delay: -4,
  },
  {
    d: 'M0 48h52l8-8h84 M300 30h44l10 10h70 M540 44h66l10-10h40l8 8h58 M860 14h62l8 8h96 M1100 34h100',
    nodes: [[144, 40], [424, 40], [732, 42], [860, 14], [1026, 22]], seconds: 15, delay: -9,
  },
]

function CircuitTraces() {
  return (
    <svg aria-hidden="true" viewBox="0 0 1200 68" preserveAspectRatio="xMidYMid slice" className="pointer-events-none absolute inset-0 h-full w-full text-accent">
      {TRACES.map((t, i) => (
        <g key={i} className="animate-trace" style={{ animationDuration: `${t.seconds}s`, animationDelay: `${t.delay}s` }}>
          <path d={t.d} fill="none" stroke="currentColor" strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {t.nodes.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={1.8} fill="currentColor" />)}
        </g>
      ))}
    </svg>
  )
}

// Twelve months at a glance: one pip per event, in a lane per kind.
function HorizonStrip({ events }: { events: HorizonEvent[] }) {
  const ui = useUI()
  const { openEvent } = useEventActions()
  const start = dayjs().startOf('month')
  const end = start.add(12, 'month')
  const total = end.diff(start, 'day')
  const pos = (d: string) => (daysBetween(start.format(DAY), d) / total) * 100
  const LANES: Record<HorizonEvent['type'], number> = { 'coverage-end': 0, 'support-end': 1, replace: 1, renewal: 2, 'sub-end': 2, 'trial-end': 2 }
  const pips = events.filter((e) => e.date >= start.format(DAY) && e.date < end.format(DAY) && !e.quiet && !e.repeat)
  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <p className="label">Next 12 months</p>
        <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => ui.setView('horizon')}>
          Open horizon <ArrowRight size={12} />
        </button>
      </div>
      <div className="relative h-[68px] overflow-hidden rounded-xl border border-line/10 bg-bg/50">
        {Array.from({ length: 12 }, (_, i) => {
          const m = start.add(i, 'month')
          return (
            <div key={i} className="absolute inset-y-0 border-l border-line/[0.07] first:border-l-0" style={{ left: `${pos(m.format(DAY))}%`, width: `${(m.daysInMonth() / total) * 100}%` }}>
              <span className="label absolute bottom-1 left-1.5 !text-[9px]">{m.format(m.month() === 0 || i === 0 ? 'MMM YY' : 'MMM')}</span>
            </div>
          )
        })}
        <div className="absolute inset-y-0 w-px bg-accent/70" style={{ left: `${pos(today())}%` }}>
          <span className="absolute -left-[3px] top-0 h-[7px] w-[7px] rounded-full bg-accent glow-accent" />
        </div>
        <CircuitTraces />
        {pips.map((e) => (
          <button
            key={e.key} type="button" onClick={() => openEvent(e)}
            title={`${e.title} · ${e.detail} · ${fmtDay(e.date, 'MMM D')}`}
            className={cx('absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-2 ring-bg transition hover:scale-150', TONES[EVENT_META[e.type].tone].solid, e.attention && 'animate-pulse2')}
            style={{ left: `${pos(e.date)}%`, top: 9 + LANES[e.type] * 13 }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {(['coverage-end', 'support-end', 'replace', 'renewal', 'trial-end'] as const).map((t) => (
          <span key={t} className="inline-flex items-center gap-1.5 text-[11px] text-faint">
            <span className={cx('h-1.5 w-1.5 rounded-full', TONES[EVENT_META[t].tone].solid)} />{EVENT_META[t].label}
          </span>
        ))}
      </div>
    </div>
  )
}

export function GlanceView() {
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const ref = today()

  const monthly = d.visibleSubs.reduce((t, s) => t + monthlyCost(s), 0)
  const fund = useMemo(() => replacementFund(d.activeThings, d.coverages), [d.activeThings, d.coverages])
  const months = useMemo(() => forecast(d.visibleSubs, 12), [d.visibleSubs])
  const fundSplit = useMemo(() => fundByOwner(fund.rows), [fund])
  const unassigned = d.queue.filter(d.needsSomeone).length
  const next30 = useMemo(() => {
    let total = 0
    let count = 0
    for (const s of d.visibleSubs) {
      if (s.status === 'cancelled' || !s.autoRenew) continue
      for (const day of renewalsBetween(s, ref, addDays(ref, 30))) {
        if (s.status === 'trial' && s.trialEnd && day < s.trialEnd) continue
        total += s.amount
        count++
      }
    }
    return { total, count }
  }, [d.visibleSubs, ref])

  const covered = d.activeThings.filter((t) => d.life.get(t.id)?.covered).length
  const fleet = [...d.activeThings].sort((a, b) => (d.life.get(a.id)?.daysLeft ?? 1e9) - (d.life.get(b.id)?.daysLeft ?? 1e9))
  const decided = d.events.filter((e) => (e.decision?.state === 'dismissed' || e.decision?.state === 'done') && e.days > -30 && e.days < 200).slice(0, 4)
  const urgent = d.queue.filter((e) => e.severity === 'urgent' || e.severity === 'past').length

  const headline = d.queue.length === 0
    ? 'All clear. Nothing needs you right now.'
    : `${d.queue.length} ${d.queue.length === 1 ? 'thing wants' : 'things want'} a decision.`
  const first = d.queue[0]

  if (d.ready && d.things.length === 0 && d.subscriptions.length === 0) {
    return (
      <div className="panel hud mx-auto mt-10 max-w-xl">
        <Empty
          icon={Radar} title="Nothing on the radar yet"
          body="Add your first thing, a laptop, a phone, anything with a warranty, a plan or a shelf life, and thingGLANCE starts watching its dates for you."
          action={<button type="button" className="btn-primary" onClick={() => ui.open({ type: 'thing' })}><Plus size={16} /> Add a thing</button>}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <section className="panel hud overflow-hidden p-5 lg:p-7">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:items-center">
          <div className="animate-rise">
            <p className="label flex items-center gap-2">
              <span className={cx('h-1.5 w-1.5 rounded-full', urgent ? 'animate-pulse2 bg-bad' : d.queue.length ? 'bg-warn' : 'bg-ok')} />
              {dayjs().format('ddd, MMM D')} · {urgent ? `${urgent} urgent` : d.queue.length ? 'heads up' : 'nominal'}
            </p>
            <h1 className="mt-2.5 text-[26px] font-semibold leading-[1.15] tracking-tight text-ink lg:text-[34px]">{headline}</h1>
            <p className="mt-2 text-sm leading-relaxed text-dim lg:text-[15px]">
              {first
                ? <>{first.days < 0 ? 'Overdue' : 'Next up'}: <button type="button" className="font-medium text-ink underline decoration-accent/50 underline-offset-4 hover:decoration-accent" onClick={() => first.thingId ? ui.openThing(first.thingId) : ui.open({ type: 'subscription', id: first.subscriptionId })}>{first.title.toLowerCase()}</button> for {first.detail}, {relative(first.days)}.</>
                : <>You are watching {d.activeThings.length} {d.activeThings.length === 1 ? 'thing' : 'things'} and {d.visibleSubs.filter((s) => s.status !== 'cancelled').length} plans. The next date is a way off.</>}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
            <Stat i={0} label="In service" value={String(d.activeThings.length)} sub={`${covered} under coverage`} />
            <Stat i={1} label="Plans / month" value={money(monthly, currency)} sub={`${money(monthly * 12, currency, { compact: true })} a year`} />
            <Stat i={2} label="Next 30 days" value={money(next30.total, currency)} sub={`${next30.count} ${next30.count === 1 ? 'charge' : 'charges'} coming`} />
            <Stat i={3} label="Upgrade fund" value={money(fund.monthly, currency)} sub="monthly target" />
          </div>
        </div>
        <HorizonStrip events={d.events} />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        <section className="panel min-w-0 p-4 lg:col-span-7 lg:p-5">
          <header className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Needs a decision</h2>
              <p className="text-xs text-dim">Clear each one when you have decided, or hand it to dayGLANCE.</p>
            </div>
            {d.queue.length > 0 && <span className="num rounded-md border border-line/10 bg-bg/50 px-2 py-1 text-xs text-dim">{d.queue.length}</span>}
          </header>
          {d.queue.length === 0
            ? <Empty icon={CircleCheck} title="Queue is empty" body="When a warranty is about to lapse, a plan is about to renew or a device nears the end of its support, it shows up here." />
            : <div className="stagger space-y-2">{d.queue.map((e, i) => <div key={e.key} style={{ '--i': i } as React.CSSProperties}><EventRow event={e} /></div>)}</div>}
          {unassigned > 0 && (
            <p className="mt-3 px-1 text-xs leading-relaxed text-faint">
              {unassigned === d.queue.length ? (unassigned === 1 ? 'This one falls' : 'These fall') : `${unassigned} of these fall`} to nobody in particular, so everyone is asked. The hand button makes one yours.
            </p>
          )}
          {decided.length > 0 && (
            <div className="mt-4 border-t border-line/10 pt-3">
              <p className="label mb-1">Recently cleared</p>
              {decided.map((e) => <DecidedRow key={e.key} event={e} />)}
            </div>
          )}
        </section>

        <section className="panel min-w-0 p-4 lg:col-span-5 lg:p-5">
          <header className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Fleet</h2>
              <p className="text-xs text-dim">Closest to the end of its window first.</p>
            </div>
            <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => ui.setView('things')}>All things <ArrowRight size={12} /></button>
          </header>
          <div className="stagger space-y-1">
            {fleet.slice(0, FLEET_SHOWN).map((t, i) => {
              const life = d.life.get(t.id)!
              const tone = verdictTone(life.verdict)
              return (
                <button key={t.id} type="button" style={{ '--i': i } as React.CSSProperties} onClick={() => ui.openThing(t.id)}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-line/5">
                  <Ring value={life.remaining} size={40} stroke={3.5} tone={tone}>
                    <span className={cx('num text-[10px] font-semibold', TONES[tone].text)}>{life.remaining != null ? Math.round(life.remaining * 100) : '–'}</span>
                  </Ring>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                    </span>
                    <span className="mt-1.5 block"><LifeBar life={life} /></span>
                  </span>
                  <span className="hidden shrink-0 sm:block"><VerdictChip verdict={life.verdict} /></span>
                  {life.daysLeft != null && <TBadge days={life.daysLeft} tone={tone} />}
                </button>
              )
            })}
          </div>
          {fleet.length > FLEET_SHOWN && (
            <button type="button" className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-dim transition hover:bg-line/5 hover:text-ink" onClick={() => ui.setView('things')}>
              +{fleet.length - FLEET_SHOWN} more in Things
            </button>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
        <section className="panel flex min-w-0 flex-col p-4 lg:col-span-7 lg:p-5">
          <header className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Plan charges, month by month</h2>
              <p className="text-xs text-dim">What will actually leave your account. Annual renewals are the spikes.</p>
            </div>
            <button type="button" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => ui.setView('plans')}>Plans <ArrowRight size={12} /></button>
          </header>
          <ChargesChart months={months} className="min-h-44 flex-1" />
        </section>

        <section className="panel min-w-0 p-4 lg:col-span-5 lg:p-5">
          <header className="mb-3 flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-warn/25 bg-warn/10 text-warn"><PiggyBank size={17} /></span>
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Upgrade fund</h2>
              <p className="text-xs leading-relaxed text-dim">
                Set aside <span className="num font-semibold text-ink">{money(fund.monthly, currency)}</span> a month and every replacement is paid for the day it is due.
              </p>
            </div>
          </header>
          {d.multiUser && !d.focusId && fundSplit.size > 0 && <div className="mb-3"><MemberSplit split={fundSplit} /></div>}
          {fund.rows.length === 0
            ? <p className="py-6 text-center text-sm text-dim"><Sparkles size={14} className="mr-1 inline text-accent" />Add prices and purchase dates to see this.</p>
            : (
              <div className="space-y-0.5">
                {fund.rows.slice(0, 5).map(({ thing, monthly: m, monthsLeft, lifeEnd }) => (
                  <button key={thing.id} type="button" onClick={() => ui.openThing(thing.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-line/5">
                    <ThingAvatar thing={thing} size={28} className="!rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">{thing.name}</span>
                      <span className="block text-[11px] text-faint">{monthsLeft <= 0 ? 'due now' : `replace ${fmtDay(lifeEnd, 'MMM YYYY')} · ${span(Math.round(monthsLeft * 30.44))} left`}</span>
                    </span>
                    <span className="num shrink-0 text-sm text-ink">{money(m, currency, { cents: false })}<span className="text-faint">{monthsLeft <= 0 ? '' : '/mo'}</span></span>
                  </button>
                ))}
              </div>
            )}
        </section>
      </div>
    </div>
  )
}
