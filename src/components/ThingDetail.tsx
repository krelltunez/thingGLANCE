// The detail drawer: everything known about one thing, and what is next for it.

import { useState } from 'react'
import {
  Archive, ArchiveRestore, ExternalLink, EyeOff, Pencil, Pin, PinOff, Plus, Repeat, ShieldCheck, Trash2, X,
} from 'lucide-react'
import type { Thing } from '@/core/types'
import { category } from '@/core/categories'
import { daysBetween, daysFromToday, fmtDay, relative, span, today } from '@/core/dates'
import { VERDICTS, ownership, type Lifecycle } from '@/core/health'
import { cycleShort, money } from '@/core/money'
import { deleteThing, retireThing, reviveThing, updateThing } from '@/db/queries'
import { useData } from '@/state/data'
import { useSettings } from '@/state/settings'
import { toast } from '@/state/toast'
import { useUI } from '@/state/ui'
import { Chip, Ring, TBadge } from './ui'
import { TONES, cx, severityTone, useEscape, type Tone } from './kit'
import { EventRow, ThingAvatar, VerdictChip } from './parts'
import { verdictTone } from './kit'

// The big lifecycle track: purchase to end of window, with labelled markers.
function LifeTrack({ life, thing }: { life: Lifecycle; thing: Thing }) {
  if (!life.start || !life.lifeEnd) return null
  const ref = today()
  // Stretch the axis to include whichever of the two ends is later, so both
  // support and plan are visible.
  const ends = [life.lifeEnd, life.replaceBy, life.supportEnd].filter(Boolean) as string[]
  const axisEnd = ends.sort()[ends.length - 1]
  const total = Math.max(1, daysBetween(life.start, axisEnd))
  const pos = (d: string) => Math.min(100, Math.max(0, (daysBetween(life.start!, d) / total) * 100))
  const tone = verdictTone(life.verdict)
  const marks: { day: string; label: string; tone: Tone }[] = []
  if (life.warrantyEnd) marks.push({ day: life.warrantyEnd, label: 'Coverage', tone: 'ok' })
  if (life.supportEnd) marks.push({ day: life.supportEnd, label: thing.supportBasis === 'estimate' ? 'Updates (est.)' : 'Updates', tone: 'accent' })
  if (life.replaceBy) marks.push({ day: life.replaceBy, label: 'Your plan', tone: 'warn' })
  marks.sort((a, b) => (a.day < b.day ? -1 : 1))
  return (
    <div>
      <div className="relative mt-1 h-2.5 rounded-full bg-line/10">
        <div className={cx('absolute inset-y-0 left-0 rounded-full', TONES[tone].bar)} style={{ width: `${pos(ref)}%` }} />
        {marks.map((m) => (
          <span key={m.label} className={cx('absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full', TONES[m.tone].solid)} style={{ left: `${pos(m.day)}%` }} />
        ))}
        <span className={cx('absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-panel', TONES[tone].solid)} style={{ left: `${pos(ref)}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <p className="label">{thing.purchaseDate ? 'Bought' : 'Released'}</p>
          <p className="num mt-0.5 text-[13px] text-ink">{fmtDay(life.start, 'MMM YYYY')}</p>
        </div>
        {marks.map((m) => {
          const days = daysFromToday(m.day)
          return (
            <div key={m.label}>
              <p className="label flex items-center gap-1.5"><span className={cx('h-1.5 w-1.5 rounded-full', TONES[m.tone].solid)} />{m.label}</p>
              <p className={cx('num mt-0.5 text-[13px]', days < 0 ? 'text-faint line-through' : 'text-ink')}>{fmtDay(m.day, 'MMM YYYY')}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line/10 bg-bg/40 px-3 py-2.5">
      <p className="label">{label}</p>
      <p className="mt-1 truncate text-sm text-ink">{children}</p>
    </div>
  )
}

export function ThingDetail({ thingId }: { thingId: string }) {
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEscape(() => ui.openThing(null))

  const thing = d.thingById.get(thingId)
  if (!thing) return null
  const life = d.life.get(thing.id)!
  const covs = d.coveragesFor(thing.id)
  const subs = d.subsFor(thing.id)
  const own = ownership(thing, covs, subs)
  const tone = verdictTone(life.verdict)
  const upcoming = d.events.filter((e) => e.thingId === thing.id && (e.days >= 0 || e.attention)).slice(0, 6)
  const owner = d.memberName(thing.ownerMemberId)
  const handler = thing.responsibleMemberId !== thing.ownerMemberId ? d.memberName(thing.responsibleMemberId) : null
  const before = (thing.ownershipHistory ?? []).map((h) => `${d.memberName(h.memberId) ?? 'Household'} until ${fmtDay(h.to, 'MMM YYYY')}`)
  const retired = thing.status === 'retired'

  const headline = retired
    ? `Retired ${thing.retiredAt ? fmtDay(thing.retiredAt, 'MMM YYYY') : ''}`
    : life.daysLeft == null ? VERDICTS.unknown.hint
    : life.daysLeft < 0
      ? `${life.lifeEndReason === 'support' ? 'Support ended' : 'Past your plan'} ${relative(life.daysLeft)}`
      : `${life.lifeEndReason === 'support' ? 'Support runs out' : 'Due for replacement'} ${relative(life.daysLeft)}`

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={() => ui.openThing(null)} />
      <aside className="relative flex h-full w-full max-w-[560px] animate-slide-in flex-col border-l border-line/15 bg-panel shadow-2xl">
        <header className="safe-top flex items-center gap-2 border-b border-line/10 px-4 pb-3">
          <button type="button" className="icon-btn h-8 w-8" onClick={() => ui.openThing(null)} aria-label="Close"><X size={16} /></button>
          <span className="label flex-1 truncate pl-1">{category(thing.category).label}{thing.sample ? ' · sample' : ''}</span>
          <button type="button" className="icon-btn h-8 w-8" title={thing.pinned ? 'Unpin' : 'Pin to the top'} onClick={() => void updateThing(thing.id, { pinned: !thing.pinned })}>
            {thing.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button type="button" className="btn h-8" onClick={() => ui.open({ type: 'thing', id: thing.id })}><Pencil size={14} /> Edit</button>
        </header>

        <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="flex items-start gap-4">
            <ThingAvatar thing={thing} size={72} className="!rounded-2xl" />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold leading-tight tracking-tight text-ink">{thing.name}</h2>
              <p className="mt-0.5 text-sm text-dim">{[thing.brand, thing.model].filter(Boolean).join(' · ') || '—'}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <VerdictChip verdict={life.verdict} />
                {life.covered && <Chip tone="ok" icon={ShieldCheck}>Covered</Chip>}
                {d.multiUser && d.members.length > 0 && <Chip tone="dim">{owner ?? 'Household'}</Chip>}
                {thing.visibility === 'private' && <Chip tone="dim" icon={EyeOff}>Private</Chip>}
              </div>
              {d.multiUser && (handler || before.length > 0) && (
                <p className="mt-2 text-xs text-faint">
                  {[handler ? `${handler} deals with it` : null, before.length ? `Before: ${before.join(', ')}` : null].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </section>

          <section className="panel hud !bg-raised/40 p-4">
            <div className="mb-4 flex items-center gap-4">
              <Ring value={retired ? null : life.remaining} size={76} stroke={6} tone={tone}>
                <span className="text-center leading-none">
                  <span className={cx('num block text-lg font-semibold', TONES[tone].text)}>{life.remaining != null && !retired ? `${Math.round(life.remaining * 100)}%` : '—'}</span>
                  <span className="label !text-[8px]">left</span>
                </span>
              </Ring>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ink">{headline}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-dim">
                  {life.ageDays != null && <>{span(life.ageDays)} old. </>}
                  {!retired && VERDICTS[life.verdict].hint}.
                </p>
              </div>
            </div>
            <LifeTrack life={life} thing={thing} />
          </section>

          {upcoming.length > 0 && !retired && (
            <section>
              <p className="label mb-2">Coming up</p>
              <div className="space-y-2">{upcoming.map((e) => <EventRow key={e.key} event={e} compact={!e.attention} />)}</div>
            </section>
          )}

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label="Bought">{fmtDay(thing.purchaseDate)}</Fact>
            <Fact label="Paid"><span className="num">{money(thing.price, currency)}</span></Fact>
            <Fact label="From">{thing.retailer ?? '—'}</Fact>
            <Fact label={retired ? 'Cost per day' : 'Per day so far'}><span className="num">{own.perDay != null ? money(own.perDay, currency, { cents: true }) : '—'}</span></Fact>
            <Fact label="Per day, on plan"><span className="num">{own.projectedPerDay != null ? money(own.projectedPerDay, currency, { cents: true }) : '—'}</span></Fact>
            <Fact label={retired ? 'Sold for' : 'Plans / year'}><span className="num">{retired ? money(thing.resaleValue, currency) : own.subscriptionsPerYear ? money(own.subscriptionsPerYear, currency) : '—'}</span></Fact>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="label">Coverage</p>
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => ui.open({ type: 'coverage', thingId: thing.id })}><Plus size={12} /> Add</button>
            </div>
            {covs.length === 0
              ? <p className="rounded-xl border border-dashed border-line/15 px-3 py-4 text-center text-xs text-faint">No warranty or protection plan on record.</p>
              : (
                <div className="space-y-2">
                  {covs.map((c) => {
                    const days = daysFromToday(c.endDate)
                    return (
                      <button key={c.id} type="button" onClick={() => ui.open({ type: 'coverage', thingId: thing.id, id: c.id })}
                        className={cx('flex w-full items-center gap-3 rounded-xl border border-line/10 bg-raised/40 px-3 py-2.5 text-left transition hover:border-line/25', days < 0 && 'opacity-55')}>
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-ok/25 bg-ok/10 text-ok"><ShieldCheck size={15} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                          <span className="block truncate text-xs text-dim">{[c.provider, `until ${fmtDay(c.endDate)}`, c.cost ? money(c.cost, currency) : null].filter(Boolean).join(' · ')}</span>
                        </span>
                        <TBadge days={days} tone={days < 0 ? 'dim' : severityTone(days <= 14 ? 'urgent' : days <= 45 ? 'soon' : 'later')} />
                      </button>
                    )
                  })}
                </div>
              )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="label">Plans</p>
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => ui.open({ type: 'subscription', thingId: thing.id })}><Plus size={12} /> Add</button>
            </div>
            {subs.length === 0
              ? <p className="rounded-xl border border-dashed border-line/15 px-3 py-4 text-center text-xs text-faint">Nothing recurring attached to this.</p>
              : (
                <div className="space-y-2">
                  {subs.map((s) => (
                    <button key={s.id} type="button" onClick={() => ui.open({ type: 'subscription', id: s.id })}
                      className={cx('flex w-full items-center gap-3 rounded-xl border border-line/10 bg-raised/40 px-3 py-2.5 text-left transition hover:border-line/25', s.status === 'cancelled' && 'opacity-55')}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sub/25 bg-sub/10 text-sub"><Repeat size={15} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                        <span className="block truncate text-xs text-dim">{[s.provider, s.status === 'cancelled' ? 'cancelled' : s.review ? 'under review' : null].filter(Boolean).join(' · ') || 'Active'}</span>
                      </span>
                      <span className="num shrink-0 text-sm text-ink">{money(s.amount, currency)}<span className="text-faint">/{cycleShort(s.cycle)}</span></span>
                    </button>
                  ))}
                </div>
              )}
          </section>

          {(thing.specs?.length || thing.summary) && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <p className="label">Specs</p>
                {thing.sourceUrl && <a href={thing.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-faint hover:text-accent">Wikipedia <ExternalLink size={11} /></a>}
              </div>
              {thing.summary && <p className="mb-3 text-[13px] leading-relaxed text-dim">{thing.summary}</p>}
              {!!thing.specs?.length && (
                <dl className="divide-y divide-line/[0.07] rounded-xl border border-line/10 bg-bg/40">
                  {thing.specs.map((s) => (
                    <div key={s.label} className="flex gap-4 px-3 py-2 text-[13px]">
                      <dt className="label w-24 shrink-0 pt-0.5">{s.label}</dt>
                      <dd className="min-w-0 flex-1 select-text text-ink">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
          )}

          {thing.notes && (
            <section>
              <p className="label mb-2">Notes</p>
              <p className="select-text whitespace-pre-wrap rounded-xl border border-line/10 bg-bg/40 px-3 py-2.5 text-[13px] leading-relaxed text-ink">{thing.notes}</p>
            </section>
          )}

          <section className="flex flex-wrap gap-2 border-t border-line/10 pt-5">
            {retired
              ? <button type="button" className="btn" onClick={() => void reviveThing(thing.id)}><ArchiveRestore size={15} /> Back in service</button>
              : <button type="button" className="btn" onClick={() => { void retireThing(thing.id); toast({ title: `${thing.name} retired`, body: 'Edit it to record what you sold it for.', tone: 'ok', action: { label: 'Undo', run: () => void reviveThing(thing.id) } }) }}><Archive size={15} /> Retire</button>}
            {confirmDelete
              ? (
                <>
                  <button type="button" className="btn-danger" onClick={() => { void deleteThing(thing.id); ui.openThing(null); toast({ title: `${thing.name} deleted` }) }}><Trash2 size={15} /> Delete for good</button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>Keep it</button>
                </>
              )
              : <button type="button" className="btn-ghost hover:!text-bad" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete</button>}
          </section>
        </div>
      </aside>
    </div>
  )
}
