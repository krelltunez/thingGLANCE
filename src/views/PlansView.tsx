// Plans: every subscription, what it really costs, and when it next asks for
// money. "Review" is the app's one nag: flag a plan and it joins the queue a
// week before it renews.

import { useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Eye, EyeOff, Plus, Repeat } from 'lucide-react'
import type { Subscription } from '@/core/types'
import { daysFromToday, fmtDay, fmtMonth } from '@/core/dates'
import { cycleShort, forecast, isBilling, money, monthlyCost, nextRenewal } from '@/core/money'
import { planCostByPayer } from '@/core/household'
import { patchSubscription } from '@/db/queries'
import { useData } from '@/state/data'
import { useSettings } from '@/state/settings'
import { useUI } from '@/state/ui'
import { Chip, Empty, TBadge } from '@/components/ui'
import { ChargesChart, MemberSplit } from '@/components/parts'
import { cx, type Tone } from '@/components/kit'

// The next date a plan has, and what happens on it. `what` picks the words
// (plans.next.*) where the row is drawn.
type NextKind = 'accessEnds' | 'trialConverts' | 'expires' | 'renews'

function nextDate(s: Subscription): { day: string; what: NextKind } | null {
  if (s.status === 'cancelled') return s.endDate ? { day: s.endDate, what: 'accessEnds' } : null
  if (s.status === 'trial' && s.trialEnd) return { day: s.trialEnd, what: 'trialConverts' }
  if (!s.autoRenew) { const day = s.endDate ?? nextRenewal(s); return day ? { day, what: 'expires' } : null }
  const day = nextRenewal(s)
  return day ? { day, what: 'renews' } : null
}

function PlanRow({ sub }: { sub: Subscription }) {
  const { t } = useTranslation()
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const things = sub.coversThingIds.map((id) => d.thingById.get(id)).filter((thing) => !!thing)
  const where = things.length > 1 ? t('plans.row.andMore', { name: things[0].name, count: things.length - 1 }) : things[0]?.name
  const next = nextDate(sub)
  const days = next ? daysFromToday(next.day) : null
  const long = sub.cycle === 'yearly' || sub.cycle === 'quarterly'
  const tone: Tone = days == null ? 'dim' : days < 0 ? 'bad' : days <= 14 && (long || sub.review || sub.status === 'trial') ? 'bad' : days <= 30 && long ? 'warn' : 'dim'
  const off = sub.status === 'cancelled'
  return (
    <div className={cx('group flex items-center gap-3 rounded-xl border border-line/10 bg-raised/40 px-3 py-2.5 transition hover:border-line/25 hover:bg-raised/70', off && 'opacity-60')}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-sub/25 bg-sub/10 font-semibold uppercase text-sub">{sub.name.trim()[0] ?? '?'}</span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => ui.open({ type: 'subscription', id: sub.id })}>
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{sub.name}</span>
          {sub.status === 'trial' && <Chip tone="bad">{t('plans.row.trial')}</Chip>}
          {off && <Chip tone="dim">{t('plans.row.cancelled')}</Chip>}
        </span>
        <span className="block truncate text-xs text-dim">
          {[sub.provider, where, d.multiUser ? d.memberName(sub.payerMemberId) : null].filter(Boolean).join(' · ') || t('plans.row.standalone')}
          {next && <> · {t(`plans.next.${next.what}`, { date: fmtDay(next.day, 'MMM D') })}</>}
        </span>
      </button>
      <div className="shrink-0 text-right">
        <p className="num text-sm font-semibold text-ink">{money(sub.amount, currency)}<span className="font-normal text-faint">/{cycleShort(sub.cycle)}</span></p>
        {sub.cycle !== 'monthly' && isBilling(sub) && <p className="num text-[11px] text-faint">{money(monthlyCost(sub), currency, { cents: true })}/{cycleShort('monthly')}</p>}
      </div>
      {days != null && <TBadge days={days} tone={tone} className="hidden sm:inline-flex" />}
      {!off && (
        <button
          type="button" className={cx('icon-btn h-8 w-8', sub.review && '!border-accent/40 !text-accent')}
          title={sub.review ? t('plans.row.underReview') : t('plans.row.review')}
          onClick={() => void patchSubscription(sub.id, { review: !sub.review })}
        >
          {sub.review ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
      )}
    </div>
  )
}

export function PlansView() {
  const { t } = useTranslation()
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()

  const subs = d.visibleSubs
  const live = subs.filter((s) => s.status !== 'cancelled')
  const monthly = subs.reduce((sum, s) => sum + monthlyCost(s), 0)
  const months = useMemo(() => forecast(subs, 12), [subs])
  // Who pays is about the whole household, whatever the member filter is on.
  const byPayer = useMemo(() => planCostByPayer(d.subscriptions), [d.subscriptions])
  const peak = months.reduce((a, b) => (b.total > a.total ? b : a), months[0])

  const sorted = (list: Subscription[]) => [...list].sort((a, b) => (nextDate(a)?.day ?? '9999').localeCompare(nextDate(b)?.day ?? '9999'))
  const watch = sorted(live.filter((s) => s.review || s.status === 'trial'))
  const rest = sorted(live.filter((s) => !s.review && s.status !== 'trial'))
  const ended = subs.filter((s) => s.status === 'cancelled')
  const reviewMonthly = watch.reduce((sum, s) => sum + monthlyCost(s), 0)

  if (d.ready && subs.length === 0) {
    return (
      <div className="panel hud mx-auto mt-10 max-w-xl">
        <Empty icon={Repeat} title={t('plans.empty.title')} body={t('plans.empty.body')}
          action={<button type="button" className="btn-primary" onClick={() => ui.open({ type: 'subscription' })}><Plus size={16} /> {t('plans.empty.add')}</button>} />
      </div>
    )
  }

  return (
    <div className="space-y-4 lg:space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">{t('plans.title')}</h1>
          <p className="text-sm text-dim">{t('plans.subtitle')}</p>
        </div>
      </div>

      <section className="panel hud grid grid-cols-1 gap-6 p-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:p-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1 lg:gap-5">
          <div>
            <p className="label">{t('plans.everyMonth')}</p>
            <p className="num mt-1.5 text-3xl font-semibold leading-none text-ink">{money(monthly, currency)}</p>
            <p className="mt-1.5 text-xs text-dim">{t('plans.across', { count: live.length })}</p>
          </div>
          <div>
            <p className="label">{t('plans.everyYear')}</p>
            <p className="num mt-1.5 text-3xl font-semibold leading-none text-ink">{money(monthly * 12, currency, { compact: true })}</p>
            <p className="mt-1.5 text-xs text-dim">{peak && peak.total > 0 ? t('plans.biggestMonth', { month: fmtMonth(peak.month) }) : t('plans.noCharges')}</p>
          </div>
          {d.multiUser && byPayer.size > 0 && (
            <div className="col-span-2 lg:col-span-1">
              <p className="label mb-2">{t('plans.whoPays')}</p>
              <MemberSplit split={byPayer} />
            </div>
          )}
          {reviewMonthly > 0 && (
            <div className="col-span-2 rounded-xl border border-accent/20 bg-accent/5 px-3 py-2.5 lg:col-span-1">
              <p className="text-xs leading-relaxed text-dim"><Eye size={12} className="mr-1 inline text-accent" /><Trans i18nKey="plans.reviewSavings" values={{ amount: money(reviewMonthly * 12, currency) }} components={{ b: <span className="num font-semibold text-ink" /> }} /></p>
            </div>
          )}
        </div>
        <div>
          <p className="label mb-3">{t('plans.chargesTitle')}</p>
          <ChargesChart months={months} className="h-40" />
        </div>
      </section>

      {watch.length > 0 && (
        <section className="panel p-4 lg:p-5">
          <h2 className="text-[15px] font-semibold text-ink">{t('plans.review.title')}</h2>
          <p className="mb-3 text-xs text-dim">{t('plans.review.hint')}</p>
          <div className="space-y-2">{watch.map((s) => <PlanRow key={s.id} sub={s} />)}</div>
        </section>
      )}

      <section className="panel p-4 lg:p-5">
        <h2 className="mb-3 text-[15px] font-semibold text-ink">{watch.length ? t('plans.everythingElse') : t('plans.allPlans')}</h2>
        <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">{rest.map((s) => <PlanRow key={s.id} sub={s} />)}</div>
        {ended.length > 0 && (
          <>
            <p className="label mb-2 mt-5">{t('plans.ended')}</p>
            <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">{ended.map((s) => <PlanRow key={s.id} sub={s} />)}</div>
          </>
        )}
      </section>
    </div>
  )
}
