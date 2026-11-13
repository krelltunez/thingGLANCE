import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Cloud, CloudAlert, CloudOff, LayoutDashboard, Lock, Package, Plus, RefreshCw, Repeat, Search,
  Settings as SettingsIcon, Sparkles, Telescope, type LucideIcon,
} from 'lucide-react'
import { useData } from '@/state/data'
import { DataProvider } from '@/state/DataProvider'
import { UIContext, type Modal, type UI, type View } from '@/state/ui'
import { useSync } from '@/state/sync'
import { setUserFilter, takeLegacyMeId } from '@/multiuser/settings'
import { startSync } from '@/sync/manager'
import { describeDevice, setBadge } from '@/native/platform'
import { attachThisDevice, removeSamples } from '@/db/queries'
import { GlanceView } from '@/views/GlanceView'
import { HorizonView } from '@/views/HorizonView'
import { ThingsView } from '@/views/ThingsView'
import { PlansView } from '@/views/PlansView'
import { ThingDetail } from '@/components/ThingDetail'
import { ThingForm } from '@/components/ThingForm'
import { CoverageForm, SubscriptionForm } from '@/components/PlanForms'
import { Settings } from '@/components/Settings'
import { CommandPalette, PassphraseModal, Welcome } from '@/components/Overlays'
import { needsWelcome } from '@/state/welcome'
import { Segmented, Toasts, Wordmark } from '@/components/ui'
import { cx } from '@/components/kit'

const VIEWS: { id: View; label: string; icon: LucideIcon }[] = [
  { id: 'glance', label: 'Glance', icon: LayoutDashboard },
  { id: 'horizon', label: 'Horizon', icon: Telescope },
  { id: 'things', label: 'Things', icon: Package },
  { id: 'plans', label: 'Plans', icon: Repeat },
]

const isView = (v: string | null): v is View => !!v && VIEWS.some((x) => x.id === v)

function SyncButton({ onOpen }: { onOpen: (m: Modal) => void }) {
  const sync = useSync()
  const map: Record<typeof sync.phase, { icon: LucideIcon; cls: string; title: string; spin?: boolean }> = {
    off: { icon: CloudOff, cls: 'text-faint', title: 'Not syncing. Connect GLANCEvault' },
    locked: { icon: Lock, cls: 'text-warn !border-warn/40', title: 'Enter your sync passphrase' },
    idle: { icon: Cloud, cls: 'text-ok', title: 'Connected to GLANCEvault' },
    syncing: { icon: RefreshCw, cls: 'text-accent', title: 'Syncing…', spin: true },
    synced: { icon: Cloud, cls: 'text-ok', title: 'Synced with GLANCEvault' },
    error: { icon: CloudAlert, cls: 'text-bad !border-bad/40', title: 'Sync needs attention' },
  }
  const s = map[sync.phase]
  return (
    <button type="button" className={cx('icon-btn', s.cls)} title={s.title} aria-label={s.title}
      onClick={() => onOpen(sync.phase === 'locked' ? { type: 'passphrase' } : { type: 'settings', section: 'vault' })}>
      <s.icon size={16} className={cx(s.spin && 'animate-spin')} />
    </button>
  )
}

function AddMenu({ onOpen, variant }: { onOpen: (m: Modal) => void; variant: 'header' | 'fab' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])
  const pick = (m: Modal) => { setOpen(false); onOpen(m) }
  return (
    <div ref={ref} className="relative">
      {variant === 'header'
        ? <button type="button" className="btn-primary" onClick={() => setOpen((v) => !v)}><Plus size={16} /> Add</button>
        : <button type="button" aria-label="Add" onClick={() => setOpen((v) => !v)}
            className={cx('flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-[0_8px_24px_-6px_rgb(var(--accent)/0.7)] transition active:scale-95', open && 'rotate-45')}>
            <Plus size={22} />
          </button>}
      {open && (
        // Placed by this wrapper, animated by the panel inside it. The pop
        // animation drives `transform`, so on one element it would override
        // the centring translate until it finished and the menu would jump.
        <div className={cx('absolute z-50 w-48', variant === 'header' ? 'right-0 top-11' : 'bottom-14 left-1/2 -translate-x-1/2')}>
          <div className={cx('panel animate-pop !bg-raised p-1.5 shadow-2xl', variant === 'fab' && 'origin-bottom')}>
            <button type="button" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-accent/15" onClick={() => pick({ type: 'thing' })}><Package size={15} className="text-accent" /> A thing</button>
            <button type="button" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-ink hover:bg-accent/15" onClick={() => pick({ type: 'subscription' })}><Repeat size={15} className="text-sub" /> A plan</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Shell({ ui }: { ui: UI }) {
  const d = useData()
  const { view, setView, modal, open } = ui

  useEffect(() => { setBadge(d.queue.length) }, [d.queue.length])
  const samples = d.things.filter((t) => t.sample).length + d.subscriptions.filter((x) => x.sample).length

  const ViewBody = { glance: GlanceView, horizon: HorizonView, things: ThingsView, plans: PlansView }[view]

  return (
    <div className="app-bg flex min-h-full flex-col">
      <header className="app-header safe-top sticky top-0 z-30 border-b border-line/10 bg-bg/75 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1560px] items-center gap-3 px-4 lg:h-16 lg:gap-5 lg:px-8">
          <button type="button" className="shrink-0 text-left leading-none" onClick={() => setView('glance')}>
            <Wordmark className="text-[22px] lg:text-2xl" />
            <span className="label mt-1 hidden !text-[9px] !normal-case !tracking-wide lg:block">what's next for your things?</span>
          </button>

          <nav className="ml-2 hidden items-center gap-1 lg:flex" role="tablist">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
                className={cx('relative flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition',
                  view === v.id ? 'bg-accent/12 text-accent' : 'text-dim hover:bg-line/5 hover:text-ink')}>
                <v.icon size={15} /> {v.label}
                {v.id === 'glance' && d.queue.length > 0 && <span className="num flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-ink">{d.queue.length}</span>}
                {view === v.id && <span className="absolute inset-x-3 -bottom-[14px] h-0.5 rounded-full bg-accent glow-accent" />}
              </button>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => open({ type: 'palette' })}
              className="hidden h-9 items-center gap-2 rounded-lg border border-line/10 bg-raised/50 pl-3 pr-2 text-[13px] text-faint transition hover:border-line/25 hover:text-ink md:flex">
              <Search size={14} /> Search <kbd className="label ml-6 rounded border border-line/15 px-1.5 py-0.5">⌘K</kbd>
            </button>
            <button type="button" className="icon-btn md:hidden" aria-label="Search" onClick={() => open({ type: 'palette' })}><Search size={16} /></button>
            {d.multiUser && d.meId && (
              <Segmented size="sm" value={d.filter} onChange={setUserFilter} options={[{ id: 'mine', label: 'Mine' }, { id: 'all', label: 'Everyone' }]} />
            )}
            <SyncButton onOpen={open} />
            <button type="button" className="icon-btn" aria-label="Settings" title="Settings" onClick={() => open({ type: 'settings' })}><SettingsIcon size={16} /></button>
            <div className="hidden lg:block"><AddMenu onOpen={open} variant="header" /></div>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1560px] flex-1 px-4 pb-32 pt-5 lg:px-8 lg:pb-14 lg:pt-7">
        {samples > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-accent/20 bg-accent/[0.06] px-3.5 py-2 text-xs text-dim lg:mb-5">
            <Sparkles size={13} className="shrink-0 text-accent" />
            <span className="min-w-0 flex-1">You are looking at sample data. It never syncs, and editing a sample makes it yours.</span>
            <button type="button" className="font-medium text-accent hover:underline" onClick={() => void removeSamples()}>Remove samples</button>
          </div>
        )}
        <div key={view} className="animate-fade-in"><ViewBody /></div>
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line/10 bg-bg/85 backdrop-blur-md lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2 pt-1.5">
          {VIEWS.slice(0, 2).map((v) => <TabButton key={v.id} v={v} active={view === v.id} onClick={() => setView(v.id)} badge={v.id === 'glance' ? d.queue.length : 0} />)}
          <div className="flex justify-center"><AddMenu onOpen={open} variant="fab" /></div>
          {VIEWS.slice(2).map((v) => <TabButton key={v.id} v={v} active={view === v.id} onClick={() => setView(v.id)} badge={0} />)}
        </div>
      </nav>

      {ui.thingId && <ThingDetail key={`detail-${ui.thingId}`} thingId={ui.thingId} />}
      {modal?.type === 'thing' && <ThingForm key={`thing-${modal.id ?? 'new'}`} id={modal.id} initialCategory={modal.category} />}
      {modal?.type === 'subscription' && <SubscriptionForm key={`plan-${modal.id ?? 'new'}`} id={modal.id} thingId={modal.thingId} />}
      {modal?.type === 'coverage' && <CoverageForm key={`cover-${modal.id ?? 'new'}`} thingId={modal.thingId} id={modal.id} />}
      {modal?.type === 'settings' && <Settings key={`settings-${modal.section ?? 'general'}`} section={modal.section} />}
      {modal?.type === 'passphrase' && <PassphraseModal />}
      {modal?.type === 'palette' && <CommandPalette />}
      <Toasts />
    </div>
  )
}

function TabButton({ v, active, onClick, badge }: { v: (typeof VIEWS)[number]; active: boolean; onClick: () => void; badge: number }) {
  return (
    <button type="button" onClick={onClick} className={cx('relative flex flex-col items-center gap-1 py-1.5 text-[10px] font-medium transition', active ? 'text-accent' : 'text-faint')}>
      <v.icon size={20} strokeWidth={active ? 2.2 : 1.8} />
      {v.label}
      {badge > 0 && <span className="num absolute right-[22%] top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-accent-ink">{badge}</span>}
    </button>
  )
}

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), [])
  const [view, setViewState] = useState<View>(() => {
    const fromUrl = params.get('view')
    const stored = localStorage.getItem('tg_view')
    return isView(fromUrl) ? fromUrl : isView(stored) ? stored : 'glance'
  })
  const [thingId, setThingId] = useState<string | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [welcome, setWelcome] = useState(needsWelcome)
  const sync = useSync()

  const setView = useCallback((v: View) => {
    setViewState(v)
    localStorage.setItem('tg_view', v)
    window.scrollTo({ top: 0 })
  }, [])

  const ui = useMemo<UI>(() => ({
    view, setView,
    thingId, openThing: setThingId,
    modal, open: setModal, close: () => setModal(null),
  }), [view, setView, thingId, modal])

  // Engines start once; the page reloads after any vault config change.
  useEffect(() => { void startSync() }, [])

  // v0.1 remembered "this is me" in localStorage. It is a synced row now, so
  // the rest of the household can tell who uses the app: hand it over once.
  useEffect(() => {
    const legacy = takeLegacyMeId()
    if (legacy) void attachThisDevice(legacy, describeDevice())
  }, [])

  // A vault with no key on this device: ask for the passphrase once per load.
  const asked = useRef(false)
  useEffect(() => {
    if (sync.phase === 'locked' && !asked.current && !welcome) { asked.current = true; setModal({ type: 'passphrase' }) }
  }, [sync.phase, welcome])

  // PWA shortcuts (manifest.json) and, later, deep links from widgets, the
  // launcher and the tray: ?action=add-thing | add-subscription, ?thing=<id>.
  useEffect(() => {
    const action = params.get('action')
    if (action === 'add-thing') setModal({ type: 'thing' })
    else if (action === 'add-subscription') setModal({ type: 'subscription' })
    const t = params.get('thing')
    if (t) setThingId(t)
    if (params.size) window.history.replaceState(null, '', window.location.pathname)
  }, [params])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement)?.tagName ?? '')
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setModal((m) => (m?.type === 'palette' ? null : { type: 'palette' })); return }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || modal) return
      if (e.key === '/') { e.preventDefault(); setModal({ type: 'palette' }) }
      else if (e.key === 'n') { e.preventDefault(); setModal({ type: 'thing' }) }
      else if (e.key >= '1' && e.key <= '4' && !thingId) setView(VIEWS[Number(e.key) - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal, thingId, setView])

  return (
    <DataProvider>
      <UIContext.Provider value={ui}>
        <Shell ui={ui} />
        {welcome && <Welcome onDone={() => setWelcome(false)} />}
      </UIContext.Provider>
    </DataProvider>
  )
}
