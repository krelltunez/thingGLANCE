import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ExternalLink, Plus, Search, Send, X } from 'lucide-react'
import { categoryLabel } from '@/core/categories'
import { fmtDay } from '@/core/dates'
import { verdictLabel } from '@/core/health'
import { EVENT_META } from '@/core/horizon'
import { formatLink } from '@/core/links'
import { money } from '@/core/money'
import type { GlanceSnapshot, SnapshotEvent, SnapshotThing } from '@/core/snapshot'
import type { CategoryId } from '@/core/types'
import type { DesktopTray, DesktopTrayState } from '@/native/desktop'
import { EVENT_ICONS } from '@/components/icons'
import { TONES, cx, severityTone, verdictTone } from '@/components/kit'
import { Chip, TBadge, Wordmark } from '@/components/ui'
import { searchThings } from './search'

// The desktop tray popup (docs/desktop.md, "The tray"): a widget, drawn with
// the app's own pieces. It renders what the main process holds of the payload
// the main window pushed, and never opens the database or runs sync. "Done"
// and "Send to dayGLANCE" queue a write for the main window to apply
// (electron/commandQueue.ts); main hides or marks the date at once and the
// next snapshot confirms it.
//
// The search field searches every thing, live as you type (./search.ts). It
// has the cursor whenever the popup opens; Enter opens the first result in the
// app. Escape clears the search, then closes the popup.

const COMING_UP = 5
// The snapshot carries a category as its id; an id this build does not know reads as "other".
const categoryName = (id: string): string => categoryLabel(id as CategoryId)

function EventRow({ event, currency, canSend, tray }: { event: SnapshotEvent; currency: string; canSend: boolean; tray: DesktopTray }) {
  const { t } = useTranslation()
  const Icon = EVENT_ICONS[event.type]
  const sent = event.state === 'sent'
  return (
    <div className="group flex items-center gap-2.5 rounded-xl border border-line/10 bg-raised/40 px-2.5 py-2 transition hover:border-line/25 hover:bg-raised/70">
      <TBadge days={event.days} tone={severityTone(event.severity)} />
      <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border', TONES[EVENT_META[event.type].tone].soft)}><Icon size={14} /></span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => tray.open(event.link)}>
        <span className="block truncate text-sm font-medium text-ink">{event.title}</span>
        <span className="block truncate text-xs text-dim">
          {event.detail} · {fmtDay(event.date, 'MMM D')}
          {event.amount != null && event.type !== 'replace' && <> · <span className="num">{money(event.amount, currency)}</span></>}
        </span>
      </button>
      {sent && <Chip tone="accent" icon={Send}>{t('parts.inDayglance')}</Chip>}
      {!sent && canSend && (
        <button type="button" className="icon-btn h-8 w-8" title={t('parts.sendToDayglance')} aria-label={t('parts.sendToDayglance')} onClick={() => tray.send(event.key)}><Send size={14} /></button>
      )}
      <button type="button" className="icon-btn h-8 w-8 hover:!border-ok/40 hover:!text-ok" title={t('parts.doneWithThis')} aria-label={t('parts.doneWithThis')} onClick={() => tray.decide(event.key)}><Check size={15} /></button>
    </div>
  )
}

function ThingRow({ thing, tray, first }: { thing: SnapshotThing; tray: DesktopTray; first: boolean }) {
  return (
    <button
      type="button" data-first={first || undefined}
      className="flex w-full items-center gap-2.5 rounded-xl border border-line/10 bg-raised/40 px-2.5 py-2 text-left transition hover:border-line/25 hover:bg-raised/70"
      onClick={() => tray.open(formatLink({ kind: 'thing', id: thing.id }))}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{thing.name}</span>
        <span className="block truncate text-xs text-dim">{categoryName(thing.category)}{thing.lifeEnd ? ` · ${fmtDay(thing.lifeEnd, 'MMM D, YYYY')}` : ''}</span>
      </span>
      <Chip tone={verdictTone(thing.verdict)}>{verdictLabel(thing.verdict)}</Chip>
    </button>
  )
}

export function TrayPopup({ tray }: { tray: DesktopTray }) {
  const { t } = useTranslation()
  const [state, setState] = useState<DesktopTrayState | null>(null)
  const [query, setQuery] = useState('')
  const queryRef = useRef('')
  queryRef.current = query
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let live = true
    tray.state().then((s) => { if (live && s) setState(s) }).catch(() => {})
    const off = tray.onState((s) => setState(s as DesktopTrayState))
    // Each opening starts on an empty search with the cursor in it.
    const offShown = tray.onShown(() => { setQuery(''); searchRef.current?.focus() })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (queryRef.current) setQuery('')
      else tray.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => { live = false; off(); offShown(); window.removeEventListener('keydown', onKey) }
  }, [tray])

  const snapshot = (state?.ready ? state.payload?.snapshot : null) as GlanceSnapshot | null
  const canSend = state?.payload?.canSend === true
  const results = snapshot && query.trim() ? searchThings(snapshot.things, query, categoryName) : null
  const waiting = snapshot?.counts.attention ?? 0
  const queued = new Set(snapshot?.attention.map((e) => e.key))
  const comingUp = snapshot ? snapshot.upcoming.filter((e) => !queued.has(e.key) && e.state === 'open').slice(0, COMING_UP) : []

  return (
    <div className="app-bg flex h-screen flex-col overflow-hidden text-ink">
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <button type="button" className="mr-auto leading-none" onClick={() => tray.open(null)} aria-label={t('desktop.tray.open')}>
          <Wordmark className="text-xl" />
        </button>
        <button type="button" className="icon-btn h-8 w-8" title={t('widget.add')} aria-label={t('widget.add')} onClick={() => tray.open(formatLink({ kind: 'add', what: 'thing' }))}><Plus size={15} /></button>
        <button type="button" className="icon-btn h-8 w-8" title={t('desktop.tray.open')} aria-label={t('desktop.tray.open')} onClick={() => tray.open(null)}><ExternalLink size={14} /></button>
      </header>

      {snapshot && (
        <div className="relative px-4 pb-2">
          <Search size={14} className="pointer-events-none absolute left-7 top-1/2 -translate-y-[calc(50%+4px)] text-faint" />
          <input
            ref={searchRef} autoFocus className="input w-full !pl-9 !pr-9" value={query} placeholder={t('desktop.tray.search')} aria-label={t('desktop.tray.search')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && results?.length) tray.open(formatLink({ kind: 'thing', id: results[0].id })) }}
          />
          {query && (
            <button type="button" className="absolute right-6 top-1/2 -translate-y-[calc(50%+4px)] text-faint hover:text-ink" aria-label={t('desktop.tray.clearSearch')} onClick={() => { setQuery(''); searchRef.current?.focus() }}><X size={14} /></button>
          )}
        </div>
      )}

      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4">
        {!snapshot && (
          <div className="pt-16 text-center">
            <p className="text-sm text-dim">{t('desktop.tray.notReady')}</p>
            <button type="button" className="btn-primary mt-4" onClick={() => tray.open(null)}>{t('desktop.tray.open')}</button>
          </div>
        )}

        {results && (
          <section className="space-y-1.5">
            {results.length === 0 && <p className="pt-6 text-center text-sm text-dim">{t('desktop.tray.noMatches')}</p>}
            {results.map((thing, i) => <ThingRow key={thing.id} thing={thing} tray={tray} first={i === 0} />)}
          </section>
        )}

        {snapshot && !results && (
          <>
            <p className="pt-1 text-[15px] font-semibold leading-snug text-ink">
              {waiting > 0 ? t('glance.headline.decide', { count: waiting }) : t('desktop.tray.allClear')}
            </p>

            {snapshot.attention.length > 0 && (
              <section>
                <h2 className="label mb-2">{t('widget.decide.title')}</h2>
                <div className="space-y-1.5">
                  {snapshot.attention.map((e) => <EventRow key={e.key} event={e} currency={snapshot.currency} canSend={canSend} tray={tray} />)}
                </div>
              </section>
            )}

            {comingUp.length > 0 && (
              <section>
                <h2 className="label mb-2">{t('desktop.tray.comingUp')}</h2>
                <div className="space-y-1">
                  {comingUp.map((e) => (
                    <button key={e.key} type="button" className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left hover:bg-raised/60" onClick={() => tray.open(e.link)}>
                      <TBadge days={e.days} tone={severityTone(e.severity)} />
                      <span className="min-w-0 flex-1 truncate text-xs text-dim"><span className="text-ink">{e.title}</span> · {e.detail}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {snapshot.charges.count > 0 && (
              <p className="text-xs text-dim">{t('desktop.tray.charges', { amount: money(snapshot.charges.total, snapshot.currency), days: snapshot.charges.days })}</p>
            )}
          </>
        )}
      </main>
    </div>
  )
}
