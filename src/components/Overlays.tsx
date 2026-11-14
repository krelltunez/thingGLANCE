// Passphrase prompt, command palette and first-run welcome.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  ArrowRight, Cloud, CornerDownLeft, LayoutDashboard, Lock, LoaderCircle, Moon, Package, Plus, RefreshCw,
  Repeat, Search, Settings as SettingsIcon, ShieldCheck, Sparkles, Telescope, type LucideIcon,
} from 'lucide-react'
import { cycleShort, money } from '@/core/money'
import { loadSamples } from '@/db/demo'
import { submitPassphrase, syncNow } from '@/sync/manager'
import { useData } from '@/state/data'
import { useSync } from '@/state/sync'
import { updateSettings, useSettings } from '@/state/settings'
import { useUI } from '@/state/ui'
import { markWelcomed } from '@/state/welcome'
import { categoryIcon } from './icons'
import { Field, Sheet, Wordmark } from './ui'
import { cx, useEscape } from './kit'

export function PassphraseModal() {
  const { t } = useTranslation()
  const ui = useUI()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sync = useSync()

  const submit = async () => {
    if (!value || busy) return
    setBusy(true); setError(null)
    const err = await submitPassphrase(value)
    setBusy(false)
    if (err) setError(err)
    else ui.close()
  }

  return (
    <Sheet title={t('overlays.passphrase.title')} subtitle={t('overlays.passphrase.subtitle')} onClose={ui.close} width="max-w-md"
      footer={<>
        <button type="button" className="btn-ghost" onClick={ui.close}>{t('overlays.passphrase.notNow')}</button>
        <button type="button" className="btn-primary" disabled={!value || busy} onClick={() => void submit()}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Lock size={15} />} {t('overlays.passphrase.unlock')}</button>
      </>}
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        {sync.keyConflict && (
          <p className="rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">
            {t('overlays.passphrase.conflict')}
          </p>
        )}
        <p className="text-sm leading-relaxed text-dim">
          <Trans i18nKey="overlays.passphrase.explain" components={{ b: <span className="text-ink" /> }} />
        </p>
        <Field label={t('overlays.passphrase.label')}>
          <input className="input" type="password" autoFocus autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">{error}</p>}
        <p className="text-xs leading-relaxed text-faint">{t('overlays.passphrase.neverSent')}</p>
      </form>
    </Sheet>
  )
}

// `group` is an id: the heading shown for it comes from the catalog.
type CommandGroup = 'actions' | 'goto' | 'things' | 'plans'
interface Command { id: string; label: string; hint?: string; icon: LucideIcon; run: () => void; group: CommandGroup }

export function CommandPalette({ initialQuery = '' }: { initialQuery?: string }) {
  const { t } = useTranslation()
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const [q, setQ] = useState(initialQuery)
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEscape(ui.close)

  const commands = useMemo<Command[]>(() => {
    const go = (fn: () => void) => () => { ui.close(); fn() }
    const base: Command[] = [
      { id: 'add-thing', group: 'actions', label: t('overlays.palette.addThing'), icon: Plus, run: () => ui.open({ type: 'thing' }) },
      { id: 'add-plan', group: 'actions', label: t('overlays.palette.addPlan'), icon: Plus, run: () => ui.open({ type: 'subscription' }) },
      { id: 'v-glance', group: 'goto', label: t('overlays.palette.glance'), icon: LayoutDashboard, run: go(() => ui.setView('glance')) },
      { id: 'v-horizon', group: 'goto', label: t('overlays.palette.horizon'), icon: Telescope, run: go(() => ui.setView('horizon')) },
      { id: 'v-things', group: 'goto', label: t('overlays.palette.things'), icon: Package, run: go(() => ui.setView('things')) },
      { id: 'v-plans', group: 'goto', label: t('overlays.palette.plans'), icon: Repeat, run: go(() => ui.setView('plans')) },
      { id: 'sync', group: 'actions', label: t('overlays.palette.syncNow'), icon: RefreshCw, run: go(() => void syncNow()) },
      { id: 'theme', group: 'actions', label: t('overlays.palette.switchTheme'), icon: Moon, run: go(() => updateSettings({ theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark' })) },
      { id: 'settings', group: 'actions', label: t('overlays.palette.settings'), icon: SettingsIcon, run: () => ui.open({ type: 'settings' }) },
      { id: 'vault', group: 'actions', label: t('overlays.palette.vaultSettings'), icon: Cloud, run: () => ui.open({ type: 'settings', section: 'vault' }) },
    ]
    const things: Command[] = d.visibleThings.map((thing) => ({
      id: `t-${thing.id}`, group: 'things', label: thing.name, hint: [thing.brand, thing.model].filter(Boolean).join(' · '), icon: categoryIcon(thing.category),
      run: go(() => ui.openThing(thing.id)),
    }))
    const plans: Command[] = d.visibleSubs.map((s) => ({
      id: `s-${s.id}`, group: 'plans', label: s.name, hint: `${money(s.amount, currency)}/${cycleShort(s.cycle)}`, icon: Repeat,
      run: () => ui.open({ type: 'subscription', id: s.id }),
    }))
    const all = [...base, ...things, ...plans]
    const needle = q.trim().toLowerCase()
    if (!needle) return [...base.slice(0, 6), ...things.slice(0, 6)]
    return all.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(needle)).slice(0, 14)
  }, [q, d.visibleThings, d.visibleSubs, ui, currency, t])

  useEffect(() => { listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [index])

  // The highlight follows the keyboard, and the pointer only once it actually
  // moves: a pointer that happens to be resting where the list opens must not
  // pick a row, or Enter runs something the user never chose. The query and
  // the highlight change together so a fast Enter never sees one without the
  // other.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(commands.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); commands[index]?.run() }
  }

  let lastGroup: CommandGroup | null = null
  return (
    <div className="fixed inset-0 z-60 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={ui.close} />
      <div className="panel hud relative w-full max-w-xl animate-pop overflow-hidden !bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line/10 px-4">
          <Search size={17} className="text-accent" />
          <input className="h-12 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none" autoFocus placeholder={t('overlays.palette.placeholder')} value={q} onChange={(e) => { setQ(e.target.value); setIndex(0) }} onKeyDown={onKey} />
          {/* eslint-disable-next-line i18next/no-literal-string -- the name of a key */}
          <kbd className="label rounded border border-line/15 px-1.5 py-0.5">esc</kbd>
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2">
          {commands.length === 0 && <p className="px-3 py-6 text-center text-sm text-dim">{t('overlays.palette.nothing', { q })}</p>}
          {commands.map((c, i) => {
            const header = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {header && <p className="label px-3 pb-1 pt-2">{t(`overlays.palette.group.${c.group}`)}</p>}
                <button type="button" data-active={i === index} onMouseMove={() => { if (i !== index) setIndex(i) }} onClick={c.run}
                  className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition', i === index ? 'bg-accent/15' : '')}>
                  <c.icon size={16} className={i === index ? 'text-accent' : 'text-faint'} />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{c.label}</span>
                  {c.hint && <span className="num truncate text-xs text-faint">{c.hint}</span>}
                  {i === index && <CornerDownLeft size={13} className="text-accent" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export function Welcome({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const ui = useUI()
  const [busy, setBusy] = useState(false)
  const finish = () => { markWelcomed(); onDone() }
  const points: { id: string; icon: LucideIcon; title: string; body: string }[] = [
    { id: 'coverage', icon: ShieldCheck, title: t('overlays.welcome.coverage.title'), body: t('overlays.welcome.coverage.body') },
    { id: 'plans', icon: Repeat, title: t('overlays.welcome.plans.title'), body: t('overlays.welcome.plans.body') },
    { id: 'shelfLife', icon: Telescope, title: t('overlays.welcome.shelfLife.title'), body: t('overlays.welcome.shelfLife.body') },
  ]
  return (
    <div className="app-bg fixed inset-0 z-50 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-12">
        <div className="animate-rise">
          <Wordmark className="text-4xl sm:text-5xl" />
          <p className="mt-3 text-lg text-dim">{t('overlays.welcome.tagline')}</p>
        </div>
        <div className="stagger mt-10 space-y-3">
          {points.map((p, i) => (
            <div key={p.id} style={{ '--i': i + 2 } as React.CSSProperties} className="panel flex items-start gap-4 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/10 text-accent"><p.icon size={19} /></span>
              <div>
                <p className="text-[15px] font-semibold text-ink">{p.title}</p>
                <p className="text-sm leading-relaxed text-dim">{p.body}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-10 flex animate-rise flex-col gap-2.5 whitespace-nowrap sm:flex-row sm:flex-wrap" style={{ animationDelay: '260ms' }}>
          <button type="button" className="btn-primary h-11 px-5" disabled={busy} onClick={() => { setBusy(true); void loadSamples().then(finish) }}>
            <Sparkles size={16} /> {t('overlays.welcome.explore')}
          </button>
          <button type="button" className="btn h-11 px-5" onClick={() => { finish(); ui.open({ type: 'thing' }) }}>{t('overlays.welcome.addFirst')} <ArrowRight size={15} /></button>
          <button type="button" className="btn-ghost h-11" onClick={() => { finish(); ui.open({ type: 'settings', section: 'vault' }) }}><Cloud size={15} /> {t('overlays.welcome.alreadySync')}</button>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-faint">{t('overlays.welcome.footnote')}</p>
      </div>
    </div>
  )
}
