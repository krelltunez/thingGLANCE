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

export interface DesktopBridge {
  info: DesktopInfo
  shell: DesktopShell
  http: DesktopHttp
  vaultSse: DesktopVaultSse
  secureStore: DesktopSecureStore
  files: DesktopFiles
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
