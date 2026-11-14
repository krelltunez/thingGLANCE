// The detail drawer: everything known about one thing, and what is next for it.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive, ArchiveRestore, ExternalLink, EyeOff, Pencil, Pin, PinOff, Plus, Repeat, ShieldCheck, Trash2, X,
} from 'lucide-react'
import type { Thing } from '@/core/types'
import { categoryLabel } from '@/core/categories'
import { daysBetween, daysFromToday, fmtDay, fmtMonth, relative, span, today } from '@/core/dates'
import { ownership, verdictHint, type Lifecycle } from '@/core/health'
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
  const { t } = useTranslation()
  if (!life.start || !life.lifeEnd) return null
  const ref = today()
  // Stretch the axis to include whichever of the two ends is later, so both
  // support and plan are visible.
  const ends = [life.lifeEnd, life.replaceBy, life.supportEnd].filter(Boolean) as string[]
  const axisEnd = ends.sort()[ends.length - 1]
  const total = Math.max(1, daysBetween(life.start, axisEnd))
  const pos = (d: string) => Math.min(100, Math.max(0, (daysBetween(life.start!, d) / total) * 100))
  const tone = verdictTone(life.verdict)
  const marks: { id: string; day: string; label: string; tone: Tone }[] = []
  if (life.warrantyEnd) marks.push({ id: 'coverage', day: life.warrantyEnd, label: t('detail.track.coverage'), tone: 'ok' })
  if (life.supportEnd) marks.push({ id: 'updates', day: life.supportEnd, label: thing.supportBasis === 'estimate' ? t('detail.track.updatesEstimated') : t('detail.track.updates'), tone: 'accent' })
  if (life.replaceBy) marks.push({ id: 'plan', day: life.replaceBy, label: t('detail.track.plan'), tone: 'warn' })
  marks.sort((a, b) => (a.day < b.day ? -1 : 1))
  return (
    <div>
      <div className="relative mt-1 h-2.5 rounded-full bg-line/10">
        <div className={cx('absolute inset-y-0 left-0 rounded-full', TONES[tone].bar)} style={{ width: `${pos(ref)}%` }} />
        {marks.map((m) => (
          <span key={m.id} className={cx('absolute top-1/2 h-4 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full', TONES[m.tone].solid)} style={{ left: `${pos(m.day)}%` }} />
        ))}
        <span className={cx('absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-[3px] ring-panel', TONES[tone].solid)} style={{ left: `${pos(ref)}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <div>
          <p className="label">{thing.purchaseDate ? t('detail.bought') : t('detail.released')}</p>
          <p className="num mt-0.5 text-[13px] text-ink">{fmtMonth(life.start)}</p>
        </div>
        {marks.map((m) => {
          const days = daysFromToday(m.day)
          return (
            <div key={m.id}>
              <p className="label flex items-center gap-1.5"><span className={cx('h-1.5 w-1.5 rounded-full', TONES[m.tone].solid)} />{m.label}</p>
              <p className={cx('num mt-0.5 text-[13px]', days < 0 ? 'text-faint line-through' : 'text-ink')}>{fmtMonth(m.day)}</p>
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
  const { t } = useTranslation()
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
  const before = (thing.ownershipHistory ?? []).map((h) => t('detail.heldUntil', { name: d.memberName(h.memberId) ?? t('common.household'), when: fmtDay(h.to, 'MMM YYYY') }))
  const retired = thing.status === 'retired'

  const headline = retired
    ? thing.retiredAt ? t('detail.headline.retiredOn', { when: fmtDay(thing.retiredAt, 'MMM YYYY') }) : t('detail.headline.retired')
    : life.daysLeft == null ? verdictHint('unknown')
    : life.daysLeft < 0
      ? life.lifeEndReason === 'support' ? t('detail.headline.supportEnded', { when: relative(life.daysLeft) }) : t('detail.headline.pastPlan', { when: relative(life.daysLeft) })
      : life.lifeEndReason === 'support' ? t('detail.headline.supportRunsOut', { when: relative(life.daysLeft) }) : t('detail.headline.dueForReplacement', { when: relative(life.daysLeft) })

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={() => ui.openThing(null)} />
      <aside className="relative flex h-full w-full max-w-[560px] animate-slide-in flex-col border-l border-line/15 bg-panel shadow-2xl">
        <header className="safe-top flex items-center gap-2 border-b border-line/10 px-4 pb-3">
          <button type="button" className="icon-btn h-8 w-8" onClick={() => ui.openThing(null)} aria-label={t('common.close')}><X size={16} /></button>
          <span className="label flex-1 truncate pl-1">{categoryLabel(thing.category)}{thing.sample ? ` · ${t('common.sample')}` : ''}</span>
          <button type="button" className="icon-btn h-8 w-8" title={thing.pinned ? t('detail.unpin') : t('detail.pin')} onClick={() => void updateThing(thing.id, { pinned: !thing.pinned })}>
            {thing.pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button type="button" className="btn h-8" onClick={() => ui.open({ type: 'thing', id: thing.id })}><Pencil size={14} /> {t('common.edit')}</button>
        </header>

        <div className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section className="flex items-start gap-4">
            <ThingAvatar thing={thing} size={72} className="!rounded-2xl" />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-semibold leading-tight tracking-tight text-ink">{thing.name}</h2>
              <p className="mt-0.5 text-sm text-dim">{[thing.brand, thing.model].filter(Boolean).join(' · ') || '—'}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <VerdictChip verdict={life.verdict} />
                {life.covered && <Chip tone="ok" icon={ShieldCheck}>{t('detail.covered')}</Chip>}
                {d.multiUser && d.members.length > 0 && <Chip tone="dim">{owner ?? t('common.household')}</Chip>}
                {thing.visibility === 'private' && <Chip tone="dim" icon={EyeOff}>{t('common.private')}</Chip>}
              </div>
              {d.multiUser && (handler || before.length > 0) && (
                <p className="mt-2 text-xs text-faint">
                  {[handler ? t('detail.dealsWithIt', { name: handler }) : null, before.length ? t('detail.before', { list: before.join(', ') }) : null].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          </section>

          <section className="panel hud !bg-raised/40 p-4">
            <div className="mb-4 flex items-center gap-4">
              <Ring value={retired ? null : life.remaining} size={76} stroke={6} tone={tone}>
                <span className="text-center leading-none">
                  <span className={cx('num block text-lg font-semibold', TONES[tone].text)}>{life.remaining != null && !retired ? `${Math.round(life.remaining * 100)}%` : '—'}</span>
                  <span className="label !text-[8px]">{t('detail.left')}</span>
                </span>
              </Ring>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-ink">{headline}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-dim">
                  {life.ageDays != null && <>{t('detail.age', { age: span(life.ageDays) })} </>}
                  {retired ? '.' : t('detail.hint', { hint: verdictHint(life.verdict) })}
                </p>
              </div>
            </div>
            <LifeTrack life={life} thing={thing} />
          </section>

          {upcoming.length > 0 && !retired && (
            <section>
              <p className="label mb-2">{t('detail.comingUp')}</p>
              <div className="space-y-2">{upcoming.map((e) => <EventRow key={e.key} event={e} compact={!e.attention} />)}</div>
            </section>
          )}

          <section className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Fact label={t('detail.bought')}>{fmtDay(thing.purchaseDate)}</Fact>
            <Fact label={t('detail.paid')}><span className="num">{money(thing.price, currency)}</span></Fact>
            <Fact label={t('detail.from')}>{thing.retailer ?? '—'}</Fact>
            <Fact label={retired ? t('detail.costPerDay') : t('detail.perDaySoFar')}><span className="num">{own.perDay != null ? money(own.perDay, currency, { cents: true }) : '—'}</span></Fact>
            <Fact label={t('detail.perDayOnPlan')}><span className="num">{own.projectedPerDay != null ? money(own.projectedPerDay, currency, { cents: true }) : '—'}</span></Fact>
            <Fact label={retired ? t('detail.soldFor') : t('detail.plansPerYear')}><span className="num">{retired ? money(thing.resaleValue, currency) : own.subscriptionsPerYear ? money(own.subscriptionsPerYear, currency) : '—'}</span></Fact>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <p className="label">{t('detail.coverage.title')}</p>
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => ui.open({ type: 'coverage', thingId: thing.id })}><Plus size={12} /> {t('common.add')}</button>
            </div>
            {covs.length === 0
              ? <p className="rounded-xl border border-dashed border-line/15 px-3 py-4 text-center text-xs text-faint">{t('detail.coverage.empty')}</p>
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
                          <span className="block truncate text-xs text-dim">{[c.provider, t('detail.coverage.until', { when: fmtDay(c.endDate) }), c.cost ? money(c.cost, currency) : null].filter(Boolean).join(' · ')}</span>
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
              <p className="label">{t('detail.plans.title')}</p>
              <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline" onClick={() => ui.open({ type: 'subscription', thingId: thing.id })}><Plus size={12} /> {t('common.add')}</button>
            </div>
            {subs.length === 0
              ? <p className="rounded-xl border border-dashed border-line/15 px-3 py-4 text-center text-xs text-faint">{t('detail.plans.empty')}</p>
              : (
                <div className="space-y-2">
                  {subs.map((s) => (
                    <button key={s.id} type="button" onClick={() => ui.open({ type: 'subscription', id: s.id })}
                      className={cx('flex w-full items-center gap-3 rounded-xl border border-line/10 bg-raised/40 px-3 py-2.5 text-left transition hover:border-line/25', s.status === 'cancelled' && 'opacity-55')}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sub/25 bg-sub/10 text-sub"><Repeat size={15} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{s.name}</span>
                        <span className="block truncate text-xs text-dim">{[s.provider, s.status === 'cancelled' ? t('detail.plans.cancelled') : s.review ? t('detail.plans.underReview') : null].filter(Boolean).join(' · ') || t('detail.plans.active')}</span>
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
                <p className="label">{t('detail.specs')}</p>
                {thing.sourceUrl && <a href={thing.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-faint hover:text-accent">{t('detail.wikipedia')} <ExternalLink size={11} /></a>}
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
              <p className="label mb-2">{t('detail.notes')}</p>
              <p className="select-text whitespace-pre-wrap rounded-xl border border-line/10 bg-bg/40 px-3 py-2.5 text-[13px] leading-relaxed text-ink">{thing.notes}</p>
            </section>
          )}

          <section className="flex flex-wrap gap-2 border-t border-line/10 pt-5">
            {retired
              ? <button type="button" className="btn" onClick={() => void reviveThing(thing.id)}><ArchiveRestore size={15} /> {t('detail.backInService')}</button>
              : <button type="button" className="btn" onClick={() => { void retireThing(thing.id); toast({ title: t('detail.retiredToast', { name: thing.name }), body: t('detail.retiredToastBody'), tone: 'ok', action: { label: t('toast.undo'), run: () => void reviveThing(thing.id) } }) }}><Archive size={15} /> {t('detail.retire')}</button>}
            {confirmDelete
              ? (
                <>
                  <button type="button" className="btn-danger" onClick={() => { void deleteThing(thing.id); ui.openThing(null); toast({ title: t('detail.deletedToast', { name: thing.name }) }) }}><Trash2 size={15} /> {t('detail.deleteForGood')}</button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>{t('detail.keepIt')}</button>
                </>
              )
              : <button type="button" className="btn-ghost hover:!text-bad" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> {t('common.delete')}</button>}
          </section>
        </div>
      </aside>
    </div>
  )
}
