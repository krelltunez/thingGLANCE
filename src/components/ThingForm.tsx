import { useEffect, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { Check, Globe, LoaderCircle, ScanSearch, Search, X } from 'lucide-react'
import type { CategoryId, Spec, Thing } from '@/core/types'
import { CATEGORIES, category, categoryLabel } from '@/core/categories'
import { DAY, fmtDay, today } from '@/core/dates'
import { createThing, saveCoverage, updateThing, type ThingInput } from '@/db/queries'
import { findSupport, lookupProduct, searchWikipedia, type LookupResult, type SearchHit, type SupportInfo } from '@/lookup'
import { useData } from '@/state/data'
import { useSettings } from '@/state/settings'
import { toast } from '@/state/toast'
import { useUI } from '@/state/ui'
import { Chip, Field, Sheet } from './ui'
import { cx, num, whoFields, type WhoDraft } from './kit'
import { HouseholdFields } from './HouseholdFields'
import { categoryIcon } from './icons'

interface Draft {
  name: string
  category: CategoryId
  brand: string
  model: string
  purchaseDate: string
  price: string
  retailer: string
  lifespanYears: string
  supportEnd: string
  supportBasis: Thing['supportBasis']
  who: WhoDraft
  notes: string
  resaleValue: string
  // Carried from the web lookup, not typed.
  releaseDate?: string
  specs?: Spec[]
  imageUrl?: string
  summary?: string
  sourceUrl?: string
  eolProduct?: string
  eolRelease?: string
}

// A new thing belongs to the household until told otherwise, and whoever adds
// it is the one who deals with it.
const fromThing = (t: Thing | undefined, cat: CategoryId | undefined, meId: string | null): Draft => ({
  name: t?.name ?? '',
  category: t?.category ?? cat ?? 'phone',
  brand: t?.brand ?? '',
  model: t?.model ?? '',
  purchaseDate: t?.purchaseDate ?? '',
  price: t?.price != null ? String(t.price) : '',
  retailer: t?.retailer ?? '',
  lifespanYears: t?.lifespanMonths ? String(+(t.lifespanMonths / 12).toFixed(1)) : '',
  supportEnd: t?.supportEnd ?? '',
  supportBasis: t?.supportBasis,
  who: t
    ? { holder: t.ownerMemberId ?? '', responsible: t.responsibleMemberId ?? '', isPrivate: t.visibility === 'private' }
    : { holder: '', responsible: meId ?? '', isPrivate: false },
  notes: t?.notes ?? '',
  resaleValue: t?.resaleValue != null ? String(t.resaleValue) : '',
  releaseDate: t?.releaseDate,
  specs: t?.specs,
  imageUrl: t?.imageUrl,
  summary: t?.summary,
  sourceUrl: t?.sourceUrl,
  eolProduct: t?.eolProduct,
  eolRelease: t?.eolRelease,
})

// What went wrong with a lookup. Held as a code, put into words where it is shown.
type LookupError = 'noMatches' | 'unavailable' | 'loadFailed'

// "Find it on the web": type a product, pick a match, and the form fills in.
function Lookup({ onResult }: { onResult: (r: LookupResult) => void }) {
  const { t } = useTranslation()
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState<'search' | 'load' | null>(null)
  const [result, setResult] = useState<LookupResult | null>(null)
  const [error, setError] = useState<LookupError | null>(null)
  const picked = useRef(false)

  useEffect(() => {
    if (picked.current) { picked.current = false; return }
    if (q.trim().length < 3) { setHits([]); return }
    const ctl = new AbortController()
    const timer = setTimeout(() => {
      setBusy('search')
      searchWikipedia(q, ctl.signal)
        .then((h) => { setHits(h); setError(h.length ? null : 'noMatches') })
        .catch((e) => { if ((e as Error).name !== 'AbortError') setError('unavailable') })
        .finally(() => setBusy((b) => (b === 'search' ? null : b)))
    }, 280)
    return () => { clearTimeout(timer); ctl.abort() }
  }, [q])

  const pick = async (hit: SearchHit) => {
    const typed = q
    picked.current = true
    setHits([])
    setQ(hit.title)
    setBusy('load')
    setError(null)
    try {
      const r = await lookupProduct(hit.title, typed)
      setResult(r)
      onResult(r)
    } catch {
      setError('loadFailed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-accent/25 bg-accent/[0.06] p-3">
      <p className="label mb-2 flex items-center gap-1.5 !text-accent"><Globe size={11} /> {t('thingForm.lookup.heading')}</p>
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input className="input pl-9 pr-9" placeholder={t('thingForm.lookup.placeholder')} value={q} autoFocus
          onChange={(e) => { setQ(e.target.value); setResult(null) }} />
        {busy && <LoaderCircle size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-accent" />}
        {!busy && q && <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-faint hover:text-ink" onClick={() => { setQ(''); setHits([]); setResult(null); setError(null) }}><X size={14} /></button>}
      </div>
      {hits.length > 0 && (
        <ul className="mt-2 overflow-hidden rounded-lg border border-line/10 bg-panel">
          {hits.map((h) => (
            <li key={h.title}>
              <button type="button" onClick={() => void pick(h)} className="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-accent/10">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white">
                  {h.thumbnail ? <img src={h.thumbnail} alt="" className="h-full w-full object-contain p-0.5" /> : <ScanSearch size={15} className="text-slate-400" />}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">{h.title}</span>
                  {h.description && <span className="block truncate text-xs text-dim">{h.description}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {result && (
        <div className="mt-2.5 flex animate-rise items-start gap-3">
          {result.imageUrl && <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white"><img src={result.imageUrl} alt="" className="h-full w-full object-contain p-1" /></span>}
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium text-ink"><Check size={14} className="text-ok" /> {result.support ? t('thingForm.lookup.filledFromBoth') : t('thingForm.lookup.filledFromWikipedia')}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {result.specs.length > 0 && <Chip tone="accent">{t('thingForm.lookup.specs', { count: result.specs.length })}</Chip>}
              {result.releaseDate && <Chip tone="dim">{t('thingForm.lookup.released', { date: fmtDay(result.releaseDate, 'MMM YYYY') })}</Chip>}
              {result.support?.supportEnd && <Chip tone={result.support.ended ? 'bad' : 'ok'}>{result.support.basis === 'estimate' ? t('thingForm.lookup.updatesAbout', { date: fmtDay(result.support.supportEnd, 'MMM YYYY') }) : t('thingForm.lookup.updatesUntil', { date: fmtDay(result.support.supportEnd, 'MMM YYYY') })}</Chip>}
            </div>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-dim">{t(`thingForm.lookup.error.${error}`)}</p>}
      {!result && !error && hits.length === 0 && <p className="mt-2 text-xs leading-relaxed text-faint">{t('thingForm.lookup.about')}</p>}
    </div>
  )
}

export function ThingForm({ id, initialCategory, initialName }: { id?: string; initialCategory?: CategoryId; initialName?: string }) {
  const { t } = useTranslation()
  const d = useData()
  const ui = useUI()
  const { webLookup, currency } = useSettings()
  const existing = id ? d.thingById.get(id) : undefined
  const [f, setF] = useState<Draft>(() => {
    const draft = fromThing(existing, initialCategory, d.meId)
    return !existing && initialName ? { ...draft, name: initialName } : draft
  })
  const [warrantyYears, setWarrantyYears] = useState(1)
  const [supportNote, setSupportNote] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((p) => ({ ...p, [k]: v }))
  const cat = category(f.category)

  const applySupport = (s: SupportInfo | null) => {
    if (!s) { setSupportNote(t('thingForm.support.notFound')); return }
    setSupportNote(s.note)
    setF((p) => ({
      ...p,
      supportEnd: s.supportEnd ?? p.supportEnd,
      supportBasis: s.supportEnd ? s.basis : p.supportBasis,
      releaseDate: s.releaseDate ?? p.releaseDate,
      eolProduct: s.product,
      eolRelease: s.release,
    }))
  }

  const applyLookup = (r: LookupResult) => {
    setF((p) => ({
      ...p,
      name: r.name,
      brand: p.brand || r.brand || '',
      category: r.category ?? p.category,
      releaseDate: r.releaseDate ?? p.releaseDate,
      specs: r.specs.length ? r.specs : p.specs,
      imageUrl: r.imageUrl ?? p.imageUrl,
      summary: r.summary ?? p.summary,
      sourceUrl: r.sourceUrl ?? p.sourceUrl,
    }))
    if (r.support) applySupport(r.support)
  }

  const checkSupport = async () => {
    setChecking(true)
    try { applySupport(await findSupport(f.name)) }
    catch { setSupportNote(t('thingForm.support.unreachable')) }
    finally { setChecking(false) }
  }

  const save = async () => {
    if (!f.name.trim() || saving) return
    setSaving(true)
    const years = num(f.lifespanYears)
    const who = whoFields(f.who)
    const input: ThingInput = {
      name: f.name.trim(),
      category: f.category,
      brand: f.brand.trim() || undefined,
      model: f.model.trim() || undefined,
      purchaseDate: f.purchaseDate || undefined,
      price: num(f.price),
      retailer: f.retailer.trim() || undefined,
      releaseDate: f.releaseDate,
      supportEnd: f.supportEnd || undefined,
      supportBasis: f.supportEnd ? f.supportBasis ?? 'manual' : undefined,
      lifespanMonths: years ? Math.round(years * 12) : undefined,
      status: existing?.status ?? 'active',
      retiredAt: existing?.retiredAt,
      resaleValue: existing?.status === 'retired' ? num(f.resaleValue) : undefined,
      ownerMemberId: who.holder,
      responsibleMemberId: who.responsibleMemberId,
      visibility: who.visibility,
      notes: f.notes.trim() || undefined,
      specs: f.specs,
      imageUrl: f.imageUrl,
      summary: f.summary,
      sourceUrl: f.sourceUrl,
      eolProduct: f.eolProduct,
      eolRelease: f.eolRelease,
      pinned: existing?.pinned,
    }
    try {
      if (existing) {
        await updateThing(existing.id, input)
        ui.close()
      } else {
        const thing = await createThing(input)
        if (warrantyYears > 0 && f.purchaseDate) {
          await saveCoverage({
            thingId: thing.id, type: 'warranty', name: t('planForm.coverage.name.warranty'), provider: input.brand,
            startDate: f.purchaseDate, endDate: dayjs(f.purchaseDate).add(warrantyYears, 'year').format(DAY),
          })
        }
        ui.close()
        ui.openThing(thing.id)
        toast({ title: t('thingForm.added', { name: thing.name }), tone: 'ok' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      title={existing ? t('thingForm.editTitle', { name: existing.name }) : t('thingForm.addTitle')}
      subtitle={existing ? undefined : t('thingForm.subtitle')}
      onClose={ui.close} width="max-w-xl"
      footer={<>
        <button type="button" className="btn-ghost" onClick={ui.close}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary" disabled={!f.name.trim() || saving} onClick={() => void save()}>{existing ? t('common.save') : t('thingForm.add')}</button>
      </>}
    >
      <div className="space-y-5">
        {webLookup && !existing && <Lookup onResult={applyLookup} />}

        <Field label={t('thingForm.name')}>
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={t('thingForm.namePlaceholder')} autoFocus={!webLookup || !!existing} />
        </Field>

        <div>
          <span className="label mb-1.5 block">{t('thingForm.kind')}</span>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9">
            {CATEGORIES.map((c) => {
              const Icon = categoryIcon(c.id)
              return (
                <button key={c.id} type="button" title={categoryLabel(c.id)} onClick={() => set('category', c.id)}
                  className={cx('flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border transition',
                    f.category === c.id ? 'border-accent/50 bg-accent/15 text-accent' : 'border-line/10 bg-bg/40 text-dim hover:border-line/25 hover:text-ink')}>
                  <Icon size={17} strokeWidth={1.7} />
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-faint">{t('thingForm.kindHint', { kind: categoryLabel(f.category), count: +(cat.lifespanMonths / 12).toFixed(1) })}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t('thingForm.brand')}><input className="input" value={f.brand} onChange={(e) => set('brand', e.target.value)} placeholder={t('thingForm.brandPlaceholder')} /></Field>
          <Field label={t('thingForm.model')}><input className="input" value={f.model} onChange={(e) => set('model', e.target.value)} placeholder={t('thingForm.modelPlaceholder')} /></Field>
          <Field label={t('thingForm.boughtOn')}><input type="date" className="input" value={f.purchaseDate} max={today()} onChange={(e) => set('purchaseDate', e.target.value)} /></Field>
          <Field label={t('thingForm.price', { currency })}><input className="input num" inputMode="decimal" value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="0" /></Field>
          <Field label={t('thingForm.boughtFrom')}><input className="input" value={f.retailer} onChange={(e) => set('retailer', e.target.value)} placeholder={t('thingForm.boughtFromPlaceholder')} /></Field>
          <Field label={t('thingForm.keepFor')} hint={t('thingForm.keepForHint')}>
            <input className="input num" inputMode="decimal" value={f.lifespanYears} onChange={(e) => set('lifespanYears', e.target.value)} placeholder={String(+(cat.lifespanMonths / 12).toFixed(1))} />
          </Field>
        </div>

        <div>
          <span className="label mb-1.5 block">{t('thingForm.support.label')}</span>
          <div className="flex gap-2">
            <input type="date" className="input" value={f.supportEnd} onChange={(e) => { set('supportEnd', e.target.value); set('supportBasis', 'manual') }} />
            {webLookup && (
              <button type="button" className="btn h-10 shrink-0" disabled={!f.name.trim() || checking} onClick={() => void checkSupport()}>
                {checking ? <LoaderCircle size={15} className="animate-spin" /> : <ScanSearch size={15} />} {t('thingForm.support.lookUp')}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-faint">
            {supportNote ?? (f.supportEnd && f.supportBasis === 'estimate' ? t('thingForm.support.estimateHint') : t('thingForm.support.hint'))}
          </p>
        </div>

        {!existing && (
          <div>
            <span className="label mb-1.5 block">{t('thingForm.warranty.label')}</span>
            <div className="flex flex-wrap gap-1.5">
              {[0, 1, 2, 3].map((y) => (
                <button key={y} type="button" onClick={() => setWarrantyYears(y)}
                  className={cx('h-8 rounded-full border px-3 text-[13px] font-medium transition', warrantyYears === y ? 'border-ok/40 bg-ok/15 text-ok' : 'border-line/10 bg-bg/40 text-dim hover:text-ink')}>
                  {y === 0 ? t('thingForm.warranty.none') : t('thingForm.warranty.years', { count: y })}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-faint">{f.purchaseDate ? t('thingForm.warranty.fromPurchase') : t('thingForm.warranty.needsDate')}</p>
          </div>
        )}

        {existing?.status === 'retired' && (
          <Field label={t('thingForm.soldFor', { currency })}><input className="input num" inputMode="decimal" value={f.resaleValue} onChange={(e) => set('resaleValue', e.target.value)} placeholder="0" /></Field>
        )}

        <HouseholdFields
          value={f.who} onChange={(who) => set('who', who)} noun="thing" holderLabel={t('thingForm.holderLabel')}
          holderHint={existing && (existing.ownerMemberId ?? '') !== f.who.holder ? t('thingForm.handOverHint') : undefined}
        />

        <Field label={t('thingForm.notes')}>
          <textarea className="input" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder={t('thingForm.notesPlaceholder')} />
        </Field>
      </div>
    </Sheet>
  )
}
