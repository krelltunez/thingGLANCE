// The two small forms: a subscription ("plan") and a coverage.

import { useState } from 'react'
import dayjs from 'dayjs'
import { Trash2, X } from 'lucide-react'
import type { CoverageType, Cycle, Subscription } from '@/core/types'
import { DAY, today } from '@/core/dates'
import { CYCLES } from '@/core/money'
import { deleteCoverage, deleteSubscription, saveCoverage, saveSubscription } from '@/db/queries'
import { useData } from '@/state/data'
import { useSettings } from '@/state/settings'
import { toast } from '@/state/toast'
import { useUI } from '@/state/ui'
import { Field, Segmented, Sheet, Toggle } from './ui'
import { cx, num, whoFields, type WhoDraft } from './kit'
import { HouseholdFields, MembersPicker } from './HouseholdFields'

export function SubscriptionForm({ id, thingId }: { id?: string; thingId?: string }) {
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const existing = id ? d.subById.get(id) : undefined
  const [f, setF] = useState(() => ({
    name: existing?.name ?? '',
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

  const attached = f.thingIds.map((tid) => d.thingById.get(tid)).filter((t) => !!t)
  const attachable = d.things.filter((t) => t.status === 'active' && !f.thingIds.includes(t.id))

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
    if (!existing) toast({ title: `${f.name.trim()} added`, tone: 'ok' })
  }

  return (
    <Sheet
      title={existing ? `Edit ${existing.name}` : 'Add a plan'}
      subtitle={existing ? undefined : 'Anything that renews: storage, phone plans, protection, software.'}
      onClose={ui.close}
      footer={<>
        {existing && <button type="button" className="btn-ghost mr-auto hover:!text-bad" onClick={() => { void deleteSubscription(existing.id); ui.close(); toast({ title: `${existing.name} deleted` }) }}><Trash2 size={15} /> Delete</button>}
        <button type="button" className="btn-ghost" onClick={ui.close}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>{existing ? 'Save' : 'Add plan'}</button>
      </>}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><input className="input" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="iCloud+ 2 TB" /></Field>
          <Field label="Provider"><input className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)} placeholder="Apple" /></Field>
          <Field label={`Amount (${currency})`}><input className="input num" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="9.99" /></Field>
        </div>

        <div>
          <span className="label mb-1.5 block">Billed</span>
          <Segmented value={f.cycle} onChange={(v) => set('cycle', v)} options={CYCLES.map((c) => ({ id: c.id, label: c.label }))} />
        </div>

        <div>
          <span className="label mb-1.5 block">Status</span>
          <Segmented value={f.status} onChange={(v) => set('status', v)} options={[{ id: 'active', label: 'Active' }, { id: 'trial', label: 'Free trial' }, { id: 'cancelled', label: 'Cancelled' }]} />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {f.status === 'trial'
            ? <Field label="Trial ends" hint="The day it starts charging."><input type="date" className="input" value={f.trialEnd} onChange={(e) => set('trialEnd', e.target.value)} /></Field>
            : f.status === 'cancelled'
              ? <Field label="Access ends" hint="Optional."><input type="date" className="input" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
              : <Field label="Next renewal" hint="Any renewal date works; it repeats from there."><input type="date" className="input" value={f.anchorDate} onChange={(e) => set('anchorDate', e.target.value)} /></Field>}
          <Field label="Attached to" hint={attached.length > 1 ? 'Its cost is split evenly between them.' : undefined}>
            {attached.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {attached.map((t) => (
                  <span key={t.id} className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-accent/40 bg-accent/15 pl-3 pr-1 text-[13px] font-medium text-accent">
                    <span className="truncate">{t.name}</span>
                    <button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-accent/20" aria-label={`Detach ${t.name}`} onClick={() => set('thingIds', f.thingIds.filter((x) => x !== t.id))}><X size={13} /></button>
                  </span>
                ))}
              </div>
            )}
            {(attachable.length > 0 || attached.length === 0) && (
              <select className="input" aria-label="Attach a thing" value="" onChange={(e) => { if (e.target.value) set('thingIds', [...f.thingIds, e.target.value]) }}>
                <option value="">{attached.length ? 'Attach another…' : 'Nothing (standalone)'}</option>
                {attachable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </Field>
        </div>

        {f.status !== 'cancelled' && (
          <div className="space-y-2 rounded-xl border border-line/10 bg-bg/40 px-3 py-2">
            <Toggle checked={f.autoRenew} onChange={(v) => set('autoRenew', v)} label="Renews automatically" hint="Off means it simply expires on its next date." />
            <Toggle checked={f.review} onChange={(v) => set('review', v)} label="Review before it renews" hint="Puts it in your queue a week ahead. Annual plans ask a month ahead regardless." />
          </div>
        )}

        <HouseholdFields value={f.who} onChange={(who) => set('who', who)} noun="plan" holderLabel="Who pays?" />
        {d.multiUser && d.members.length > 1 && (
          <MembersPicker label="Who is it for?" value={f.coversMemberIds} onChange={(ids) => set('coversMemberIds', ids)} hint="Optional. A family plan covers several people." />
        )}

        <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Where to cancel, which card it is on…" /></Field>
      </div>
    </Sheet>
  )
}

const COVERAGE_TYPES: { id: CoverageType; label: string; name: string }[] = [
  { id: 'warranty', label: 'Warranty', name: 'Manufacturer warranty' },
  { id: 'extended', label: 'Extended plan', name: 'Extended warranty' },
  { id: 'insurance', label: 'Insurance', name: 'Insurance' },
]

export function CoverageForm({ thingId, id }: { thingId: string; id?: string }) {
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
  const defaultName = COVERAGE_TYPES.find((t) => t.id === f.type)!.name
  const valid = !!f.endDate

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
      title={existing ? 'Edit coverage' : 'Add coverage'} subtitle={thing?.name} onClose={ui.close}
      footer={<>
        {existing && <button type="button" className="btn-ghost mr-auto hover:!text-bad" onClick={() => { void deleteCoverage(existing.id); ui.close() }}><Trash2 size={15} /> Delete</button>}
        <button type="button" className="btn-ghost" onClick={ui.close}>Cancel</button>
        <button type="button" className="btn-primary" disabled={!valid} onClick={() => void save()}>{existing ? 'Save' : 'Add coverage'}</button>
      </>}
    >
      <div className="space-y-5">
        <Segmented value={f.type} onChange={(v) => set('type', v)} options={COVERAGE_TYPES.map((t) => ({ id: t.id, label: t.label }))} />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={defaultName} /></Field>
          <Field label="Provider"><input className="input" value={f.provider} onChange={(e) => set('provider', e.target.value)} placeholder={thing?.brand ?? 'Who covers it'} /></Field>
          <Field label={`Cost (${currency})`}><input className="input num" inputMode="decimal" value={f.cost} onChange={(e) => set('cost', e.target.value)} placeholder="0" /></Field>
          <Field label="Starts"><input type="date" className="input" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} /></Field>
          <Field label="Ends"><input type="date" className="input" value={f.endDate} onChange={(e) => set('endDate', e.target.value)} /></Field>
        </div>
        <div>
          <span className="label mb-1.5 block">Or pick a length</span>
          <div className="flex flex-wrap gap-1.5">
            {[1, 2, 3, 5].map((y) => {
              const end = dayjs(f.startDate || today()).add(y, 'year').format(DAY)
              return (
                <button key={y} type="button" onClick={() => set('endDate', end)}
                  className={cx('h-8 rounded-full border px-3 text-[13px] font-medium transition', f.endDate === end ? 'border-ok/40 bg-ok/15 text-ok' : 'border-line/10 bg-bg/40 text-dim hover:text-ink')}>
                  {y} year{y > 1 ? 's' : ''}
                </button>
              )
            })}
          </div>
        </div>
        <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Claim number, what it covers…" /></Field>
      </div>
    </Sheet>
  )
}
