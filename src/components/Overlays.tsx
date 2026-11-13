// Passphrase prompt, command palette and first-run welcome.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight, Cloud, CornerDownLeft, LayoutDashboard, Lock, LoaderCircle, Moon, Package, Plus, RefreshCw,
  Repeat, Search, Settings as SettingsIcon, ShieldCheck, Sparkles, Telescope, type LucideIcon,
} from 'lucide-react'
import { cycleShort, money } from '@/core/money'
import { loadSamples } from '@/db/demo'
import { submitPassphrase, syncNow } from '@/sync/manager'
import { useData } from '@/state/data'
import { updateSettings, useSettings } from '@/state/settings'
import { useUI } from '@/state/ui'
import { markWelcomed } from '@/state/welcome'
import { categoryIcon } from './icons'
import { Field, Sheet, Wordmark } from './ui'
import { cx, useEscape } from './kit'

export function PassphraseModal() {
  const ui = useUI()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!value || busy) return
    setBusy(true); setError(null)
    const err = await submitPassphrase(value)
    setBusy(false)
    if (err) setError(err)
    else ui.close()
  }

  return (
    <Sheet title="Sync passphrase" subtitle="Unlocks end-to-end encryption on this device." onClose={ui.close} width="max-w-md"
      footer={<>
        <button type="button" className="btn-ghost" onClick={ui.close}>Not now</button>
        <button type="button" className="btn-primary" disabled={!value || busy} onClick={() => void submit()}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <Lock size={15} />} Unlock</button>
      </>}
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <p className="text-sm leading-relaxed text-dim">
          Your things are encrypted here before they reach GLANCEvault, with a key made from this passphrase. Use the <span className="text-ink">same passphrase as your other GLANCE apps</span> on this account. If this is the account's first app, whatever you enter becomes its passphrase.
        </p>
        <Field label="Passphrase">
          <input className="input" type="password" autoFocus autoComplete="current-password" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        {error && <p className="rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">{error}</p>}
        <p className="text-xs leading-relaxed text-faint">It is never sent anywhere and cannot be recovered. This device remembers the derived key, not the passphrase.</p>
      </form>
    </Sheet>
  )
}

interface Command { id: string; label: string; hint?: string; icon: LucideIcon; run: () => void; group: string }

export function CommandPalette() {
  const d = useData()
  const ui = useUI()
  const { currency } = useSettings()
  const [q, setQ] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEscape(ui.close)

  const commands = useMemo<Command[]>(() => {
    const go = (fn: () => void) => () => { ui.close(); fn() }
    const base: Command[] = [
      { id: 'add-thing', group: 'Actions', label: 'Add a thing', icon: Plus, run: () => ui.open({ type: 'thing' }) },
      { id: 'add-plan', group: 'Actions', label: 'Add a plan', icon: Plus, run: () => ui.open({ type: 'subscription' }) },
      { id: 'v-glance', group: 'Go to', label: 'Glance', icon: LayoutDashboard, run: go(() => ui.setView('glance')) },
      { id: 'v-horizon', group: 'Go to', label: 'Horizon', icon: Telescope, run: go(() => ui.setView('horizon')) },
      { id: 'v-things', group: 'Go to', label: 'Things', icon: Package, run: go(() => ui.setView('things')) },
      { id: 'v-plans', group: 'Go to', label: 'Plans', icon: Repeat, run: go(() => ui.setView('plans')) },
      { id: 'sync', group: 'Actions', label: 'Sync now', icon: RefreshCw, run: go(() => void syncNow()) },
      { id: 'theme', group: 'Actions', label: 'Switch light / dark', icon: Moon, run: go(() => updateSettings({ theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark' })) },
      { id: 'settings', group: 'Actions', label: 'Settings', icon: SettingsIcon, run: () => ui.open({ type: 'settings' }) },
      { id: 'vault', group: 'Actions', label: 'GLANCEvault settings', icon: Cloud, run: () => ui.open({ type: 'settings', section: 'vault' }) },
    ]
    const things: Command[] = d.visibleThings.map((t) => ({
      id: `t-${t.id}`, group: 'Things', label: t.name, hint: [t.brand, t.model].filter(Boolean).join(' · '), icon: categoryIcon(t.category),
      run: go(() => ui.openThing(t.id)),
    }))
    const plans: Command[] = d.visibleSubs.map((s) => ({
      id: `s-${s.id}`, group: 'Plans', label: s.name, hint: `${money(s.amount, currency)}/${cycleShort(s.cycle)}`, icon: Repeat,
      run: () => ui.open({ type: 'subscription', id: s.id }),
    }))
    const all = [...base, ...things, ...plans]
    const needle = q.trim().toLowerCase()
    if (!needle) return [...base.slice(0, 6), ...things.slice(0, 6)]
    return all.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(needle)).slice(0, 14)
  }, [q, d.visibleThings, d.visibleSubs, ui, currency])

  useEffect(() => { setIndex(0) }, [q])
  useEffect(() => { listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' }) }, [index])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(commands.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); commands[index]?.run() }
  }

  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-60 flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={ui.close} />
      <div className="panel hud relative w-full max-w-xl animate-pop overflow-hidden !bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line/10 px-4">
          <Search size={17} className="text-accent" />
          <input className="h-12 flex-1 bg-transparent text-[15px] text-ink placeholder:text-faint focus:outline-none" autoFocus placeholder="Search things and plans, or run a command…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} />
          <kbd className="label rounded border border-line/15 px-1.5 py-0.5">esc</kbd>
        </div>
        <div ref={listRef} className="scrollbar-thin max-h-[52vh] overflow-y-auto p-2">
          {commands.length === 0 && <p className="px-3 py-6 text-center text-sm text-dim">Nothing matches “{q}”.</p>}
          {commands.map((c, i) => {
            const header = c.group !== lastGroup
            lastGroup = c.group
            return (
              <div key={c.id}>
                {header && <p className="label px-3 pb-1 pt-2">{c.group}</p>}
                <button type="button" data-active={i === index} onMouseEnter={() => setIndex(i)} onClick={c.run}
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
  const ui = useUI()
  const [busy, setBusy] = useState(false)
  const finish = () => { markWelcomed(); onDone() }
  const points: { icon: LucideIcon; title: string; body: string }[] = [
    { icon: ShieldCheck, title: 'Warranties and coverage', body: 'Know a warranty is ending while you can still use it.' },
    { icon: Repeat, title: 'Plans and renewals', body: 'See what renews, what it adds up to, and what to cancel first.' },
    { icon: Telescope, title: 'Shelf life', body: 'When security updates stop, and the right moment to buy the next one.' },
  ]
  return (
    <div className="app-bg fixed inset-0 z-50 overflow-y-auto">
      <div className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-12">
        <div className="animate-rise">
          <Wordmark className="text-4xl sm:text-5xl" />
          <p className="mt-3 text-lg text-dim">Know what is next for your things.</p>
        </div>
        <div className="stagger mt-10 space-y-3">
          {points.map((p, i) => (
            <div key={p.title} style={{ '--i': i + 2 } as React.CSSProperties} className="panel flex items-start gap-4 p-4">
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
            <Sparkles size={16} /> Explore with sample data
          </button>
          <button type="button" className="btn h-11 px-5" onClick={() => { finish(); ui.open({ type: 'thing' }) }}>Add my first thing <ArrowRight size={15} /></button>
          <button type="button" className="btn-ghost h-11" onClick={() => { finish(); ui.open({ type: 'settings', section: 'vault' }) }}><Cloud size={15} /> I already sync with GLANCEvault</button>
        </div>
        <p className="mt-6 text-xs leading-relaxed text-faint">Not a home inventory. No serial-number spreadsheets, no receipts to scan. Just the dates that matter and what they cost. Everything stays on this device unless you connect GLANCEvault.</p>
      </div>
    </div>
  )
}
