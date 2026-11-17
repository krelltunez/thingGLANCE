// The Electron desktop shell's bridge, as the renderer sees it
// (docs/desktop.md). The shell's preload (electron/preload.cts) exposes one
// object, `window.thingglanceDesktop`; on the web and on a phone there is none
// and `desktopBridge()` is null.
//
// This file is the contract only: the shapes, the allowlist, and the getter.
// What the app does with the bridge is native/desktopShell.ts, which hands its
// pieces to the same seams every shell uses (docs/shells.md). The bridge grows
// one group per feature, and electron/bridgeContract.test.ts holds this file,
// the preload and the main process's handlers to one list.

export type DesktopPlatform = 'darwin' | 'win32' | 'linux'

export interface DesktopInfo {
  platform: DesktopPlatform
  /** The desktop app's version (package.json). */
  version: string
  /** The Mac App Store build: sandboxed. */
  isMAS: boolean
  /** The OS protects secrets here; false on Linux without a keyring. */
  secureStorage: boolean
}

export interface DesktopShell {
  /** The translated Windows/Linux application menu (macOS keeps the native one). */
  setMenuLabels(labels: Record<string, string>): void
  /** The resolved theme, so the next launch's window paints the right color first. */
  setTheme(dark: boolean): void
  /** Leave native fullscreen; a no-op when the window is not fullscreen. */
  exitFullscreen(): void
  /** One line in the app's log file (thingglance-startup.log), for support. */
  log(message: string): void
  /** The machine woke, the screen unlocked, or the window was shown; returns the unsubscribe. */
  onWake(listener: (why: unknown) => void): () => void
  /** Background mode. keepRunning applies on Windows and Linux. */
  getBackgroundSettings(): Promise<DesktopBackgroundSettings | null>
  setBackgroundSettings(patch: Partial<DesktopBackgroundSettings>): Promise<DesktopBackgroundSettings>
  /** The global shortcuts ('' for none); the popup one exists on macOS and Windows only. */
  getShortcuts(): Promise<DesktopShortcuts | null>
  /** Register (or clear, with '') one; `ok` is false when another app holds it. */
  setShortcut(kind: 'popup' | 'window', accelerator: string): Promise<DesktopShortcuts & { ok: boolean }>
  /** A newer release with a download for this OS, or null (always null on the Mac App Store build). */
  latestRelease(): Promise<{ version: string; url: string } | null>
}

export interface DesktopShortcuts {
  popup: string
  window: string
  popupSupported: boolean
}

export interface DesktopBackgroundSettings {
  keepRunning: boolean
  openAtLogin: boolean
}

/** A response from the main process, or why no response came (refused, timeout, network). */
export type DesktopHttpResult =
  | { status: number; statusText: string; body: string; headers: Record<string, string> }
  | { error: string }

/** Whether the main process will refuse a URL, and whether a grant could unlock it. */
export type DesktopHttpInspect =
  | { blocked: false }
  | { blocked: true; canGrant: true; origin: string; addresses: string[] }
  | { blocked: true; canGrant: false; origin: string; reason: string }

export interface DesktopHttpGrant {
  origin: string
  grantedAt: string
  addresses: string[]
}

/**
 * The renderer's HTTP, made by the main process with no CORS. A private
 * network address is refused until the user grants its origin through `grant`,
 * which shows a native confirmation.
 */
export interface DesktopHttp {
  request(method: string, url: string, headers: Record<string, string>, body: string | null): Promise<DesktopHttpResult>
  inspect(url: string): Promise<DesktopHttpInspect>
  /** The permission dialog; `labels` is its translated text. */
  grant(url: string, labels: Record<string, string>): Promise<{ ok: boolean; reason?: string }>
  grants(): Promise<DesktopHttpGrant[]>
  revoke(origin: string): Promise<{ ok: boolean }>
}

/** GLANCEvault's live event stream, read by the main process (native/shell.ts, ShellEventStream). */
export interface DesktopVaultSse {
  start(options: { vaultUrl: string; vaultToken: string; accountId: string }): Promise<void>
  stop(): Promise<void>
  /** Every reader message ({type:'open'|'frame'|'closed'|'error'}); returns the unsubscribe. */
  onMessage(listener: (message: unknown) => void): () => void
}

/** The keystore, over Electron's safeStorage. `get` rejects when it could not read. */
export interface DesktopSecureStore {
  get(key: string): Promise<{ value: string | null }>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** A backup going out to a file (electron/files.ts). */
export interface DesktopFiles {
  /** The native save dialog; `saved` is false when the user cancelled. */
  saveText(options: { filename: string; text: string }): Promise<{ saved: boolean }>
  /** Written silently to the app's backups folder. */
  stash(options: { filename: string; text: string }): Promise<void>
}

/** What the tray shows and the reminders are scheduled from: the payload Android's widgets get. */
export interface DesktopWidget {
  /** A WidgetPayload as JSON (native/widgetBridge.ts). */
  updateSnapshot(json: string): void
}

/**
 * Writes made outside the window (the tray, a reminder's button), queued by
 * the main process until the page has applied them (electron/commandQueue.ts).
 */
export interface DesktopCommands {
  /** A JSON array of { action, payload, clientId }, oldest first. Nothing leaves until acknowledged. */
  take(): Promise<string>
  ack(ids: string[]): Promise<void>
  /** One was just queued; returns the unsubscribe. */
  onQueued(listener: () => void): () => void
}

/** A thingglance:// link the app was opened with, a reminder's click, a row in the tray. */
export interface DesktopLinks {
  consume(): Promise<{ link: string | null }>
  /** A link is waiting; returns the unsubscribe. */
  onOpen(listener: () => void): () => void
}

/** A reminder as the main process holds it (electron/reminderScheduler.ts). */
export interface DesktopReminder {
  id: string
  at: number
  title: string
  body: string
  link: string
  eventKey: string
}

/** The reminder scheduler in main. It schedules from the snapshot; the page only looks. */
export interface DesktopReminders {
  pending(): Promise<DesktopReminder[]>
  /** Whether this system can show a notification at all. */
  supported(): Promise<boolean>
}

/** "Owned since" (electron/ownership.ts): what the Mac App Store build reports, and nothing from any other. */
export interface DesktopOwnership {
  /** { since: epoch milliseconds, store, version }, or {} when not bought. */
  get(): Promise<{ since?: number; store?: string; version?: string }>
}

/** A listener (the MCP server, the Stream Deck socket): whether it is up, and why not. */
export interface DesktopListenerStatus {
  running: boolean
  error: string | null
}

/** green while the server runs, blue while there are changes to undo, red while changes are paused. */
export type DesktopAssistantIndicator = 'off' | 'on' | 'undo' | 'paused'

/** What Settings shows of the local integrations (electron/localIntegrations.ts, LocalIntegrationsView). */
export interface DesktopIntegrationsView {
  streamDeck: { enabled: boolean; port: number; status: DesktopListenerStatus }
  mcp: {
    readTier: 'off' | 'on'
    writesEnabled: boolean
    token: string | null
    port: number
    portOverride: number | null
    endpoint: string
    status: DesktopListenerStatus
    writesPaused: boolean
  }
  assistant: DesktopAssistantIndicator
}

/** The MCP server and the Stream Deck listener: both off until turned on here (docs/mcp.md). */
export interface DesktopLocalIntegrations {
  get(): Promise<DesktopIntegrationsView | null>
  /** One Settings change; refused with a reason when its consent is missing. */
  transition(action: Record<string, unknown>): Promise<{ ok: boolean; error?: string; view: DesktopIntegrationsView | null }>
  /** Returns the unsubscribe. */
  onStatus(listener: (view: unknown) => void): () => void
}

/** The MCP request bridge: main asks, the page answers from the database (src/mcp/mcpBridge.ts). */
export interface DesktopMcp {
  /** Returns the unsubscribe. */
  onRequest(listener: (request: unknown) => void): () => void
  respond(response: Record<string, unknown>): void
}

/** What assistants changed this session (electron/mcpJournal.ts): one group per item. */
export interface DesktopMcpJournalSnapshot {
  total: number
  groups: { key: string; label: string; count: number; latestSeq: number }[]
  entries: { seq: number; at: string; tool: string; summary: string; groupKey: string }[]
}

/** The MCP write journal, and undo. Main answers the main window only. */
export interface DesktopMcpJournal {
  get(): Promise<DesktopMcpJournalSnapshot | null>
  /** Undo one item's changes (a group key), or every change with null. */
  undo(groupKey: string | null): Promise<{ ok: boolean; undone?: number; skipped?: { kind: string; reason: string }[]; error?: string }>
  /** Returns the unsubscribe. */
  onChanged(listener: (snapshot: unknown) => void): () => void
}

/** What "Set up Claude Desktop" did (electron/mcpDesktopSetup.ts). */
export type DesktopClaudeSetupResult =
  | { ok: true; action: 'created' | 'merged'; path: string; backupPath: string | null }
  | {
    ok: false
    reason: 'unsupported_platform' | 'bridge_missing' | 'unreadable' | 'unparseable' | 'write_failed' | 'invalid_sender'
    path?: string
    /** The lines to paste into Claude Desktop's config by hand. */
    manualEntry?: string
    error?: string
  }

/**
 * Adds thingGLANCE to Claude Desktop's config (docs/mcp.md, "Connecting an
 * assistant"). Direct builds on macOS and Windows; the Mac App Store build has
 * no handler behind it, and no button that would call it.
 */
export interface DesktopMcpSetup {
  claudeDesktop(): Promise<DesktopClaudeSetupResult>
}

/** What the tray popup draws (electron/trayModel.ts, TrayState). */
export interface DesktopTrayState {
  ready: boolean
  waiting: number
  assistant?: DesktopAssistantIndicator
  payload: { snapshot: unknown; labels: unknown; canSend: boolean } | null
}

/** The tray popup's calls. Main answers them only from the popup's window. */
export interface DesktopTray {
  state(): Promise<DesktopTrayState | null>
  /** "Done with this" on a date, by its key. */
  decide(key: string): void
  /** "Send to dayGLANCE". */
  send(key: string): void
  /** Show the app, at a link or (null) as it is. */
  open(link: string | null): void
  hide(): void
  /** Returns the unsubscribe. */
  onState(listener: (state: unknown) => void): () => void
  /** The popup was just opened; returns the unsubscribe. */
  onShown(listener: () => void): () => void
}

export interface DesktopBridge {
  info: DesktopInfo
  shell: DesktopShell
  http: DesktopHttp
  vaultSse: DesktopVaultSse
  secureStore: DesktopSecureStore
  files: DesktopFiles
  widget: DesktopWidget
  commands: DesktopCommands
  links: DesktopLinks
  reminders: DesktopReminders
  ownership: DesktopOwnership
  localIntegrations: DesktopLocalIntegrations
  mcp: DesktopMcp
  mcpJournal: DesktopMcpJournal
  mcpSetup: DesktopMcpSetup
  tray: DesktopTray
}

/**
 * Every bridge method, as `group.method`. The allowlist that
 * electron/bridgeContract.test.ts holds equal to the preload's exposure and to
 * the interfaces above, as HEADLESS_BRIDGE_METHODS is held to the Android
 * bridge.
 */
export const DESKTOP_BRIDGE_METHODS = [
  'shell.setMenuLabels',
  'shell.setTheme',
  'shell.exitFullscreen',
  'shell.log',
  'shell.onWake',
  'shell.getBackgroundSettings',
  'shell.setBackgroundSettings',
  'shell.getShortcuts',
  'shell.setShortcut',
  'shell.latestRelease',
  'http.request',
  'http.inspect',
  'http.grant',
  'http.grants',
  'http.revoke',
  'vaultSse.start',
  'vaultSse.stop',
  'vaultSse.onMessage',
  'secureStore.get',
  'secureStore.set',
  'secureStore.delete',
  'files.saveText',
  'files.stash',
  'widget.updateSnapshot',
  'commands.take',
  'commands.ack',
  'commands.onQueued',
  'links.consume',
  'links.onOpen',
  'reminders.pending',
  'reminders.supported',
  'ownership.get',
  'localIntegrations.get',
  'localIntegrations.transition',
  'localIntegrations.onStatus',
  'mcp.onRequest',
  'mcp.respond',
  'mcpJournal.get',
  'mcpJournal.undo',
  'mcpJournal.onChanged',
  'mcpSetup.claudeDesktop',
  'tray.state',
  'tray.decide',
  'tray.send',
  'tray.open',
  'tray.hide',
  'tray.onState',
  'tray.onShown',
] as const

const PLATFORMS: readonly string[] = ['darwin', 'win32', 'linux']

function isDesktopBridge(value: unknown): value is DesktopBridge {
  if (!value || typeof value !== 'object') return false
  const b = value as Partial<DesktopBridge>
  return !!b.info && PLATFORMS.includes(b.info.platform as string) && typeof b.shell?.setTheme === 'function'
}

/** The desktop shell's bridge, or null anywhere else (web, PWA, Android, iOS). */
export function desktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as unknown as { thingglanceDesktop?: unknown }).thingglanceDesktop
  return isDesktopBridge(candidate) ? candidate : null
}

export const isDesktop = (): boolean => desktopBridge() !== null

/** A line in the desktop app's log file; a no-op anywhere else. Never throws. */
export function desktopLog(message: string): void {
  try { desktopBridge()?.shell.log(message) } catch { /* best-effort */ }
}
