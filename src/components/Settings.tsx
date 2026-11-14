import { useEffect, useRef, useState, type ReactNode } from 'react'
import dayjs from 'dayjs'
import { Trans, useTranslation } from 'react-i18next'
import {
  Cloud, Copy, Database, Download, Info, KeyRound, LoaderCircle, Lock, MonitorCog, Moon, Palette, Pencil,
  RefreshCw, Send, Sun, Trash2, Unplug, Upload, Users, Zap,
} from 'lucide-react'
import { DAY, fmtDay, fmtMoment } from '@/core/dates'
import { CURRENCIES } from '@/core/money'
import { languages } from '@/locales'
import { LanguagePicker } from './LanguagePicker'
import { buildSnapshot } from '@/core/snapshot'
import { downloadBackup, importBackup, wipeLocalData } from '@/db/backup'
import { loadSamples } from '@/db/demo'
import { addMember, attachThisDevice, detachDevice, reassignAndRemove, removeMember, removeSamples, renameMember, tiesFor } from '@/db/queries'
import { describeTies, isTied, type MemberTies } from '@/core/household'
import { getActivity, getIntentsConfig, saveIntentsConfig } from '@/intents/config'
import { loadIntentsRootKey } from '@/intents/keyStore'
import { setupIntentsEncryption } from '@/intents/setup'
import { describeDevice, promptInstall } from '@/native/platform'
import { getSyncPassphrase } from '@glance-apps/sync'
import { recheckRoster, syncErrorText, syncNow } from '@/sync/manager'
import { ProEnrollError, clearCachedVaultKeys, connectSelfHosted, connectVaultPro, disconnectVault, reloadAfterConfigChange, testVaultConnection } from '@/sync/vaultConnect'
import { APP_ID, getVaultConfig } from '@/sync/vaultConfig'
import { useData } from '@/state/data'
import { updateSettings, useSettings, type ThemePref } from '@/state/settings'
import { useCanInstall, useIntentsVersion, useSync } from '@/state/sync'
import { toast } from '@/state/toast'
import { useUI, type SettingsSection } from '@/state/ui'
import { Chip, Field, Segmented, Sheet, Toggle, Wordmark } from './ui'
import { TONES, cx, type Tone } from './kit'

// The label of each is settings.sections.<id> in the catalog.
const SECTIONS: { id: SettingsSection; icon: typeof Cloud }[] = [
  { id: 'general', icon: Palette },
  { id: 'vault', icon: Cloud },
  { id: 'household', icon: Users },
  { id: 'integrations', icon: Zap },
  { id: 'data', icon: Database },
  { id: 'about', icon: Info },
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
  const { t } = useTranslation()
  const s = useSettings()
  const installable = useCanInstall()
  return (
    <div className="space-y-3">
      <Block title={t('settings.general.appearance')}>
        <Segmented<ThemePref> value={s.theme} onChange={(theme) => updateSettings({ theme })} options={[
          { id: 'system', label: <span className="inline-flex items-center gap-1.5"><MonitorCog size={13} /> {t('settings.general.system')}</span> },
          { id: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon size={13} /> {t('settings.general.dark')}</span> },
          { id: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun size={13} /> {t('settings.general.light')}</span> },
        ]} />
      </Block>
      <Block title={t('settings.general.currency')} hint={t('settings.general.currencyHint')}>
        <select className="input w-40" value={s.currency} onChange={(e) => updateSettings({ currency: e.target.value })}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      </Block>
      {languages.length > 1 && (
        <Block title={t('language.label')} hint={t('language.hint')}>
          <LanguagePicker className="input w-56" />
        </Block>
      )}
      <Block title={t('settings.general.webLookup')}>
        <Toggle checked={s.webLookup} onChange={(webLookup) => updateSettings({ webLookup })} label={t('settings.general.webLookupLabel')}
          hint={t('settings.general.webLookupHint')} />
      </Block>
      {installable && (
        <Block title={t('settings.general.install')} hint={t('settings.general.installHint')}>
          <button type="button" className="btn-primary" onClick={() => void promptInstall()}><Download size={15} /> {t('settings.general.installButton')}</button>
        </Block>
      )}
    </div>
  )
}

function Vault() {
  const { t } = useTranslation()
  const sync = useSync()
  const ui = useUI()
  const cfg = getVaultConfig()
  const connected = !!cfg?.enabled
  const [mode, setMode] = useState<'pro' | 'self'>('self')
  const [key, setKey] = useState('')
  const [url, setUrl] = useState('')
  const [account, setAccount] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null)
  const [confirm, setConfirm] = useState(false)

  const done = () => void reloadAfterConfigChange()

  const connectPro = async () => {
    setBusy(true); setNote(null)
    try { await connectVaultPro(key); done() }
    catch (e) { setNote({ tone: 'bad', text: e instanceof ProEnrollError ? e.message : t('settings.vault.couldNotConnect') }) }
    finally { setBusy(false) }
  }

  const self = { vaultUrl: url.trim().replace(/\/+$/, ''), vaultToken: token.trim(), accountId: account.trim() }
  const selfValid = /^https?:\/\//.test(self.vaultUrl) && !!self.vaultToken && !!self.accountId

  const test = async (): Promise<boolean> => {
    setBusy(true); setNote(null)
    const r = await testVaultConnection(self)
    setBusy(false)
    if (!r.ok) {
      setNote({ tone: 'bad', text: r.code === 'AUTH_FAILURE' ? t('settings.vault.tokenRejected') : r.code === 'FORBIDDEN' ? t('settings.vault.tokenForbidden') : t('settings.vault.unreachable') })
      return false
    }
    if (r.appAllowed === false) {
      setNote({ tone: 'warn', text: t('settings.vault.appNotAllowed', { app: APP_ID }) })
      return false
    }
    const reach = r.fresh ? t('settings.vault.reachFresh') : t('settings.vault.reachExisting')
    // Things still sync without the roster, so this warns and lets you connect.
    setNote(r.rosterAllowed === false
      ? { tone: 'warn', text: t('settings.vault.rosterNotListed', { reach }) }
      : { tone: 'ok', text: reach })
    return true
  }

  const connectSelf = async () => {
    if (!(await test())) return
    await connectSelfHosted(self)
    done()
  }

  if (connected && cfg) {
    const tones: Record<typeof sync.phase, Tone> = { off: 'dim', locked: 'warn', idle: 'ok', syncing: 'accent', synced: 'ok', error: 'bad' }
    const tone = tones[sync.phase]
    return (
      <div className="space-y-3">
        <Block title={cfg.pro ? 'GLANCEvault Pro' : 'GLANCEvault'} hint={<span className="num">{new URL(cfg.vaultUrl).host} · {t('settings.vault.account', { id: cfg.accountId.slice(0, 8) })}</span>}>
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={tone}><span className={cx('h-1.5 w-1.5 rounded-full', TONES[tone].solid, sync.phase === 'syncing' && 'animate-pulse2')} />{t(`settings.vault.phase.${sync.phase}`)}</Chip>
            {sync.lastSynced && <span className="text-xs text-dim">{t('settings.vault.lastSynced', { when: fmtMoment(sync.lastSynced, 'day-time') })}</span>}
            {sync.pending > 0 && <span className="num text-xs text-faint">{t('settings.vault.waitingToUpload', { count: sync.pending })}</span>}
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-dim">
            <span className={cx('h-1.5 w-1.5 rounded-full', sync.live === 'on' ? 'bg-ok' : sync.live === 'stalled' ? 'bg-warn' : 'bg-faint')} />
            {t(`settings.vault.live.${sync.live}`)}
          </p>
          {sync.phase === 'error' && <p className="mt-3 rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">{syncErrorText(sync.errorCode, sync.errorMessage)}</p>}
          {sync.skipped > 0 && <p className="mt-3 text-xs text-warn">{t('settings.vault.rowsSkipped', { count: sync.skipped })}</p>}
          {sync.rosterUnsupported && <p className="mt-3 rounded-lg border border-warn/25 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn">{t('settings.vault.rosterRefused')}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            {sync.phase === 'locked'
              ? <button type="button" className="btn-primary" onClick={() => ui.open({ type: 'passphrase' })}><Lock size={15} /> {t('settings.vault.enterPassphrase')}</button>
              : <button type="button" className="btn" onClick={() => void syncNow()}><RefreshCw size={15} className={cx(sync.phase === 'syncing' && 'animate-spin')} /> {t('settings.vault.syncNow')}</button>}
            {sync.errorCode === 'KEY_MISMATCH' && (
              <button type="button" className="btn" onClick={() => void clearCachedVaultKeys().then(done)}><KeyRound size={15} /> {t('settings.vault.resetKey')}</button>
            )}
            {confirm
              ? <>
                  <button type="button" className="btn-danger" onClick={() => void disconnectVault().then(done)}><Unplug size={15} /> {t('settings.vault.disconnectDevice')}</button>
                  <button type="button" className="btn-ghost" onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
                </>
              : <button type="button" className="btn-ghost" onClick={() => setConfirm(true)}><Unplug size={15} /> {t('settings.vault.disconnect')}</button>}
          </div>
          {confirm && <p className="mt-2 text-xs text-dim">{t('settings.vault.disconnectNote')}</p>}
        </Block>
        <Block title={t('settings.vault.encrypted')} hint={t('settings.vault.encryptedHint')}>{null}</Block>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {sync.errorCode === 'KEYSTORE_UNREADABLE' && <p className="rounded-lg border border-bad/25 bg-bad/10 px-3 py-2 text-xs leading-relaxed text-bad">{syncErrorText(sync.errorCode, null)}</p>}
      <Block title={t('settings.vault.syncWith')} hint={t('settings.vault.syncWithHint')}>
        <Segmented value={mode} onChange={(m) => { setMode(m); setNote(null) }} options={[
          { id: 'self', label: t('settings.vault.selfHosted') },
          { id: 'pro', label: <span className="inline-flex items-center gap-1.5">GLANCEvault Pro <span className="rounded border border-line/15 px-1 font-mono text-[9px] uppercase tracking-wider text-faint">{t('settings.vault.soon')}</span></span> },
        ]} />
        {mode === 'pro' ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-lg border border-line/10 bg-bg/40 px-3 py-2 text-xs leading-relaxed text-dim">{t('settings.vault.proNote')}</p>
            <Field label={t('settings.vault.accountKey')} hint={t('settings.vault.accountKeyHint')}>
              {/* eslint-disable-next-line i18next/no-literal-string -- the shape of a key, not words */}
              <input className="input num" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="gv_…" />
            </Field>
            <button type="button" className="btn-primary" disabled={!key.trim() || busy} onClick={() => void connectPro()}>{busy && <LoaderCircle size={15} className="animate-spin" />} {t('settings.vault.connect')}</button>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <Field label={t('settings.vault.serverUrl')}>
              {/* eslint-disable-next-line i18next/no-literal-string -- an example URL, not words */}
              <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://vault.example.com" inputMode="url" autoCapitalize="off" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('settings.vault.accountId')}><input className="input" value={account} onChange={(e) => setAccount(e.target.value)} autoCapitalize="off" /></Field>
              <Field label={t('settings.vault.deviceToken')}><input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
            </div>
            <div className="flex gap-2">
              <button type="button" className="btn" disabled={!selfValid || busy} onClick={() => void test()}>{busy && <LoaderCircle size={15} className="animate-spin" />} {t('settings.vault.test')}</button>
              <button type="button" className="btn-primary" disabled={!selfValid || busy} onClick={() => void connectSelf()}>{t('settings.vault.connect')}</button>
            </div>
            <p className="text-xs leading-relaxed text-faint">
              <Trans i18nKey="settings.vault.serverNeeds" values={{ app: APP_ID, origin: window.location.origin }} components={{ id: <span className="num text-dim" /> }} />
            </p>
          </div>
        )}
        {note && <p className={cx('mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed', TONES[note.tone].soft)}>{note.text}</p>}
      </Block>
    </div>
  )
}

function Household() {
  const { t } = useTranslation()
  const d = useData()
  const sync = useSync()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  // The member being removed while things still point at them, and who gets those.
  const [leaving, setLeaving] = useState<{ id: string; ties: MemberTies; hidden: number; to: string } | null>(null)

  // Opening this section reads the roster, so what is listed is what the
  // vault holds now and not what the last scheduled sync happened to bring.
  useEffect(() => { void recheckRoster() }, [])

  const add = async () => {
    if (!name.trim()) return
    const first = d.members.length === 0
    const m = await addMember(name)
    setName('')
    // The first person added on a device nobody has claimed is, nearly always,
    // the person holding it.
    if (first && !d.meId) await attachThisDevice(m.id, describeDevice())
  }
  const remove = async (id: string) => {
    const { ties, hidden } = await tiesFor(id)
    if (isTied(ties)) setLeaving({ id, ties, hidden, to: '' })
    else await removeMember(id)
  }
  const handOver = async () => {
    if (!leaving) return
    const who = d.memberName(leaving.id)
    const heir = d.memberName(leaving.to)
    const ok = await reassignAndRemove(leaving.id, leaving.to || null)
    setLeaving(null)
    toast(ok
      ? {
          title: who != null ? t('settings.household.removed', { name: who }) : t('settings.household.removedUnnamed'),
          body: heir != null ? t('settings.household.wentTo', { name: heir }) : t('settings.household.wentToHousehold'),
          tone: 'ok',
        }
      : { title: t('settings.household.couldNotRemove'), tone: 'bad' })
  }

  const where = sync.phase === 'off' ? t('settings.household.membersNotConnected') : sync.rosterUnsupported ? t('settings.household.membersLocal') : t('settings.household.membersShared')

  return (
    <div className="space-y-3">
      <Block title={t('settings.household.members')} hint={t('settings.household.membersHint', { where })}>
        <ul className="divide-y divide-line/[0.07]">
          {d.members.map((m) => {
            const links = d.devices.filter((l) => l.memberId === m.id)
            const me = m.id === d.meId
            const going = leaving?.id === m.id ? leaving : null
            return (
              <li key={m.id} className="py-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-xs font-semibold uppercase text-accent">{m.name[0]}</span>
                  {editing?.id === m.id
                    ? <input className="input h-8 flex-1" autoFocus value={editing.name} onChange={(e) => setEditing({ id: m.id, name: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter' && editing.name.trim()) { void renameMember(m.id, editing.name); setEditing(null) } }}
                        onBlur={() => { if (editing.name.trim() && editing.name !== m.name) void renameMember(m.id, editing.name); setEditing(null) }} />
                    : (
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-ink">{m.name}{me && <span className="ml-2 text-xs text-accent">{t('settings.household.you')}</span>}</span>
                        <span className="block truncate text-xs text-faint">
                          {links.length === 0
                            ? t('settings.household.noApp')
                            : t('settings.household.usesApp', { devices: links.map((l) => (l.id === d.deviceId ? t('settings.household.thisDevice') : l.label ?? t('settings.household.aDevice'))).join(', ') })}
                        </span>
                      </span>
                    )}
                  {me
                    ? <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => void detachDevice()}>{t('settings.household.notMe')}</button>
                    : <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => void attachThisDevice(m.id, describeDevice())}>{t('settings.household.thisIsMe')}</button>}
                  <button type="button" className="icon-btn h-8 w-8" title={t('settings.household.rename')} onClick={() => setEditing({ id: m.id, name: m.name })}><Pencil size={13} /></button>
                  <button type="button" className="icon-btn h-8 w-8 hover:!text-bad" title={t('common.remove')} onClick={() => void remove(m.id)}><Trash2 size={13} /></button>
                </div>
                {going && (
                  <div className="mt-2 rounded-lg border border-warn/25 bg-warn/[0.07] p-3">
                    <p className="text-xs leading-relaxed text-ink">{t('settings.household.stillTied', { count: going.ties.owns + going.ties.pays + going.ties.responsible, name: m.name, ties: describeTies(going.ties) })}</p>
                    {going.hidden > 0 && (
                      <p className="mt-1.5 text-xs leading-relaxed text-warn">
                        {me
                          ? t('settings.household.hiddenMine', { count: going.hidden, name: m.name })
                          : t('settings.household.hiddenOthers', { count: going.hidden, name: m.name })}{' '}
                        {going.to && d.userIds.has(going.to)
                          ? t('settings.household.staysPrivate', { count: going.hidden, name: d.memberName(going.to) })
                          : t('settings.household.becomesVisible', { count: going.hidden })}
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <select aria-label={t('settings.household.whoGets', { name: m.name })} className="input h-8 w-auto min-w-[10rem] flex-1 py-0 text-xs" value={going.to} onChange={(e) => setLeaving({ ...going, to: e.target.value })}>
                        <option value="">{t('settings.household.theHousehold')}</option>
                        {d.members.filter((x) => x.id !== m.id).map((x) => <option key={x.id} value={x.id}>{d.userIds.has(x.id) ? x.name : t('settings.household.noDevice', { name: x.name })}</option>)}
                      </select>
                      <button type="button" className="btn-danger h-8 px-3 text-xs" onClick={() => void handOver()}>{t('settings.household.handOver')}</button>
                      <button type="button" className="btn-ghost h-8 px-2 text-xs" onClick={() => setLeaving(null)}>{t('common.cancel')}</button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
          {d.members.length === 0 && <li className="py-3 text-sm text-dim">{t('settings.household.noMembers')}</li>}
        </ul>
        <RosterStatus empty={d.members.length === 0} />
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <input className="input" placeholder={t('settings.household.addMember')} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn shrink-0" disabled={!name.trim()}>{t('common.add')}</button>
        </form>
      </Block>
      {!d.meId && d.members.length > 0 && <p className="px-1 text-xs text-warn">{t('settings.household.pickYourself')}</p>}
      {d.members.length === 1 && <p className="px-1 text-xs text-dim">{t('settings.household.needSecond')}</p>}
      {d.devices.some((l) => l.id !== d.deviceId) && (
        <Block title={t('settings.household.otherDevices')} hint={t('settings.household.otherDevicesHint')}>
          <ul className="divide-y divide-line/[0.07]">
            {d.devices.filter((l) => l.id !== d.deviceId).map((l) => (
              <li key={l.id} className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{l.label ?? t('settings.household.unnamedDevice')} <span className="text-xs text-faint">· {d.memberName(l.memberId) ?? t('settings.household.goneMember')} · {t('settings.household.since', { date: fmtDay(dayjs(l.createdAt).format(DAY)) })}</span></span>
                <button type="button" className="btn-ghost h-8 px-2 text-xs hover:!text-bad" onClick={() => void detachDevice(l.id)}>{t('settings.household.detach')}</button>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  )
}

// Says what the last read of the vault's shared roster found, so an empty
// list is explained rather than left to look broken.
function RosterStatus({ empty }: { empty: boolean }) {
  const { t } = useTranslation()
  const sync = useSync()
  if (sync.phase === 'off') return null
  const again = <button type="button" className="font-medium text-accent hover:underline" onClick={() => void recheckRoster()}>{t('settings.household.checkAgain')}</button>
  const line = 'mt-2 rounded-lg border px-3 py-2 text-xs leading-relaxed'
  // One wording for a vault that leaves the roster's app out, wherever it shows.
  if (sync.rosterUnsupported) return <p className={cx(line, TONES.warn.soft)}>{t('settings.vault.rosterRefused')} {again}</p>
  if (sync.phase === 'locked') return <p className={cx(line, TONES.warn.soft)}>{sync.keyConflict ? t('settings.household.rosterKeyConflict') : t('settings.household.rosterLocked')}</p>
  if (sync.rosterPaused) return <p className={cx(line, TONES.warn.soft)}>{t('settings.household.rosterPaused')} {again}</p>
  if (!sync.rosterCheckedAt) return <p className={cx(line, 'border-line/10 text-dim')}>{t('settings.household.rosterReading')}</p>
  const at = fmtMoment(sync.rosterCheckedAt, 'time')
  if (sync.rosterError) return <p className={cx(line, TONES.bad.soft)}>{t('settings.household.rosterError', { at, error: sync.rosterError })} {again}</p>
  if (sync.rosterRejected > 0 && empty) return <p className={cx(line, TONES.warn.soft)}>{t('settings.household.rosterRejected', { count: sync.rosterRejected, at })} {again}</p>
  if (sync.rosterSkipped > 0) return <p className={cx(line, TONES.warn.soft)}>{t('settings.household.rosterSkipped', { count: sync.rosterSkipped, at })} {again}</p>
  if (!empty) return null
  return (
    <p className={cx(line, 'border-line/10 text-dim')}>
      {t('settings.household.rosterEmpty', { at })} {again}
    </p>
  )
}

function Integrations() {
  const { t } = useTranslation()
  useIntentsVersion()
  const sync = useSync()
  const ui = useUI()
  const cfg = getIntentsConfig()
  const activity = getActivity()
  const vaultOn = sync.phase !== 'off'

  const toggle = async (enabled: boolean) => {
    if (enabled && !(await loadIntentsRootKey())) {
      const pass = getSyncPassphrase()
      if (!pass) { ui.open({ type: 'passphrase' }); toast({ title: t('settings.integrations.passphraseTitle'), body: t('settings.integrations.passphraseBody') }); return }
      try { await setupIntentsEncryption(pass) }
      catch (e) { toast({ title: t('settings.integrations.encryptionFailed'), body: e instanceof Error ? e.message : undefined, tone: 'bad' }); return }
    }
    saveIntentsConfig({ ...cfg, enabled })
  }

  return (
    <div className="space-y-3">
      <Block title="dayGLANCE" hint={t('settings.integrations.dayglanceHint')}>
        {vaultOn
          ? <>
              <Toggle checked={cfg.enabled} onChange={(v) => void toggle(v)} label={t('settings.integrations.sendReceive')}
                hint={t('settings.integrations.sendReceiveHint')} />
              {cfg.enabled && (
                <Field label={t('settings.integrations.taskDue')} className="mt-3">
                  <select className="input w-56" value={cfg.leadDays} onChange={(e) => saveIntentsConfig({ ...cfg, leadDays: Number(e.target.value) })}>
                    <option value={0}>{t('settings.integrations.lead.sameDay')}</option>
                    <option value={3}>{t('settings.integrations.lead.threeDays')}</option>
                    <option value={7}>{t('settings.integrations.lead.week')}</option>
                    <option value={14}>{t('settings.integrations.lead.twoWeeks')}</option>
                    <option value={30}>{t('settings.integrations.lead.month')}</option>
                  </select>
                </Field>
              )}
            </>
          : <button type="button" className="btn" onClick={() => ui.open({ type: 'settings', section: 'vault' })}><Cloud size={15} /> {t('settings.integrations.connectFirst')}</button>}
      </Block>
      {cfg.enabled && (
        <Block title={t('settings.integrations.activity')}>
          {activity.length === 0
            ? <p className="text-sm text-dim">{t('settings.integrations.activityEmpty')}</p>
            : (
              <ul className="scrollbar-thin max-h-56 space-y-2 overflow-y-auto">
                {activity.map((a, i) => (
                  <li key={a.at + i} className="flex gap-2.5 text-xs">
                    <span className={cx('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', a.type === 'error' ? 'bg-bad' : a.type === 'warning' ? 'bg-warn' : a.type === 'sent' ? 'bg-accent' : 'bg-ok')} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-ink">{a.message}</span>
                      {a.detail && <span className="block text-faint">{a.detail}</span>}
                    </span>
                    <span className="num shrink-0 text-faint">{fmtMoment(a.at, 'day-time')}</span>
                  </li>
                ))}
              </ul>
            )}
        </Block>
      )}
      <Block title={t('settings.integrations.otherSurfaces')} hint={t('settings.integrations.otherSurfacesHint')}>
        <SnapshotPeek />
      </Block>
    </div>
  )
}

function SnapshotPeek() {
  const { t } = useTranslation()
  const d = useData()
  const { currency, reminders } = useSettings()
  const scope = { viewerId: d.meId, memberId: d.focusId, userIds: d.userIds, currency, reminderPrefs: reminders }
  const snap = buildSnapshot(d, { ...scope, limit: 3 })
  const peek = {
    counts: snap.counts,
    burn: { monthly: +snap.burn.monthly.toFixed(2), replacementMonthly: +snap.burn.replacementMonthly.toFixed(2) },
    attention: snap.attention.map((e) => ({ days: e.days, title: e.title, detail: e.detail })),
    // What this device would be reminded of, once a shell exists to schedule it.
    reminders: { pending: snap.reminders.length, next: snap.reminders.slice(0, 3).map((r) => ({ when: fmtMoment(r.at, 'day-time'), title: r.title, body: r.body })) },
  }
  return (
    <>
      <pre className="scrollbar-thin max-h-44 select-text overflow-auto rounded-lg border border-line/10 bg-bg/70 p-3 font-mono text-[10.5px] leading-relaxed text-dim">
        {JSON.stringify(peek, null, 2)}
      </pre>
      <button type="button" className="btn mt-2 h-8 text-xs" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(buildSnapshot(d, scope), null, 2)); toast({ title: t('settings.integrations.snapshotCopied'), tone: 'ok' }) }}><Copy size={13} /> {t('settings.integrations.copySnapshot')}</button>
    </>
  )
}

function Data() {
  const { t } = useTranslation()
  const d = useData()
  const file = useRef<HTMLInputElement>(null)
  const [confirmWipe, setConfirmWipe] = useState(false)
  const samples = d.things.filter((x) => x.sample).length + d.subscriptions.filter((s) => s.sample).length

  const onFile = async (f: File | undefined) => {
    if (!f) return
    try {
      const r = await importBackup(await f.text())
      toast({ title: t('settings.data.imported'), body: t('settings.data.importedBody', { added: r.added, updated: r.updated }), tone: 'ok' })
    } catch (e) {
      toast({ title: t('settings.data.importFailed'), body: e instanceof Error ? e.message : undefined, tone: 'bad' })
    }
    if (file.current) file.current.value = ''
  }

  return (
    <div className="space-y-3">
      <Block title={t('settings.data.backup')} hint={t('settings.data.backupHint')}>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn" onClick={() => void downloadBackup()}><Download size={15} /> {t('settings.data.export')}</button>
          <button type="button" className="btn" onClick={() => file.current?.click()}><Upload size={15} /> {t('settings.data.import')}</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
      </Block>
      <Block title={t('settings.data.samples')} hint={t('settings.data.samplesHint')}>
        {samples > 0
          ? <button type="button" className="btn" onClick={() => { void removeSamples(); toast({ title: t('settings.data.samplesRemoved') }) }}><Trash2 size={15} /> {t('settings.data.removeSamples', { count: samples })}</button>
          : <button type="button" className="btn" onClick={() => void loadSamples()}>{t('settings.data.loadSamples')}</button>}
      </Block>
      <Block title={t('settings.data.erase')} hint={t('settings.data.eraseHint')}>
        {confirmWipe
          ? <div className="flex gap-2">
              <button type="button" className="btn-danger" onClick={() => void wipeLocalData().then(() => { setConfirmWipe(false); toast({ title: t('settings.data.erased') }) })}><Trash2 size={15} /> {t('settings.data.eraseConfirm')}</button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmWipe(false)}>{t('common.cancel')}</button>
            </div>
          : <button type="button" className="btn-ghost hover:!text-bad" onClick={() => setConfirmWipe(true)}><Trash2 size={15} /> {t('settings.data.eraseButton')}</button>}
      </Block>
    </div>
  )
}

function About() {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line/10 bg-bg/40 p-5">
        <Wordmark className="text-2xl" />
        <p className="mt-1 text-sm text-dim">{t('settings.about.tagline')}</p>
        <p className="num mt-4 text-xs text-faint">{t('settings.about.version', { version: __APP_VERSION__, when: fmtMoment(__BUILD_TIME__, 'date-time') })}</p>
      </div>
      <Block title={t('settings.about.family')} hint={t('settings.about.familyHint')}>
        <div className="flex flex-wrap gap-1.5">
          <Chip tone="dim" icon={Send}>{t('settings.about.intents')}</Chip><Chip tone="dim" icon={Users}>{t('settings.about.sharedRoster')}</Chip><Chip tone="dim" icon={Cloud}>GLANCEvault</Chip>
        </div>
      </Block>
      <Block title={t('settings.about.webData')} hint={t('settings.about.webDataHint')}>{null}</Block>
    </div>
  )
}

export function Settings({ section }: { section?: SettingsSection }) {
  const { t } = useTranslation()
  const ui = useUI()
  const [tab, setTab] = useState<SettingsSection>(section ?? 'general')
  const Body = { general: General, vault: Vault, household: Household, integrations: Integrations, data: Data, about: About }[tab]
  return (
    // One size whatever the section holds, so switching sections never moves
    // the panel. A long section scrolls inside it.
    <Sheet title={t('settings.title')} onClose={ui.close} width="max-w-3xl" className="h-[92svh] sm:h-[660px]">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <nav className="scrollbar-none -mx-5 flex shrink-0 gap-1 overflow-x-auto px-5 sm:sticky sm:top-0 sm:mx-0 sm:w-44 sm:flex-col sm:px-0">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => setTab(s.id)}
              className={cx('flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-[13px] font-medium transition',
                tab === s.id ? 'bg-accent/15 text-accent' : 'text-dim hover:bg-line/5 hover:text-ink')}>
              <s.icon size={15} /> {t(`settings.sections.${s.id}`)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1"><Body /></div>
      </div>
    </Sheet>
  )
}
