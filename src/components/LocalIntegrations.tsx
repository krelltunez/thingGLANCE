import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, RefreshCw, Undo2 } from 'lucide-react'
import { CLAUDE_SETUP_GUIDE_URL, claudeSetupNote, offersClaudeDesktopSetup, type ClaudeSetupNote } from '@/native/claudeDesktop'
import { desktopBridge, type DesktopIntegrationsView, type DesktopMcpJournalSnapshot } from '@/native/desktop'
import { toast } from '@/state/toast'
import { TONES, cx } from './kit'
import { Sheet, Toggle } from './ui'

// Settings, Integrations, "On this computer" (desktop app only): the listener
// the Stream Deck plugin connects to (docs/stream-deck.md) and the MCP server
// an AI assistant connects to (docs/mcp.md). Everything is off until
// turned on here, each switch behind its own consent, and the main process
// keeps the settings and decides what is allowed
// (electron/localIntegrations.ts): this only asks and shows.

type Consent = 'read' | 'write'

const DOT: Record<DesktopIntegrationsView['assistant'], string> = { off: 'bg-faint', on: 'bg-ok', undo: 'bg-accent', paused: 'bg-bad' }

export function LocalIntegrations() {
  const { t } = useTranslation()
  const bridge = desktopBridge()
  const [view, setView] = useState<DesktopIntegrationsView | null>(null)
  const [journal, setJournal] = useState<DesktopMcpJournalSnapshot | null>(null)
  const [consent, setConsent] = useState<Consent | null>(null)
  const [shown, setShown] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [claude, setClaude] = useState<ClaudeSetupNote | null>(null)

  useEffect(() => {
    if (!bridge) return
    void bridge.localIntegrations.get().then(setView).catch(() => {})
    void bridge.mcpJournal.get().then(setJournal).catch(() => {})
    const offStatus = bridge.localIntegrations.onStatus((v) => setView(v as DesktopIntegrationsView))
    const offJournal = bridge.mcpJournal.onChanged((j) => setJournal(j as DesktopMcpJournalSnapshot))
    return () => { offStatus(); offJournal() }
  }, [bridge])

  if (!bridge || !view) return null
  const { mcp } = view
  const on = mcp.readTier !== 'off'

  const send = async (action: Record<string, unknown>) => {
    setNote(null)
    const r = await bridge.localIntegrations.transition(action).catch(() => null)
    if (r?.view) setView(r.view)
    if (!r?.ok) setNote(t('settings.local.errorGeneric'))
  }
  const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast({ title: t('settings.local.copied') })).catch(() => {})
  const setUpClaude = async () => {
    const r = await bridge.mcpSetup.claudeDesktop().catch(() => null)
    setClaude(claudeSetupNote(r ?? { ok: false, reason: 'write_failed' }))
  }
  const undo = async (groupKey: string | null) => {
    const r = await bridge.mcpJournal.undo(groupKey).catch(() => null)
    if (!r?.ok) { toast({ title: t('settings.local.undoFailed'), tone: 'bad' }); return }
    toast({ title: t('settings.local.undoResult', { undone: r.undone ?? 0, kept: r.skipped?.length ?? 0 }) })
  }
  const error = mcp.status.error === 'port_in_use' ? t('settings.local.errorPortInUse', { port: mcp.port })
    : mcp.status.error === 'permission_denied' ? t('settings.local.errorPortDenied', { port: mcp.port })
      : mcp.status.error ? t('settings.local.errorBindFailed', { port: mcp.port }) : null
  const command = `claude mcp add --transport http thingglance ${mcp.endpoint} --header "Authorization: Bearer ${mcp.token ?? ''}"`

  return (
    <section className="rounded-xl border border-line/10 bg-bg/40 p-4" data-local-integrations>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
        {t('settings.local.title')}
        <span className={cx('h-2 w-2 rounded-full', DOT[view.assistant])} data-assistant-indicator={view.assistant} />
      </h3>
      <p className="mt-0.5 text-xs leading-relaxed text-dim">{t('settings.local.intro')}</p>

      <div className="mt-3 space-y-3">
        <Toggle checked={view.streamDeck.enabled} label={t('settings.local.streamDeck')}
          hint={view.streamDeck.status.error ? t('settings.local.errorPortInUse', { port: view.streamDeck.port }) : t('settings.local.streamDeckHint', { port: view.streamDeck.port })}
          onChange={(enabled) => void send({ type: 'set-stream-deck', enabled })} />
        <Toggle checked={on} label={t('settings.local.mcp')} hint={t('settings.local.mcpHint')}
          onChange={(v) => (v ? setConsent('read') : void send({ type: 'set-mcp-read-tier', tier: 'off' }))} />
        {on && (
          <Toggle checked={mcp.writesEnabled} label={t('settings.local.writes')} hint={t('settings.local.writesHint')}
            onChange={(v) => (v ? setConsent('write') : void send({ type: 'set-mcp-writes', enabled: false }))} />
        )}
      </div>

      {on && (
        <div className="mt-4 space-y-3 border-t border-line/10 pt-4 text-xs">
          <p className={cx('flex items-center gap-1.5', mcp.status.running ? 'text-dim' : 'text-warn')}>
            <span className={cx('h-1.5 w-1.5 rounded-full', mcp.status.running ? 'bg-ok' : 'bg-warn')} />
            {mcp.status.running ? t('settings.local.statusRunning', { port: mcp.port }) : error ?? t('settings.local.statusStopped')}
          </p>
          {mcp.writesPaused && <p className={cx('rounded-lg border px-3 py-2 leading-relaxed', TONES.bad.soft)}>{t('settings.local.writesPaused')}</p>}

          <div>
            <p className="label mb-1">{t('settings.local.address')}</p>
            <div className="flex items-center gap-2">
              <code className="num min-w-0 flex-1 truncate rounded-lg border border-line/10 bg-bg/60 px-2.5 py-1.5 text-ink">{mcp.endpoint}</code>
              <button type="button" className="icon-btn h-8 w-8" aria-label={t('settings.local.copy')} title={t('settings.local.copy')} onClick={() => copy(mcp.endpoint)}><Copy size={13} /></button>
            </div>
          </div>

          <div>
            <p className="label mb-1">{t('settings.local.token')}</p>
            <div className="flex items-center gap-2">
              <code className="num min-w-0 flex-1 truncate rounded-lg border border-line/10 bg-bg/60 px-2.5 py-1.5 text-ink">{shown ? mcp.token : '•'.repeat(24)}</code>
              <button type="button" className="btn-ghost shrink-0" onClick={() => setShown((s) => !s)}>{shown ? t('settings.local.hide') : t('settings.local.show')}</button>
              <button type="button" className="icon-btn h-8 w-8" aria-label={t('settings.local.copy')} title={t('settings.local.copy')} onClick={() => copy(mcp.token ?? '')}><Copy size={13} /></button>
              <button type="button" className="icon-btn h-8 w-8" aria-label={t('settings.local.rotate')} title={t('settings.local.rotate')} onClick={() => void send({ type: 'rotate-token' })}><RefreshCw size={13} /></button>
            </div>
            <p className="mt-1 leading-relaxed text-faint">{t('settings.local.tokenHint')}</p>
          </div>

          <div>
            <p className="label mb-1">{t('settings.local.claudeCode')}</p>
            <div className="flex items-start gap-2">
              <code className="num min-w-0 flex-1 break-all rounded-lg border border-line/10 bg-bg/60 px-2.5 py-1.5 text-dim">{shown ? command : command.replace(mcp.token ?? '', '…')}</code>
              <button type="button" className="icon-btn h-8 w-8 shrink-0" aria-label={t('settings.local.copy')} title={t('settings.local.copy')} onClick={() => copy(command)}><Copy size={13} /></button>
            </div>
            <p className="mt-1 leading-relaxed text-faint">{t('settings.local.claudeCodeHint')}</p>
          </div>

          <div data-claude-desktop>
            <p className="label mb-1">{t('settings.local.claudeDesktop')}</p>
            {/* Compiled out of the Mac App Store build, which may not change another app's settings (docs/mcp.md). */}
            {!__MAS_BUILD__ && offersClaudeDesktopSetup(bridge.info.platform, bridge.info.isMAS) ? (
              <>
                <button type="button" className="btn" onClick={() => void setUpClaude()}>{t('settings.local.claudeDesktopSetup')}</button>
                <p className="mt-1 leading-relaxed text-faint">{t('settings.local.claudeDesktopHint')}</p>
                {claude && <p className={cx('mt-2 rounded-lg border px-3 py-2 leading-relaxed', claude.bad ? TONES.bad.soft : TONES.ok.soft)} data-claude-desktop-result={claude.bad ? 'bad' : 'ok'}>{claude.text}</p>}
                {claude?.manual && <pre className="num mt-2 whitespace-pre-wrap break-all rounded-lg border border-line/10 bg-bg/60 px-2.5 py-1.5 text-dim">{claude.manual}</pre>}
              </>
            ) : (
              <p className="leading-relaxed text-faint">
                {t('settings.local.claudeDesktopGuide')}{' '}
                <a href={CLAUDE_SETUP_GUIDE_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">{t('settings.local.setupGuide')}</a>
              </p>
            )}
          </div>
        </div>
      )}

      {journal && journal.total > 0 && (
        <div className="mt-4 border-t border-line/10 pt-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">{t('settings.local.changesTitle')}</p>
            <button type="button" className="btn-ghost" onClick={() => void undo(null)}><Undo2 size={13} /> {t('settings.local.undoAll')}</button>
          </div>
          <p className="mt-0.5 text-xs text-faint">{t('settings.local.changesHint')}</p>
          <ul className="mt-2 space-y-1.5">
            {journal.groups.map((g) => (
              <li key={g.key} className="flex items-center justify-between gap-3 rounded-lg border border-line/10 bg-bg/40 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-dim">
                  {journal.entries.filter((e) => e.groupKey === g.key).map((e) => e.summary).join(' · ')}
                </span>
                <button type="button" className="btn-ghost shrink-0" onClick={() => void undo(g.key)}>{t('settings.local.undo')}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {note && <p className={cx('mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed', TONES.bad.soft)}>{note}</p>}

      {consent && (
        <Sheet title={t('settings.local.consentTitle')} onClose={() => setConsent(null)} width="max-w-md"
          footer={<>
            <button type="button" className="btn-ghost" onClick={() => setConsent(null)}>{t('common.cancel')}</button>
            <button type="button" className="btn-primary" onClick={() => {
              void send(consent === 'read' ? { type: 'set-mcp-read-tier', tier: 'on', consentConfirmed: true } : { type: 'set-mcp-writes', enabled: true, writesConsentConfirmed: true })
              setConsent(null)
            }}>{t('settings.local.accept')}</button>
          </>}>
          <p className="text-sm leading-relaxed text-dim">{consent === 'read' ? t('settings.local.consentRead') : t('settings.local.consentWrites')}</p>
        </Sheet>
      )}
    </section>
  )
}
