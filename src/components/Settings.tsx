import { useRef, useState, type ReactNode } from 'react'
import dayjs from 'dayjs'
import {
  Cloud, Copy, Database, Download, Info, KeyRound, LoaderCircle, Lock, MonitorCog, Moon, Palette, Pencil,
  RefreshCw, Send, Sun, Trash2, Unplug, Upload, Users, Zap,
} from 'lucide-react'
import { CURRENCIES } from '@/core/money'
import { buildSnapshot } from '@/core/snapshot'
import { downloadBackup, importBackup, wipeLocalData } from '@/db/backup'
import { loadSamples } from '@/db/demo'
import { addUser, removeSamples, removeUser, renameUser } from '@/db/queries'
import { getActivity, getIntentsConfig, saveIntentsConfig } from '@/intents/config'
import { loadIntentsRootKey } from '@/intents/keyStore'
import { setupIntentsEncryption } from '@/intents/setup'
import { setMeUserId, setMultiUserEnabled, setUserFilter } from '@/multiuser/settings'
import { syncRosterSoon } from '@/multiuser/rosterDirtyTracker'
import { promptInstall } from '@/native/platform'
import { getSyncPassphrase } from '@glance-apps/sync'
import { syncErrorText, syncNow } from '@/sync/manager'
import { ProEnrollError, clearCachedVaultKeys, connectSelfHosted, connectVaultPro, disconnectVault, testVaultConnection } from '@/sync/vaultConnect'
import { APP_ID, getVaultConfig } from '@/sync/vaultConfig'
import { useData } from '@/state/data'
import { updateSettings, useSettings, type ThemePref } from '@/state/settings'
import { useCanInstall, useIntentsVersion, useSync } from '@/state/sync'
import { toast } from '@/state/toast'
import { useUI, type SettingsSection } from '@/state/ui'
import { Chip, Field, Segmented, Sheet, Toggle, Wordmark } from './ui'
import { TONES, cx, type Tone } from './kit'

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Cloud }[] = [
  { id: 'general', label: 'General', icon: Palette },
  { id: 'vault', label: 'GLANCEvault', icon: Cloud },
  { id: 'household', label: 'Household', icon: Users },
  { id: 'integrations', label: 'Integrations', icon: Zap },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'about', label: 'About', icon: Info },
]

function Block({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line/10 bg-bg/40 p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-xs leading-relaxed text-dim">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function General() {
  const s = useSettings()
  const installable = useCanInstall()
  return (
    <div className="space-y-3">
      <Block title="Appearance">
        <Segmented<ThemePref> value={s.theme} onChange={(theme) => updateSettings({ theme })} options={[
          { id: 'system', label: <span className="inline-flex items-center gap-1.5"><MonitorCog size={13} /> System</span> },
          { id: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon size={13} /> Dark</span> },
          { id: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun size={13} /> Light</span> },
        ]} />
      </Block>
      <Block title="Currency" hint="One currency for every amount. Nothing is converted.">
        <select className="input w-40" value={s.currency} onChange={(e) => updateSettings({ currency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Block>
      <Block title="Web lookup">
        <Toggle checked={s.webLookup} onChange={(webLookup) => updateSettings({ webLookup })} label="Fill things in from the web"
          hint="Photo, specs and release date from Wikipedia; end of security updates from endoflife.date. Only the product name you type into the lookup box is sent, and only when you use it." />
      </Block>
      {installable && (
        <Block title="Install" hint="Runs in its own window, works offline, and shows a badge when something needs a decision.">
          <button type="button" className="btn-primary" onClick={() => void promptInstall()}><Download size={15} /> Install thingGLANCE</button>
        </Block>
      )}
    </div>
  )
}

function Vault() {
  const sync = useSync()
  const ui = useUI()
  const cfg = getVaultConfig()
  const connected = !!cfg?.enabled
  const [mode, setMode] = useState<'pro' | 'self'>('pro')
  const [key, setKey] = useState('')
  const [url, setUrl] = useState('')
  const [account, setAccount] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null)
  const [confirm, setConfirm] = useState(false)

  const done = () => window.location.reload()

  const connectPro = async () => {
    setBusy(true); setNote(null)
    try { await connectVaultPro(key); done() }
    catch (e) { setNote({ tone: 'bad', text: e instanceof ProEnrollError ? e.message : 'Could not connect.' }) }
    finally { setBusy(false) }
  }

  const self = { vaultUrl: url.trim().replace(/\/+$/, ''), vaultToken: token.trim(), accountId: account.trim() }
  const selfValid = /^https?:\/\//.test(self.vaultUrl) && !!self.vaultToken && !!self.accountId

  const test = async (): Promise<boolean> => {
    setBusy(true); setNote(null)
    const r = await testVaultConnection(self)
    setBusy(false)
    if (!r.ok) {
      setNote({ tone: 'bad', text: r.code === 'AUTH_FAILURE' ? 'The vault rejected that token.' : r.code === 'FORBIDDEN' ? 'That token cannot access this account.' : `Could not reach the vault. Check the URL, and that this site's address is in the server's allowed origins.` })
      return false
    }
    if (r.appAllowed === false) {
      setNote({ tone: 'warn', text: `Connected, but this server does not list "${APP_ID}" in its allowed apps yet. Add it to GLANCEVAULT_ALLOWED_APPS and restart the vault, then connect.` })
      return false
    }
    setNote({ tone: 'ok', text: r.fresh ? 'Reachable. This account is new: your passphrase will set its encryption key.' : 'Reachable, and the account already has data. Use the same passphrase as your other GLANCE apps.' })
    return true
  }

  const connectSelf = async () => {
    if (!(await test())) return
    await connectSelfHosted(self)
    done()
  }

  if (connected && cfg) {
    const phase: Record<typeof sync.phase, { label: string; tone: Tone }> = {
      off: { label: 'Off', tone: 'dim' },
      locked: { label: 'Waiting for your passphrase', tone: 'warn' },
      idle: { label: 'Connected', tone: 'ok' },
      syncing: { label: 'Syncing…', tone: 'accent' },
      synced: { label: 'Up to date', tone: 'ok' },
      error: { label: 'Needs attention', tone: 'bad' },
    }
    const p = phase[sync.phase]
    return (
      <div className="space-y-3">
        <Block title={cfg.pro ? 'GLANCEvault Pro' : 'GLANCEvault'} hint={<span className="num">{new URL(cfg.vaultUrl).host} · account {cfg.accountId.slice(0, 8)}…</span>}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={p.tone}><span className={cx('h-1.5 w-1.5 rounded-full', TONES[p.tone].solid, sync.phase === 'syncing' && 'animate-pulse2')} />{p.label}</Chip>
            {sync.lastSynced && <span className="text-xs text-dim">Last synced {dayjs(sync.lastSynced).format('MMM D, h:mm A')}</span>}
            {sync.pending > 0 && <span className="num text-xs text-faint">{sync.pending} waiting to upload</span>}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-dim">
            <span className={cx('h-1.5 w-1.5 rounded-full', sync.live === 'on' ? 'bg-ok' : sync.live === 'stalled' ? 'bg-warn' : 'bg-faint')} />
            {{
              on: 'Live: changes from your other devices arrive within seconds.',
              connecting: 'Connecting live updates. Until then it checks every few minutes.',
              stalled: 'Live updates are blocked, probably by a reverse proxy buffering /events. It still checks every few minutes.',
              unsupported: 'This vault server is too old for live updates. It checks every few minutes.',
              off: 'Checks every few minutes, and whenever you return to the app.',
            }[sync.live]}
          </p>
          {sync.phase === 'error' && <p className="mt-3 rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">{syncErrorText(sync.errorCode, sync.errorMessage)}</p>}
          {sync.skipped > 0 && <p className="mt-3 text-xs text-warn">{sync.skipped} rows could not be decrypted and were skipped.</p>}
          {sync.rosterUnsupported && <p className="mt-3 text-xs text-dim">This server does not offer the shared household roster (glance-users) yet, so members stay on this device.</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {sync.phase === 'locked'
              ? <button type="button" className="btn-primary" onClick={() => ui.open({ type: 'passphrase' })}><Lock size={15} /> Enter passphrase</button>
              : <button type="button" className="btn" onClick={() => void syncNow()}><RefreshCw size={15} className={cx(sync.phase === 'syncing' && 'animate-spin')} /> Sync now</button>}
            {sync.errorCode === 'KEY_MISMATCH' && (
              <button type="button" className="btn" onClick={() => void clearCachedVaultKeys().then(done)}><KeyRound size={15} /> Reset key and re-enter</button>
            )}
            {confirm
              ? <>
                  <button type="button" className="btn-danger" onClick={() => void disconnectVault().then(done)}><Unplug size={15} /> Disconnect this device</button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>Cancel</button>
                </>
              : <button type="button" className="btn-ghost" onClick={() => setConfirm(true)}><Unplug size={15} /> Disconnect</button>}
          </div>
          {confirm && <p className="mt-2 text-xs text-dim">Your things stay on this device and in the vault. Only the connection is removed.</p>}
        </Block>
        <Block title="End-to-end encrypted" hint="Everything is encrypted on this device with a key made from your sync passphrase before it leaves. The vault stores ciphertext it cannot read. The passphrase is the same one your other GLANCE apps use on this account, and it is never sent anywhere.">{null}</Block>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <Block title="Sync with GLANCEvault" hint="thingGLANCE syncs one way only: through GLANCEvault, end-to-end encrypted. It also carries the shared household roster and tasks sent to dayGLANCE. Without it, everything stays on this device.">
        <Segmented value={mode} onChange={(m) => { setMode(m); setNote(null) }} options={[{ id: 'pro', label: 'GLANCEvault Pro' }, { id: 'self', label: 'Self-hosted' }]} />
        {mode === 'pro' ? (
          <div className="mt-4 space-y-3">
            <Field label="Account key" hint="Paste the key you were sent. It is exchanged once for this device's own credential and never stored.">
              <input className="input num" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="gv_…" />
            </Field>
            <button type="button" className="btn-primary" disabled={!key.trim() || busy} onClick={() => void connectPro()}>{busy && <LoaderCircle size={15} className="animate-spin" />} Connect</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <Field label="Server URL"><input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://vault.example.com" inputMode="url" autoCapitalize="off" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Account ID"><input className="input" value={account} onChange={(e) => setAccount(e.target.value)} autoCapitalize="off" /></Field>
              <Field label="Device token"><input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn" disabled={!selfValid || busy} onClick={() => void test()}>{busy && <LoaderCircle size={15} className="animate-spin" />} Test</button>
              <button type="button" className="btn-primary" disabled={!selfValid || busy} onClick={() => void connectSelf()}>Connect</button>
            </div>
            <p className="text-xs leading-relaxed text-faint">The server needs <span className="num text-dim">{APP_ID}</span> in GLANCEVAULT_ALLOWED_APPS, and this site's address ({window.location.origin}) in its allowed origins.</p>
          </div>
        )}
        {note && <p className={cx('mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed', TONES[note.tone].soft)}>{note.text}</p>}
      </Block>
    </div>
  )
}

function Household() {
  const d = useData()
  const sync = useSync()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const toggle = (on: boolean) => {
    setMultiUserEnabled(on)
    if (on) syncRosterSoon(200)
  }
  const add = async () => {
    if (!name.trim()) return
    const u = await addUser(name)
    setName('')
    if (!d.meId && d.users.length === 0) setMeUserId(u.id)
  }

  return (
    <div className="space-y-3">
      <Block title="Multi-user">
        <Toggle checked={d.multiUser} onChange={toggle} label="This is a shared household"
          hint="Give things an owner and plans a payer, and switch between your own view and everyone's. The member list is the same roster dayGLANCE, lastGLANCE and lifeGLANCE use on this vault account." />
      </Block>
      {d.multiUser && (
        <>
          <Block title="Members" hint={sync.phase === 'off' ? 'Not connected to GLANCEvault: members stay on this device for now.' : sync.rosterUnsupported ? 'This vault does not offer the shared roster yet: members stay on this device.' : 'Shared with your other GLANCE apps through the vault.'}>
            <ul className="divide-y divide-line/[0.07]">
              {d.users.map((u) => (
                <li key={u.id} className="flex items-center gap-2 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-xs font-semibold uppercase text-accent">{u.name[0]}</span>
                  {editing?.id === u.id
                    ? <input className="input h-8 flex-1" autoFocus value={editing.name} onChange={(e) => setEditing({ id: u.id, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter' && editing.name.trim()) { void renameUser(u.id, editing.name); setEditing(null) } }}
                        onBlur={() => { if (editing.name.trim() && editing.name !== u.name) void renameUser(u.id, editing.name); setEditing(null) }} />
                    : <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.name}{u.id === d.meId && <span className="ml-2 text-xs text-accent">you</span>}</span>}
                  {u.id !== d.meId && <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => setMeUserId(u.id)}>This is me</button>}
                  <button type="button" className="icon-btn h-8 w-8" title="Rename" onClick={() => setEditing({ id: u.id, name: u.name })}><Pencil size={13} /></button>
                  <button type="button" className="icon-btn h-8 w-8 hover:!text-bad" title="Remove" onClick={() => { void removeUser(u.id); if (u.id === d.meId) { setMeUserId(null); setUserFilter('all') } }}><Trash2 size={13} /></button>
                </li>
              ))}
              {d.users.length === 0 && <li className="py-3 text-sm text-dim">No members yet.</li>}
            </ul>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
              <input className="input" placeholder="Add a member" value={name} onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="btn shrink-0" disabled={!name.trim()}>Add</button>
            </form>
          </Block>
          {!d.meId && d.users.length > 0 && <p className="px-1 text-xs text-warn">Pick which member this device belongs to, to unlock the Mine / Everyone switch in the header.</p>}
        </>
      )}
    </div>
  )
}

function Integrations() {
  useIntentsVersion()
  const sync = useSync()
  const ui = useUI()
  const cfg = getIntentsConfig()
  const activity = getActivity()
  const vaultOn = sync.phase !== 'off'

  const toggle = async (enabled: boolean) => {
    if (enabled && !(await loadIntentsRootKey())) {
      const pass = getSyncPassphrase()
      if (!pass) { ui.open({ type: 'passphrase' }); toast({ title: 'Enter your sync passphrase', body: 'It makes the key that encrypts tasks sent between your GLANCE apps.' }); return }
      try { await setupIntentsEncryption(pass) }
      catch (e) { toast({ title: 'Could not set up encryption', body: e instanceof Error ? e.message : undefined, tone: 'bad' }); return }
    }
    saveIntentsConfig({ ...cfg, enabled })
  }

  return (
    <div className="space-y-3">
      <Block title="dayGLANCE" hint="Turn anything in your queue into a dayGLANCE task with one tap. When you complete the task there, the item clears here, on every device.">
        {vaultOn
          ? <>
              <Toggle checked={cfg.enabled} onChange={(v) => void toggle(v)} label="Send and receive through GLANCEvault"
                hint="Uses GLANCE intents over your vault connection, end-to-end encrypted. dayGLANCE needs GLANCEvault intents turned on too." />
              {cfg.enabled && (
                <Field label="Task due" className="mt-3">
                  <select className="input w-56" value={cfg.leadDays} onChange={(e) => saveIntentsConfig({ ...cfg, leadDays: Number(e.target.value) })}>
                    <option value={0}>On the day itself</option>
                    <option value={3}>3 days before</option>
                    <option value={7}>A week before</option>
                    <option value={14}>Two weeks before</option>
                    <option value={30}>A month before</option>
                  </select>
                </Field>
              )}
            </>
          : <button type="button" className="btn" onClick={() => ui.open({ type: 'settings', section: 'vault' })}><Cloud size={15} /> Connect GLANCEvault first</button>}
      </Block>
      {cfg.enabled && (
        <Block title="Activity">
          {activity.length === 0
            ? <p className="text-sm text-dim">Nothing sent or received yet.</p>
            : (
              <ul className="scrollbar-thin max-h-56 space-y-2 overflow-y-auto">
                {activity.map((a, i) => (
                  <li key={a.at + i} className="flex gap-2.5 text-xs">
                    <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', a.type === 'error' ? 'bg-bad' : a.type === 'warning' ? 'bg-warn' : a.type === 'sent' ? 'bg-accent' : 'bg-ok')} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ink">{a.message}</span>
                      {a.detail && <span className="block text-faint">{a.detail}</span>}
                    </span>
                    <span className="num shrink-0 text-faint">{dayjs(a.at).format('MMM D HH:mm')}</span>
                  </li>
                ))}
              </ul>
            )}
        </Block>
      )}
      <Block title="Other surfaces" hint="Widgets, the menu bar popup, GLANCElauncher cards and MCP tools will all read one object: the glance snapshot. This is what it holds right now.">
        <SnapshotPeek />
      </Block>
    </div>
  )
}

function SnapshotPeek() {
  const d = useData()
  const snap = buildSnapshot(d, { userId: d.filter === 'mine' ? d.meId : null, limit: 3 })
  return (
    <>
      <pre className="scrollbar-thin max-h-44 select-text overflow-auto rounded-lg border border-line/10 bg-bg/70 p-3 font-mono text-[10.5px] leading-relaxed text-dim">
        {JSON.stringify({ counts: snap.counts, burn: { monthly: +snap.burn.monthly.toFixed(2), replacementMonthly: +snap.burn.replacementMonthly.toFixed(2) }, attention: snap.attention.map((e) => ({ days: e.days, title: e.title, detail: e.detail })) }, null, 2)}
      </pre>
      <button type="button" className="btn mt-2 h-8 text-xs" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(buildSnapshot(d), null, 2)); toast({ title: 'Full snapshot copied', tone: 'ok' }) }}><Copy size={13} /> Copy full snapshot</button>
    </>
  )
}

function Data() {
  const d = useData()
  const file = useRef<HTMLInputElement>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const samples = d.things.filter((t) => t.sample).length + d.subscriptions.filter((s) => s.sample).length

  const onFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const r = await importBackup(await f.text())
      toast({ title: 'Backup imported', body: `${r.added} added, ${r.updated} updated.`, tone: 'ok' })
    } catch (e) {
      toast({ title: 'Could not import that file', body: e instanceof Error ? e.message : undefined, tone: 'bad' })
    }
    if (file.current) file.current.value = ''
  }

  return (
    <div className="space-y-3">
      <Block title="Backup" hint="A plain JSON file with everything except sample data. Importing merges by item, newest wins, so it never rolls anything back.">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => void downloadBackup()}><Download size={15} /> Export</button>
          <button type="button" className="btn" onClick={() => file.current?.click()}><Upload size={15} /> Import</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
      </Block>
      <Block title="Sample data" hint="A realistic set of things and plans to explore with. Samples never sync; editing one turns it into a real item.">
        {samples > 0
          ? <button type="button" className="btn" onClick={() => { void removeSamples(); toast({ title: 'Sample data removed' }) }}><Trash2 size={15} /> Remove {samples} samples</button>
          : <button type="button" className="btn" onClick={() => void loadSamples()}>Load sample data</button>}
      </Block>
      <Block title="Erase this device" hint="Deletes everything stored in this browser. Anything already in your vault stays there.">
        {confirmWipe
          ? <div className="flex gap-2">
              <button type="button" className="btn-danger" onClick={() => void wipeLocalData().then(() => { setConfirmWipe(false); toast({ title: 'Local data erased' }) })}><Trash2 size={15} /> Yes, erase it</button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmWipe(false)}>Cancel</button>
            </div>
          : <button type="button" className="btn-ghost hover:!text-bad" onClick={() => setConfirmWipe(true)}><Trash2 size={15} /> Erase local data</button>}
      </Block>
    </div>
  )
}

function About() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line/10 bg-bg/40 p-5">
        <Wordmark className="text-2xl" />
        <p className="mt-1 text-sm text-dim">Know what is next for your things.</p>
        <p className="num mt-4 text-xs text-faint">v{__APP_VERSION__} · prototype · built {dayjs(__BUILD_TIME__).format('MMM D, YYYY HH:mm')}</p>
      </div>
      <Block title="Part of the GLANCE family" hint="dayGLANCE plans the day, lastGLANCE remembers when you last did something, lifeGLANCE holds the long view. thingGLANCE watches the things you own.">
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="dim" icon={Send}>Intents</Chip><Chip tone="dim" icon={Users}>Shared roster</Chip><Chip tone="dim" icon={Cloud}>GLANCEvault</Chip>
        </div>
      </Block>
      <Block title="Where the web data comes from" hint="Product facts: Wikipedia (CC BY-SA). Support windows: endoflife.date (MIT). Dates marked as estimates are projections from a maker's usual support window, not promises.">{null}</Block>
    </div>
  )
}

export function Settings({ section }: { section?: SettingsSection }) {
  const ui = useUI()
  const [tab, setTab] = useState<SettingsSection>(section ?? 'general')
  const Body = { general: General, vault: Vault, household: Household, integrations: Integrations, data: Data, about: About }[tab]
  return (
    <Sheet title="Settings" onClose={ui.close} width="max-w-3xl">
      <div className="flex flex-col gap-5 sm:flex-row">
        <nav className="scrollbar-none -mx-5 flex shrink-0 gap-1 overflow-x-auto px-5 sm:mx-0 sm:w-44 sm:flex-col sm:px-0">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => setTab(s.id)}
              className={cx('flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition',
                tab === s.id ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-line/5 hover:text-ink')}>
              <s.icon size={15} /> {s.label}
            </button>
          ))}
        </nav>
        <div className="min-h-[340px] min-w-0 flex-1"><Body /></div>
      </div>
    </Sheet>
  )
}
