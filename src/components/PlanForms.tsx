// The two small forms: a subscription ("plan") and a coverage.

import { useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { Trash2, X } from 'lucide-react'
import type { CoverageType, Cycle, Subscription } from '@/core/types'
import { DAY, today } from '@/core/dates'
import { CYCLES, cycleLabel } from '@/core/money'
import { deleteCoverage, deleteSubscription, saveCoverage, saveSubscription } from '@/db/queries'
import { useData } from '@/state/data'
import { useSettings } from '@/state/settings'
import { toast } from '@/state/toast'
import { useUI } from '@/state/ui'
import { Field, Segmented, Sheet, Toggle } from './ui'
import { cx, num, whoFields, type WhoDraft } from './kit'
import { HouseholdFields, MembersPicker } from './HouseholdFields'

export function SubscriptionForm({ id, thingId, initialName }: { id?: string; thingId?: string; initialName?: string }) {
  const { t } = useTranslation()
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const existing = id ? d.subById.get(id) : undefined
  const [f, setF] = useState(() => ({
    name: existing?.name ?? initialName ?? '',
    provider: existing?.provider ?? '',
    amount: existing ? String(existing.amount) : '',
    cycle: (existing?.cycle ?? 'monthly') as Cycle,
    anchorDate: existing?.anchorDate ?? today(),
    thingIds: existing?.coversThingIds ?? (thingId ? [thingId] : []),
    status: (existing?.status ?? 'active') as Subscription['status'],
    trialEnd: existing?.trialEnd ?? '',
    endDate: existing?.endDate ?? '',
    autoRenew: existing?.autoRenew ?? true,
    review: existing?.review ?? false,
    who: (existing
      ? { holder: existing.payerMemberId ?? '', responsible: existing.responsibleMemberId ?? '', isPrivate: existing.visibility === 'private' }
      : { holder: '', responsible: d.meId ?? '', isPrivate: false }) as WhoDraft,
    coversMemberIds: existing?.coversMemberIds ?? [],
    notes: existing?.notes ?? '',
  }))
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const amount = num(f.amount)
  const valid = !!f.name.trim() && amount != null && !!f.anchorDate

  const attached = f.thingIds.map((tid) => d.thingById.get(tid)).filter((thing) => !!thing)
  const attachable = d.things.filter((thing) => thing.status === 'active' && !f.thingIds.includes(thing.id))

  const save = async () => {
    if (!valid) return
    const who = whoFields(f.who)
    await saveSubscription({
      name: f.name.trim(),
      provider: f.provider.trim() || undefined,
      amount: amount!,
      cycle: f.cycle,
      anchorDate: f.status === 'trial' && f.trialEnd ? f.trialEnd : f.anchorDate,
      // Ids this device cannot resolve (a thing hidden from it, or not yet
      // synced) are kept: the form only edits what it can show.
      coversThingIds: f.thingIds,
      coversMemberIds: f.coversMemberIds,
      status: f.status,
      trialEnd: f.status === 'trial' ? f.trialEnd || undefined : undefined,
      endDate: f.status === 'cancelled' || !f.autoRenew ? f.endDate || undefined : undefined,
      autoRenew: f.autoRenew,
      review: f.review,
      payerMemberId: who.holder,
      responsibleMemberId: who.responsibleMemberId,
      visibility: who.visibility,
      notes: f.notes.trim() || undefined,
    }, existing?.id)
    ui.close()
    if (!existing) toast({ title: t('planForm.added', { name: f.name.trim() }), tone: 'ok' })
  }

  return (
    <Sheet
      title={existing ? t('planForm.editTitle', { name: existing.name }) : t('planForm.addTitle')}
      subtitle={existing ? undefined : t('planForm.subtitle')}
      onClose={ui.close}
      footer={<>
        {existing && <button type="button" className="btn-ghost mr-auto hover:!text-bad" onClick={() => { void deleteSubscription(existing.id); ui.close(); toast({ title: t('planForm.deleted', { name: existing.name }) }) }}><Trash2 size={15} /> {t('common.delete')}</button>}
        <button type="button" className="btn-ghost" onClick={ui.close}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>{existing ? t('common.save') : t('planForm.add')}</button>
      </>}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('planForm.name')} className="col-span-2"><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={t('planForm.namePlaceholder')} /></Field>
          <Field label={t('planForm.provider')}><input className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)} placeholder={t('planForm.providerPlaceholder')} /></Field>
          <Field label={t('planForm.amount', { currency })}><input className="input num" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="9.99" /></Field>
        </div>

        <div>
          <span className="label mb-1.5 block">{t('planForm.billed')}</span>
          <Segmented value={f.cycle} onChange={(v) => set('cycle', v)} options={CYCLES.map((c) => ({ id: c.id, label: cycleLabel(c.id) }))} />
        </div>

        <div>
          <span className="label mb-1.5 block">{t('planForm.status.label')}</span>
          <Segmented value={f.status} onChange={(v) => set('status', v)} options={[{ id: 'active', label: t('planForm.status.active') }, { id: 'trial', label: t('planForm.status.trial') }, { id: 'cancelled', label: t('planForm.status.cancelled') }]} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f.status === 'trial'
            ? <Field label={t('planForm.trialEnds')} hint={t('planForm.trialEndsHint')}><input type="date" className="input" value={f.trialEnd} onChange={(e) => set('trialEnd', e.target.value)} /></Field>
            : f.status === 'cancelled'
              ? <Field label={t('planForm.accessEnds')} hint={t('planForm.accessEndsHint')}><input type="date" className="input" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
              : <Field label={t('planForm.nextRenewal')} hint={t('planForm.nextRenewalHint')}><input type="date" className="input" value={f.anchorDate} onChange={(e) => set('anchorDate', e.target.value)} /></Field>}
          <Field label={t('planForm.attachedTo')} hint={attached.length > 1 ? t('planForm.attachedSplitHint') : undefined}>
            {attached.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {attached.map((thing) => (
                  <span key={thing.id} className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-accent/40 bg-accent/15 pl-3 pr-1 text-[13px] font-medium text-accent">
                    <span className="truncate">{thing.name}</span>
                    <button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-accent/20" aria-label={t('planForm.detach', { name: thing.name })} onClick={() => set('thingIds', f.thingIds.filter((x) => x !== thing.id))}><X size={13} /></button>
                  </span>
                ))}
              </div>
            )}
            {(attachable.length > 0 || attached.length === 0) && (
              <select className="input" aria-label={t('planForm.attach')} value="" onChange={(e) => { if (e.target.value) set('thingIds', [...f.thingIds, e.target.value]) }}>
                <option value="">{attached.length ? t('planForm.attachAnother') : t('planForm.attachNothing')}</option>
                {attachable.map((thing) => <option key={thing.id} value={thing.id}>{thing.name}</option>)}
              </select>
            )}
          </Field>
        </div>

        {f.status !== 'cancelled' && (
          <div className="space-y-2 rounded-xl border border-line/10 bg-bg/40 px-3 py-2">
            <Toggle checked={f.autoRenew} onChange={(v) => set('autoRenew', v)} label={t('planForm.autoRenew')} hint={t('planForm.autoRenewHint')} />
            <Toggle checked={f.review} onChange={(v) => set('review', v)} label={t('planForm.review')} hint={t('planForm.reviewHint')} />
          </div>
        )}

        <HouseholdFields value={f.who} onChange={(who) => set('who', who)} noun="plan" holderLabel={t('planForm.holderLabel')} />
        {d.multiUser && d.members.length > 1 && (
          <MembersPicker label={t('planForm.coversLabel')} value={f.coversMemberIds} onChange={(ids) => set('coversMemberIds', ids)} hint={t('planForm.coversHint')} />
        )}

        <Field label={t('planForm.notes')}><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t('planForm.notesPlaceholder')} /></Field>
      </div>
    </Sheet>
  )
}

// The words for each (its label, and the name a coverage gets when none is
// typed) are in the catalog under planForm.coverage.type and .name.
const COVERAGE_TYPES: CoverageType[] = ['warranty', 'extended', 'insurance']

export function CoverageForm({ thingId, id }: { thingId: string; id?: string }) {
  const { t } = useTranslation()
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const thing = d.thingById.get(thingId)
  const existing = id ? d.coverages.find((c) => c.id === id) : undefined
  const [f, setF] = useState(() => ({
    type: (existing?.type ?? (d.coveragesFor(thingId).length ? 'extended' : 'warranty')) as CoverageType,
    name: existing?.name ?? '',
    provider: existing?.provider ?? '',
    startDate: existing?.startDate ?? thing?.purchaseDate ?? today(),
    endDate: existing?.endDate ?? '',
    cost: existing?.cost != null ? String(existing.cost) : '',
    notes: existing?.notes ?? '',
  }))
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const defaultName = t(`planForm.coverage.name.${f.type}`)
  const valid = !!f.endDate
  const endAfter = (years: number) => dayjs(f.startDate || today()).add(years, 'year').format(DAY)

  const save = async () => {
    if (!valid) return
    await saveCoverage({
      thingId,
      type: f.type,
      name: f.name.trim() || defaultName,
      provider: f.provider.trim() || undefined,
      startDate: f.startDate || undefined,
      endDate: f.endDate,
      cost: num(f.cost),
      notes: f.notes.trim() || undefined,
    }, existing?.id)
    ui.close()
  }

  return (
    <Sheet
      title={existing ? t('planForm.coverage.editTitle') : t('planForm.coverage.addTitle')} subtitle={thing?.name} onClose={ui.close}
      footer={<>
        {existing && <button type="button" className="btn-ghost mr-auto hover:!text-bad" onClick={() => { void deleteCoverage(existing.id); ui.close() }}><Trash2 size={15} /> {t('common.delete')}</button>}
        <button type="button" className="btn-ghost" onClick={ui.close}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>{existing ? t('common.save') : t('planForm.coverage.add')}</button>
      </>}
    >
      <div className="space-y-5">
        <Segmented value={f.type} onChange={(v) => set('type', v)} options={COVERAGE_TYPES.map((type) => ({ id: type, label: t(`planForm.coverage.type.${type}`) }))} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('planForm.name')} className="col-span-2"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={defaultName} /></Field>
          <Field label={t('planForm.provider')}><input className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)} placeholder={thing?.brand ?? t('planForm.coverage.providerPlaceholder')} /></Field>
          <Field label={t('planForm.coverage.cost', { currency })}><input className="input num" inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} placeholder="0" /></Field>
          <Field label={t('planForm.coverage.starts')}><input type="date" className="input" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label={t('planForm.coverage.ends')}><input type="date" className="input" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
        </div>
        <div>
          <span className="label mb-1.5 block">{t('planForm.coverage.pickLength')}</span>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 5].map((y) => {
              const end = endAfter(y)
              return (
                <button key={y} type="button" onClick={() => set('endDate', end)}
                  className={cx('h-8 rounded-full border px-3 text-[13px] font-medium transition', f.endDate === end ? 'border-ok/40 bg-ok/15 text-ok' : 'border-line/10 bg-bg/40 text-dim hover:text-ink')}>
                  {t('planForm.coverage.years', { count: y })}
                </button>
              )
            })}
          </div>
        </div>
        <Field label={t('planForm.notes')}><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t('planForm.coverage.notesPlaceholder')} /></Field>
      </div>
    </Sheet>
  )
}
