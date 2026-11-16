// The thingGLANCE desktop shell: the main process. Design: docs/desktop.md.
//
// After lastGLANCE's electron/main.ts, which follows dayGLANCE's
// (krelltunez/dayGLANCE@8d72008), less what thingGLANCE does not have: iCloud,
// Direct Access and in-app purchases. Sync is GLANCEvault only, and every
// request the page makes goes out from here.

import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, net, Notification, powerMonitor, protocol, safeStorage, screen, session, shell, Tray } from 'electron';
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import nodeNet from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_BASE_URL, APP_HOST, APP_SCHEME, resolveAppRequest } from './appProtocol.js';
import { buildApplicationMenuTemplate, isApplicationMenuLabels, supportsCustomApplicationMenu, type ApplicationMenuLabels } from './applicationMenu.js';
import { CONTENT_SECURITY_POLICY } from './csp.js';
import { isAllowedExternalUrl } from './externalLinks.js';
import { createHttpProxy } from './httpProxy.js';
import { createNetworkTrust, type NetworkTrust } from './networkTrust.js';
import { decideRecovery } from './rendererRecovery.js';
import { createVaultSseReader } from './vaultSse.js';
import { createSecureStore, secureStorageUsable } from './secureStore.js';
import { registerFilesHandlers } from './files.js';
import { initStartupLog, logStartup } from './startupLog.js';
import { shouldQuitOnAllWindowsClosed } from './startupQuit.js';
import { DESKTOP_INFO_ARG, encodeDesktopInfo } from './desktopInfo.js';
import { loadWindowState, onScreen, saveWindowState, saveWindowTheme, windowBackgroundColor } from './windowState.js';
import { applyOpenAtLogin, closeAction, isAcceleratorText, launchedHidden, loadDesktopSettings, saveDesktopSettings, type DesktopSettings } from './backgroundMode.js';
import { createCommandQueue, type CommandSource } from './commandQueue.js';
import { DEEP_LINK_SCHEME, acceptDeepLink, deepLinkFromArgv } from './deepLink.js';
import { createReminderScheduler, type PlannedReminder, type ReminderWords } from './reminderScheduler.js';
import { availableUpdate, CHECK_CACHE_MS, RELEASES_API, type AvailableUpdate } from './updateCheck.js';
import { OWNED_FILE, ensureOwnership } from './ownership.js';
import type http from 'node:http';
import { createIdempotencyStore, createWriteGate, type HostBridge } from '@glance-apps/mcp-host';
import {
  applyTransition, DEFAULT_LOCAL_INTEGRATIONS, integrationsView, listenerEffects, loadLocalIntegrations, mcpGates, mcpPort, saveLocalIntegrations,
  type ListenerStatus, type LocalIntegrationsConfig, type McpEffect, type StreamDeckEffect,
} from './localIntegrations.js';
import { bindErrorCode, startMcpServer } from './mcpServer.js';
import { createRendererBridge } from './mcpRendererBridge.js';
import { createJournal } from './mcpJournal.js';
import { discoveryFilePath, syncDiscoveryFile } from './mcpDiscovery.js';
import { isClickAfterBlurHide, parseTrayPayload, popupPosition, settledHere, trayEvent, trayMenuItems, trayState, type TrayPayload } from './trayModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The app:// scheme as a real web origin, before ready (a no-op after it).
// standard+secure gives app://thingglance a stable origin and a secure context;
// fetch support lets the renderer load its own files.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// One name and one userData folder for every build. Electron derives the
// default from package.json's lowercase `name`. The sandbox still puts the Mac
// App Store copy in its container.
app.setName('thingGLANCE');
// THINGGLANCE_USER_DATA_DIR puts everything somewhere else: the smoke test and
// the device checks run on a profile of their own, never a person's.
app.setPath('userData', process.env['THINGGLANCE_USER_DATA_DIR'] || path.join(app.getPath('appData'), 'thingGLANCE'));

initStartupLog(app.getPath('userData'));
logStartup(`main process module loaded, version ${app.getVersion()}`);
process.on('uncaughtException', (err) => {
  logStartup(`uncaughtException: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
});
process.on('unhandledRejection', (reason) => {
  logStartup(`unhandledRejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
});

const DEV = !app.isPackaged;
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'] ?? 'http://localhost:5193';
const APP_DIST_DIR = path.join(__dirname, '../dist');
const IS_MAC = process.platform === 'darwin';

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;
let didCreateMainWindow = false;
let mainRecoveryAttempts: number[] = [];
let applicationMenuSignature: string | null = null;
// The page's translated strings for the shell's own text: the application
// menu, the tray, the background notice. English until the page sends them.
let shellLabels: Record<string, string> = {};
const label = (key: string, fallback: string): string => shellLabels[key] || fallback;
let desktopSettings: DesktopSettings = loadDesktopSettings(app.getPath('userData'));

// Null for a destroyed window, so callers need no isDestroyed() checks.
function live(win: BrowserWindow | null): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

function isMainWindowSender(sender: Electron.WebContents): boolean {
  return sender === live(mainWindow)?.webContents;
}

function openExternalSafe(url: string): void {
  if (isAllowedExternalUrl(url)) void shell.openExternal(url);
}

// The app itself: the Vite dev server in dev, app://thingglance (any path or
// query) when packaged. Everything else is an external navigation.
function isSameAppOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (DEV && parsed.origin === new URL(VITE_DEV_SERVER_URL).origin) return true;
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}

function updateApplicationMenu(labels: ApplicationMenuLabels): void {
  if (!supportsCustomApplicationMenu(process.platform)) return;
  const signature = JSON.stringify(labels);
  if (signature === applicationMenuSignature) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate(labels, { devTools: DEV })));
  applicationMenuSignature = signature;
}

ipcMain.on('shell:set-menu-labels', (event, labels: unknown) => {
  if (!isMainWindowSender(event.sender) || !isApplicationMenuLabels(labels)) return;
  shellLabels = { ...labels };
  updateApplicationMenu(labels);
  refreshTray();
});

// ── Background mode (docs/desktop.md, "Staying alive") ──────────────────────
// The settings the page shows: keep running (Windows and Linux) and open at login.
function backgroundSettingsView() {
  return { keepRunning: desktopSettings.keepRunning, openAtLogin: desktopSettings.openAtLogin };
}

ipcMain.handle('shell:get-background-settings', (event) => {
  if (!isMainWindowSender(event.sender)) return null;
  return backgroundSettingsView();
});

ipcMain.handle('shell:set-background-settings', (event, patch: unknown) => {
  if (!isMainWindowSender(event.sender) || !patch || typeof patch !== 'object') return backgroundSettingsView();
  const p = patch as Record<string, unknown>;
  if (typeof p.keepRunning === 'boolean') desktopSettings = { ...desktopSettings, keepRunning: p.keepRunning };
  if (typeof p.openAtLogin === 'boolean' && p.openAtLogin !== desktopSettings.openAtLogin) {
    const applied = applyOpenAtLogin(p.openAtLogin, {
      platform: process.platform,
      setLoginItemSettings: (settings) => app.setLoginItemSettings(settings),
      configHome: process.env.XDG_CONFIG_HOME || path.join(app.getPath('home'), '.config'),
      exec: process.env.APPIMAGE || process.execPath,
    });
    if (applied) desktopSettings = { ...desktopSettings, openAtLogin: p.openAtLogin };
    else logStartup('open at login: could not be changed');
  }
  saveDesktopSettings(app.getPath('userData'), desktopSettings);
  return backgroundSettingsView();
});

// The first time closing hides the window on Windows or Linux, say so: the
// app is still running in the tray.
function noteFirstBackgroundHide(): void {
  if (IS_MAC || desktopSettings.backgroundNoticeShown) return;
  desktopSettings = { ...desktopSettings, backgroundNoticeShown: true };
  saveDesktopSettings(app.getPath('userData'), desktopSettings);
  if (!Notification.isSupported()) return;
  new Notification({
    title: label('backgroundTitle', 'thingGLANCE is still running'),
    body: label('backgroundBody', 'Reminders keep coming while the window is closed. Open thingGLANCE from the tray.'),
  }).show();
}

// ── Writes from outside the window (docs/desktop.md) ────────────────────────
// The tray's and the notifications' writes, applied by the page through the
// one door every outside write uses and acknowledged only once handled
// (commandQueue.ts).
const commands = createCommandQueue({
  file: path.join(app.getPath('userData'), 'commands.json'),
  newId: () => crypto.randomUUID(),
});

function queueCommand(action: string, payload: Record<string, unknown>, source: CommandSource): void {
  const command = commands.enqueue(action, payload, source);
  if (!command) return;
  logStartup(`write queued: ${action} from ${source}`);
  live(mainWindow)?.webContents.send('commands:queued');
}

// The queue as the page's collector reads Android's: a JSON array of
// { action, payload, clientId }.
ipcMain.handle('commands:take', (event) => (isMainWindowSender(event.sender) ? JSON.stringify(commands.take()) : '[]'));
ipcMain.handle('commands:ack', (event, ids: unknown) => {
  if (isMainWindowSender(event.sender)) commands.ack(ids);
});

// ── Links (docs/desktop.md, "Links") ────────────────────────────────────────
// A thingglance:// URL, a reminder's click or a row in the tray: the link is
// kept here until the page takes it, and the page opens it through openLink()
// like one from anywhere else. Main does not read where it goes.
let pendingLink: string | null = acceptDeepLink(deepLinkFromArgv(process.argv));

/** Show the window and, with a link, have the page open it. */
function openLink(link: string | null): void {
  if (link) pendingLink = link;
  if (!app.isReady()) return;
  showMainWindow();
  if (link) live(mainWindow)?.webContents.send('links:open');
}

function openDeepLinkUrl(url: unknown): void {
  const link = acceptDeepLink(url);
  if (!link) logStartup('link refused');
  openLink(link);
}

// macOS hands URLs over as an event, possibly before the app is ready.
app.on('open-url', (event, url) => {
  event.preventDefault();
  openDeepLinkUrl(url);
});

ipcMain.handle('links:consume', (event) => {
  if (!isMainWindowSender(event.sender)) return { link: null };
  const link = pendingLink;
  pendingLink = null;
  return { link };
});

// ── Reminders (docs/desktop.md, "Reminders") ────────────────────────────────
// The plan is the snapshot's (reminderScheduler.ts); main shows each one as a
// system notification when it is due. A click opens the date; on macOS its
// buttons are real: "Done" and "Send to dayGLANCE" queue the same writes a
// widget's do. Windows and Linux get click-to-open only.
const shownNotifications = new Set<Notification>();

function showReminder(r: PlannedReminder, words: ReminderWords): void {
  if (!Notification.isSupported()) return;
  const actions = IS_MAC ? [{ kind: 'decide', text: words.done }, ...(words.canSend ? [{ kind: 'send', text: words.send }] : [])] : [];
  const n = new Notification({ title: r.title, body: r.body, actions: actions.map((a) => ({ type: 'button' as const, text: a.text })) });
  // Held until it is answered: a notification collected early loses its handlers.
  shownNotifications.add(n);
  const done = () => { shownNotifications.delete(n); };
  n.on('click', () => { done(); openLink(r.link); });
  n.on('action', (_event, index) => {
    done();
    const action = actions[index];
    if (action?.kind === 'decide') decideFrom(r.eventKey, 'notification');
    else if (action?.kind === 'send') sendFrom(r.eventKey, 'notification');
  });
  n.on('close', done);
  n.show();
  logStartup(`reminder ${r.id} shown`);
}

const reminders = createReminderScheduler({
  file: path.join(app.getPath('userData'), 'reminders.json'),
  fire: showReminder,
  log: logStartup,
});

// What is scheduled, for Settings to show and the tests to check.
ipcMain.handle('reminders:pending', (event) => (isMainWindowSender(event.sender) ? reminders.pending() : []));
ipcMain.handle('reminders:supported', (event) => isMainWindowSender(event.sender) && Notification.isSupported());

// ── The tray (docs/desktop.md, "The tray") ──────────────────────────────────
// A widget: it shows the payload the main window pushes and never opens the
// database (trayModel.ts). macOS gets a menu bar icon and Windows a tray icon,
// each with a popup (app://thingglance/?tray=1, src/tray/); Linux gets a menu
// only, since AppIndicator does not deliver clicks reliably there.
let tray: Tray | null = null;
let trayWindow: BrowserWindow | null = null;
let trayPayload: TrayPayload | null = null;
// Done from outside the window and not yet in a snapshot: a date's key, and when.
const decidedHere = new Map<string, number>();
const sentHere = new Map<string, number>();
// When blur last hid the popup (the Windows click race, isClickAfterBlurHide).
let lastTrayBlurHideAt: number | null = null;
const TRAY_POPUP_SIZE = { width: 380, height: 560 };
const USE_TRAY_POPUP = process.platform !== 'linux';

function isTrayWindowSender(sender: Electron.WebContents): boolean {
  return sender === live(trayWindow)?.webContents;
}

function currentTrayState() {
  return { ...trayState(trayPayload, { decided: decidedHere, sent: sentHere }), assistant: currentIntegrationsView().assistant };
}

function trayIconPath(name: string): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'tray', name)
    : path.join(__dirname, '..', 'electron', 'resources', 'tray', name);
}

/**
 * The assistant's items, while the MCP server is on or there is something to
 * undo: undo everything assistants changed this session, and turn the server
 * off, without opening the window (docs/mcp.md, "What you can see").
 */
function mcpTrayItems(): Electron.MenuItemConstructorOptions[] {
  const changes = mcpJournal.entries().length;
  const bound = mcpGates(integrationsConfig).bound;
  if (!bound && changes === 0) return [];
  return [
    ...(changes > 0 ? [{ label: `${label('trayMcpUndo', 'Undo assistant changes')} (${changes})`, click: () => { void undoMcpWrites(); } }] : []),
    ...(bound ? [{ label: label('trayMcpOff', 'Turn off assistant access'), click: () => { runIntegrationsTransition({ type: 'set-mcp-read-tier', tier: 'off' }); } }] : []),
    { type: 'separator' },
  ];
}

function trayMenu(withEvents: boolean): Menu {
  const items = trayMenuItems(currentTrayState(), {
    open: label('trayOpen', 'Open thingGLANCE'),
    quit: label('trayQuit', 'Quit thingGLANCE'),
    done: label('trayDone', 'Done with this'),
    nothingWaiting: label('trayNothingWaiting', 'Nothing waiting on a decision'),
  }, withEvents);
  return Menu.buildFromTemplate([...mcpTrayItems(), ...items.map((item): Electron.MenuItemConstructorOptions => {
    switch (item.kind) {
      case 'open': return { label: item.label, click: () => showMainWindow() };
      case 'quit': return { label: item.label, click: () => app.quit() };
      case 'empty': return { label: item.label, enabled: false };
      case 'event': return {
        label: item.label,
        submenu: [
          { label: item.done, click: () => decideFrom(item.key, 'tray') },
          { label: item.open, click: () => openLink(acceptDeepLink(item.link)) },
        ],
      };
      default: return { type: 'separator' };
    }
  })]);
}

function refreshTray(): void {
  if (!tray || tray.isDestroyed()) return;
  const state = currentTrayState();
  tray.setToolTip(state.waiting > 0 ? `thingGLANCE · ${label('trayWaiting', '{{n}} waiting on a decision').replace('{{n}}', String(state.waiting))}` : 'thingGLANCE');
  if (!USE_TRAY_POPUP) tray.setContextMenu(trayMenu(true));
  live(trayWindow)?.webContents.send('tray:state', state);
}

/** "Done with this", from the tray or a reminder: hidden here at once, applied by the page. */
function decideFrom(key: unknown, source: CommandSource): void {
  // A reminder can outlive the snapshot that listed its date; the tray acts only on what it shows.
  if (typeof key !== 'string' || !key || (source === 'tray' && !trayEvent(trayPayload, key))) return;
  decidedHere.set(key, Date.now());
  queueCommand('decide', { event_key: key, state: 'done' }, source);
  refreshTray();
}

/** "Send to dayGLANCE": marked sent here at once, sent by the page. */
function sendFrom(key: unknown, source: CommandSource): void {
  if (typeof key !== 'string' || !key || (source === 'tray' && !trayEvent(trayPayload, key))) return;
  if (!(trayPayload?.words.canSend ?? true)) return;
  sentHere.set(key, Date.now());
  queueCommand('send', { event_key: key }, source);
  refreshTray();
}

function createTrayWindow(): BrowserWindow {
  const w = new BrowserWindow({
    ...TRAY_POPUP_SIZE,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: windowBackgroundColor(app.getPath('userData'), nativeTheme.shouldUseDarkColors),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV,
      additionalArguments: [
        `${DESKTOP_INFO_ARG}${encodeDesktopInfo({ version: app.getVersion(), isMAS: process.mas === true, secureStorage: isSecureStorageUsable() })}`,
      ],
    },
  });
  trayWindow = w;
  w.on('blur', () => {
    if (DEV && w.webContents.isDevToolsOpened()) return;
    if (w.isVisible()) lastTrayBlurHideAt = Date.now();
    w.hide();
  });
  w.webContents.setWindowOpenHandler(({ url }) => { openExternalSafe(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (event) => event.preventDefault());
  w.webContents.on('render-process-gone', (_e, details) => {
    logStartup(`tray render-process-gone: reason=${details.reason}`);
    if (!isQuitting && live(trayWindow) === w) { w.destroy(); trayWindow = null; }
  });
  void w.loadURL(`${DEV ? VITE_DEV_SERVER_URL : APP_BASE_URL}?tray=1`);
  return w;
}

function toggleTrayPopup(fromIconClick = false): void {
  if (!tray) return;
  const w = live(trayWindow) ?? createTrayWindow();
  if (w.isVisible()) { w.hide(); return; }
  // Windows: the click that just blurred the popup closed is this click.
  if (fromIconClick && process.platform === 'win32' && isClickAfterBlurHide(Date.now(), lastTrayBlurHideAt)) return;
  const icon = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: icon.x, y: icon.y });
  const at = popupPosition(icon, TRAY_POPUP_SIZE, display.workArea);
  w.setPosition(at.x, at.y);
  w.webContents.send('tray:state', currentTrayState());
  w.show();
  w.focus();
  // The popup puts the cursor in its search field (src/tray/TrayPopup.tsx).
  w.webContents.send('tray:shown');
}

function createTray(): void {
  const image = IS_MAC
    ? nativeImage.createFromPath(trayIconPath('trayTemplate.png'))
    : nativeImage.createFromPath(trayIconPath('tray@2x.png'));
  if (IS_MAC) image.setTemplateImage(true);
  tray = new Tray(image);
  tray.setToolTip('thingGLANCE');
  if (USE_TRAY_POPUP) {
    tray.on('click', () => toggleTrayPopup(true));
    tray.on('right-click', () => tray?.popUpContextMenu(trayMenu(false)));
  }
  refreshTray();
}

// The main window's payload (src/native/desktopShell.ts): what the tray shows,
// and the reminder plan the scheduler is made to match.
ipcMain.on('widget:update-snapshot', (event, json: unknown) => {
  if (!isMainWindowSender(event.sender)) return;
  const payload = parseTrayPayload(json);
  if (!payload) return;
  trayPayload = payload;
  const now = Date.now();
  for (const key of settledHere(decidedHere, payload, 'decided', now)) decidedHere.delete(key);
  for (const key of settledHere(sentHere, payload, 'sent', now)) sentHere.delete(key);
  reminders.sync(payload.reminders, payload.words);
  refreshTray();
});

// The popup's calls: its state, Done, Send, open a link, close.
ipcMain.handle('tray:state', (event) => (isTrayWindowSender(event.sender) ? currentTrayState() : null));
ipcMain.on('tray:decide', (event, key: unknown) => {
  if (isTrayWindowSender(event.sender)) decideFrom(key, 'tray');
});
ipcMain.on('tray:send', (event, key: unknown) => {
  if (isTrayWindowSender(event.sender)) sendFrom(key, 'tray');
});
ipcMain.on('tray:open', (event, link: unknown) => {
  if (!isTrayWindowSender(event.sender)) return;
  live(trayWindow)?.hide();
  openLink(acceptDeepLink(link));
});
ipcMain.on('tray:hide', (event) => {
  if (isTrayWindowSender(event.sender)) live(trayWindow)?.hide();
});

// ── Local integrations (docs/mcp.md) ────────────────────────────────────────
// The MCP server and the Stream Deck listener, both off until turned on in
// Settings. localIntegrations.ts decides; this applies.
let integrationsConfig: LocalIntegrationsConfig = DEFAULT_LOCAL_INTEGRATIONS;
const integrationsStatus: { mcp: ListenerStatus; streamDeck: ListenerStatus } = {
  mcp: { running: false, error: null },
  streamDeck: { running: false, error: null },
};

function currentIntegrationsView() {
  return integrationsView(integrationsConfig, integrationsStatus, { writesPaused: mcpGate.writesDisabled(), undoable: mcpJournal.entries().length });
}

function pushIntegrationsStatus(): void {
  live(mainWindow)?.webContents.send('local-integrations:status', currentIntegrationsView());
  // The tray popup's indicator and the menu's assistant items follow it.
  refreshTray();
}

// The MCP listener (mcpServer.ts). The bridge to the page is made once and
// kept across stops and starts; the token is read on every request, so a new
// one needs no restart.
let mcpServerHandle: http.Server | null = null;
let mcpBridge: HostBridge | null = null;
// Writes: made once and kept across stops and starts, so turning the server
// off and on cannot reset the rate limit or the replay window. The journal is
// the session's: a restart clears it.
const mcpGate = createWriteGate();
const mcpStore = createIdempotencyStore<Record<string, unknown>>();
const mcpJournal = createJournal();

function pushJournal(): void {
  live(mainWindow)?.webContents.send('mcp-journal:changed', mcpJournal.snapshot());
  pushIntegrationsStatus();
}

/** Undo one item's changes, or all of them, newest first, through the page. */
async function undoMcpWrites(groupKey?: string): Promise<{ ok: boolean; undone?: number; skipped?: unknown[]; error?: string }> {
  const { ops, seqs } = mcpJournal.plan(groupKey);
  if (ops.length === 0) return { ok: true, undone: 0, skipped: [] };
  mcpBridge ??= createRendererBridge(() => live(mainWindow));
  const r = await mcpBridge.request('undo_mcp_writes', { ops }, 10_000);
  if (!r.ok) return { ok: false, error: r.error.code };
  mcpJournal.remove(seqs);
  pushJournal();
  const data = (r.data ?? {}) as { undone?: number; skipped?: unknown[] };
  logStartup(`mcp undo: ${data.undone ?? 0} undone, ${data.skipped?.length ?? 0} kept`);
  return { ok: true, undone: data.undone ?? 0, skipped: data.skipped ?? [] };
}

// The discovery file (mcpDiscovery.ts): where the stdio bridge finds the port
// and token. Written while the server runs, kept current, removed when it
// stops; never on the Mac App Store build. A run on a profile of its own (the
// tests) keeps the file there, never where a person's copy writes it.
const MCP_DISCOVERY_FILE = process.env['THINGGLANCE_USER_DATA_DIR']
  ? path.join(app.getPath('userData'), 'mcp.json')
  : discoveryFilePath(process.platform, process.env, app.getPath('home'), process.mas === true);

function updateDiscoveryFile(): void {
  const running = integrationsStatus.mcp.running && mcpGates(integrationsConfig).bound;
  const failure = syncDiscoveryFile(MCP_DISCOVERY_FILE, running ? { port: mcpPort(integrationsConfig), token: integrationsConfig.mcp.token ?? '' } : null);
  if (failure) logStartup(`mcp discovery file not updated: ${failure}`);
}

function setMcpStatus(status: ListenerStatus): void {
  integrationsStatus.mcp = status;
  updateDiscoveryFile();
  pushIntegrationsStatus();
}

function startMcpListener(): void {
  if (mcpServerHandle || !mcpGates(integrationsConfig).bound) return;
  mcpBridge ??= createRendererBridge(() => live(mainWindow));
  const srv = startMcpServer({
    token: () => integrationsConfig.mcp.token ?? '',
    portOverride: integrationsConfig.mcp.portOverride,
    version: app.getVersion(),
    readDeps: {
      bridge: mcpBridge,
      now: () => Date.now(),
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    writeDeps: {
      bridge: mcpBridge,
      gate: mcpGate,
      store: mcpStore,
      token: () => integrationsConfig.mcp.token ?? '',
      includeWrites: () => mcpGates(integrationsConfig).includeWrites,
      onWritesDisabled: () => {
        logStartup('mcp: writes turned off after repeated rate-limit overruns, until restart');
        pushIntegrationsStatus();
      },
      journal: mcpJournal,
      onWrite: pushJournal,
    },
    log: logStartup,
    logError: logStartup,
  });
  if (!srv) { setMcpStatus({ running: false, error: 'bind_failed' }); return; }
  mcpServerHandle = srv;
  srv.on('listening', () => { if (mcpServerHandle === srv) setMcpStatus({ running: true, error: null }); });
  srv.on('error', (err) => {
    if (mcpServerHandle !== srv) return;
    mcpServerHandle = null;
    try { srv.close(); } catch { /* never bound */ }
    setMcpStatus({ running: false, error: bindErrorCode(err) });
  });
}

/** Stop and free the port at once, so a restart on the same port does not race its own rebind. */
function stopMcpListener(onClosed?: () => void): void {
  const srv = mcpServerHandle;
  mcpServerHandle = null;
  integrationsStatus.mcp = { running: false, error: null };
  updateDiscoveryFile();
  if (!srv) { onClosed?.(); return; }
  srv.close(() => onClosed?.());
  srv.closeAllConnections();
}

function applyMcpEffect(effect: McpEffect): void {
  if (effect === 'start') startMcpListener();
  else if (effect === 'stop') stopMcpListener();
  else if (effect === 'restart') stopMcpListener(() => startMcpListener());
}

// The Stream Deck listener is not built yet: its switch is kept, and logged.
function applyStreamDeckEffect(effect: StreamDeckEffect): void {
  if (effect !== 'none') logStartup(`stream deck: ${effect} (no listener in this build)`);
}

function applyListenerEffects(effects: { mcp: McpEffect; streamDeck: StreamDeckEffect }): void {
  applyMcpEffect(effects.mcp);
  applyStreamDeckEffect(effects.streamDeck);
}

/** Read the file and start whatever it turns on. Once, at ready. */
function startLocalIntegrations(): void {
  const { config, recovered } = loadLocalIntegrations(app.getPath('userData'));
  if (recovered) logStartup('local-integrations.json was unreadable: set aside as .corrupt, everything off');
  integrationsConfig = config;
  applyListenerEffects(listenerEffects(DEFAULT_LOCAL_INTEGRATIONS, config));
}

/** Apply one Settings change: save it, start or stop what it says, and tell the page. */
function runIntegrationsTransition(action: unknown) {
  const result = applyTransition(integrationsConfig, action, {
    now: () => new Date().toISOString(),
    newToken: () => crypto.randomBytes(32).toString('hex'),
  });
  if (!result.ok) return { ok: false, error: result.error, view: currentIntegrationsView() };
  const before = integrationsConfig;
  integrationsConfig = result.config;
  if (!saveLocalIntegrations(app.getPath('userData'), integrationsConfig)) logStartup('local-integrations.json could not be written; this session follows the change');
  applyListenerEffects(listenerEffects(before, integrationsConfig));
  // A new token reaches the file at once; a start or a port change does when the listener binds.
  updateDiscoveryFile();
  pushIntegrationsStatus();
  return { ok: true, view: currentIntegrationsView() };
}

ipcMain.handle('local-integrations:get', (event) => (isMainWindowSender(event.sender) ? currentIntegrationsView() : null));
ipcMain.handle('local-integrations:transition', (event, action: unknown) =>
  (isMainWindowSender(event.sender) ? runIntegrationsTransition(action) : { ok: false, error: 'invalid_action', view: null }));

// The MCP write journal, for Settings: what assistants changed, and undo.
ipcMain.handle('mcp-journal:get', (event) => (isMainWindowSender(event.sender) ? mcpJournal.snapshot() : null));
ipcMain.handle('mcp-journal:undo', (event, groupKey: unknown) => {
  if (!isMainWindowSender(event.sender)) return { ok: false, error: 'invalid_sender' };
  return undoMcpWrites(typeof groupKey === 'string' ? groupKey : undefined);
});

// The smoke test opens the popup as a click on the icon would: a tray icon
// cannot be clicked from a test. Only with the variable set, never in a
// person's copy.
if (process.env['THINGGLANCE_SMOKE_HOOKS'] === '1') {
  (globalThis as Record<string, unknown>).__thingglanceSmoke = { toggleTrayPopup: () => toggleTrayPopup() };
}

// ── Global shortcuts (docs/desktop.md, "Shortcuts") ─────────────────────────
// Two, both off until the user records one in Settings: open the popup and
// show the window. Kept in desktop-settings.json and registered here at
// launch, so they work before the page has loaded. The popup exists on macOS
// and Windows; Linux has the window shortcut only. A shortcut another app
// already holds cannot be registered, and the page says so.
type ShortcutKind = 'popup' | 'window';
const shortcutHandlers: Record<ShortcutKind, () => void> = {
  popup: () => toggleTrayPopup(),
  window: () => showMainWindow(),
};
const registeredShortcuts: Record<ShortcutKind, string> = { popup: '', window: '' };

/** Register (or clear, with '') one shortcut. The old one stays if the new one cannot be had. */
function applyShortcut(kind: ShortcutKind, accelerator: string): boolean {
  if (kind === 'popup' && !USE_TRAY_POPUP && accelerator) return false;
  if (accelerator === registeredShortcuts[kind]) return true;
  if (accelerator) {
    let ok = false;
    try { ok = globalShortcut.register(accelerator, shortcutHandlers[kind]); } catch { ok = false; }
    if (!ok) { logStartup(`global shortcut ${accelerator} (${kind}) could not be registered`); return false; }
  }
  if (registeredShortcuts[kind]) {
    try { globalShortcut.unregister(registeredShortcuts[kind]); } catch { /* already gone */ }
  }
  registeredShortcuts[kind] = accelerator;
  return true;
}

function shortcutsView() {
  return { popup: registeredShortcuts.popup, window: registeredShortcuts.window, popupSupported: USE_TRAY_POPUP };
}

ipcMain.handle('shell:get-shortcuts', (event) => (isMainWindowSender(event.sender) ? shortcutsView() : null));
ipcMain.handle('shell:set-shortcut', (event, kind: unknown, accelerator: unknown) => {
  if (!isMainWindowSender(event.sender) || (kind !== 'popup' && kind !== 'window')) return { ok: false, ...shortcutsView() };
  if (accelerator !== '' && !isAcceleratorText(accelerator)) return { ok: false, ...shortcutsView() };
  const ok = applyShortcut(kind, accelerator as string);
  if (ok) {
    desktopSettings = { ...desktopSettings, [kind === 'popup' ? 'popupShortcut' : 'windowShortcut']: accelerator as string };
    saveDesktopSettings(app.getPath('userData'), desktopSettings);
  }
  return { ok, ...shortcutsView() };
});

// The "update available" notice (updateCheck.ts): direct builds only; the App
// Store updates the Mac App Store build. Answers from a cache within the hour,
// and never throws: a failed check is simply no notice.
let updateCache: { at: number; result: AvailableUpdate | null } | null = null;
ipcMain.handle('shell:latest-release', async (event) => {
  if (!isMainWindowSender(event.sender) || process.mas) return null;
  if (updateCache && Date.now() - updateCache.at < CHECK_CACHE_MS) return updateCache.result;
  try {
    const res = await net.fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'thingGLANCE-desktop' } });
    const result = res.ok ? availableUpdate(await res.json(), app.getVersion(), process.platform) : null;
    updateCache = { at: Date.now(), result };
    return result;
  } catch {
    return null;
  }
});

// "Owned since" (ownership.ts): the Mac App Store build says it was bought,
// once, for the record. Every other build answers with nothing.
ipcMain.handle('ownership:get', (event) => {
  if (!isMainWindowSender(event.sender)) return {};
  return ensureOwnership({ file: path.join(app.getPath('userData'), OWNED_FILE), isStoreBuild: process.mas === true, now: Date.now(), version: app.getVersion() }) ?? {};
});

// The page's foreground kicks never fire for a hidden window, or on a resume
// with the window already up: tell it the machine woke or the window came
// back. A reminder that came due during a sleep fires on the same signal.
function sendWake(why: string): void {
  if (why !== 'show') reminders.rearm();
  live(mainWindow)?.webContents.send('shell:wake', why);
}

ipcMain.on('shell:set-theme', (event, dark: unknown) => {
  if (!isMainWindowSender(event.sender) || typeof dark !== 'boolean') return;
  saveWindowTheme(app.getPath('userData'), dark);
  live(mainWindow)?.setBackgroundColor(windowBackgroundColor(app.getPath('userData'), nativeTheme.shouldUseDarkColors));
});

// Escape leaves native fullscreen, which macOS does not do by itself. The page
// asks only for an Escape that closed nothing. A no-op when not fullscreen.
ipcMain.on('shell:exit-fullscreen', (event) => {
  const w = live(mainWindow);
  if (!isMainWindowSender(event.sender) || !w?.isFullScreen()) return;
  w.setFullScreen(false);
});

// The page's lines for the log file (src/native/desktop.ts, desktopLog), so a
// report from a real machine can be traced. Capped per session; a line is cut
// at 500 characters.
const RENDERER_LOG_LINES_PER_SESSION = 500;
let rendererLogLines = 0;
ipcMain.on('shell:log', (event, message: unknown) => {
  if (!isMainWindowSender(event.sender) || typeof message !== 'string') return;
  if (rendererLogLines >= RENDERER_LOG_LINES_PER_SESSION) return;
  rendererLogLines += 1;
  logStartup(`page: ${message.replace(/\s+/g, ' ').slice(0, 500)}${rendererLogLines === RENDERER_LOG_LINES_PER_SESSION ? ' (page log limit reached for this session)' : ''}`);
});

// ── Network (docs/desktop.md, "Every request through main") ─────────────────
// The renderer's only way out: the vault, intents, the roster and the product
// lookups all arrive here as `http:request`. networkTrust.ts decides which
// servers may be reached (a private address only once the user grants it);
// httpProxy.ts makes the request.

// Every A/AAAA record, so a public name with a private record is caught.
// dns.lookup goes through the OS resolver, which is what resolves Tailscale
// MagicDNS names (host.tailnet.ts.net).
async function resolveHostAddresses(host: string): Promise<string[]> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (nodeNet.isIP(bare)) return [bare];
  return (await dns.promises.lookup(bare, { all: true })).map(({ address }) => address);
}

let networkTrust: NetworkTrust | null = null;
function trust(): NetworkTrust {
  networkTrust ??= createNetworkTrust({
    grantsFile: path.join(app.getPath('userData'), 'proxy-trusted-hosts.json'),
    resolve: resolveHostAddresses,
    confirm: async ({ title, message, detail, allow, cancel }) => {
      const options: Electron.MessageBoxOptions = {
        type: 'warning', buttons: [cancel, allow], defaultId: 0, cancelId: 0, title, message, detail,
      };
      const parent = live(mainWindow);
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return response === 1;
    },
    log: logStartup,
  });
  return networkTrust;
}

const httpRequest = createHttpProxy({
  send: (url, init) => net.fetch(url, init),
  validate: (url, isRedirect) => trust().validate(url, isRedirect),
});

ipcMain.handle('http:request', (event, method: unknown, url: unknown, headers: unknown, body: unknown) => {
  if (!isMainWindowSender(event.sender)) return { error: 'Not allowed from this window' };
  return httpRequest(method, url, headers, body);
});

ipcMain.handle('http:inspect', (event, url: unknown) => {
  if (!isMainWindowSender(event.sender) || typeof url !== 'string') return { blocked: false };
  return trust().inspect(url);
});

// The only path to the permission dialog, called from the "Allow this
// address" button where the vault is connected.
ipcMain.handle('http:grant', (event, url: unknown, labels: unknown) => {
  if (!isMainWindowSender(event.sender) || typeof url !== 'string') return { ok: false, reason: 'Invalid URL' };
  return trust().request(url, labels);
});

ipcMain.handle('http:grants', (event) => (isMainWindowSender(event.sender) ? trust().list() : []));

ipcMain.handle('http:revoke', (event, origin: unknown) => {
  if (!isMainWindowSender(event.sender) || typeof origin !== 'string') return { ok: false };
  return trust().revoke(origin);
});

// GLANCEvault's live event stream, read here and relayed to the renderer in
// the same message shapes the Android shell passes in (src/native/vaultSse.ts).
const vaultSse = createVaultSseReader({
  fetch: (url, init) => net.fetch(url, init),
  validate: (url) => trust().validate(url, false),
  push: (message) => {
    if (message.type === 'error') logStartup(`vault SSE: ${message.code ?? 'error'}: ${message.message}`);
    live(mainWindow)?.webContents.send('vault-sse:message', message);
  },
});

ipcMain.handle('vault-sse:start', (event, options: unknown) => {
  if (!isMainWindowSender(event.sender) || !options || typeof options !== 'object') return;
  const { vaultUrl, vaultToken, accountId } = options as Record<string, unknown>;
  if (typeof vaultUrl !== 'string' || typeof vaultToken !== 'string' || typeof accountId !== 'string') return;
  vaultSse.start({ vaultUrl, vaultToken, accountId });
});

ipcMain.handle('vault-sse:stop', (event) => {
  if (isMainWindowSender(event.sender)) vaultSse.stop();
});

// ── Secure storage (docs/desktop.md, "Credentials") ─────────────────────────
// The app's SecureStore over safeStorage. Asked only after ready, when
// safeStorage can answer; unusable (a Linux machine without a keyring) means
// the renderer keeps its web storage, as the web build does.
function isSecureStorageUsable(): boolean {
  return secureStorageUsable(
    process.platform,
    safeStorage.isEncryptionAvailable(),
    process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined,
  );
}

let secureStore: ReturnType<typeof createSecureStore> | null = null;
function store() {
  if (!isSecureStorageUsable()) throw new Error('Secure storage is not available');
  secureStore ??= createSecureStore({
    file: path.join(app.getPath('userData'), 'secure-store.json'),
    cipher: { encrypt: (plain) => safeStorage.encryptString(plain), decrypt: (cipher) => safeStorage.decryptString(cipher) },
  });
  return secureStore;
}

// A read that fails rejects: the app tells "nothing stored" from "could not
// read" (src/sync/secrets.ts), so neither is turned into the other here.
ipcMain.handle('secure-store:get', (event, key: unknown) => {
  if (!isMainWindowSender(event.sender)) throw new Error('Not allowed from this window');
  return store().get(key);
});
ipcMain.handle('secure-store:set', (event, key: unknown, value: unknown) => {
  if (!isMainWindowSender(event.sender)) throw new Error('Not allowed from this window');
  store().set(key, value);
});
ipcMain.handle('secure-store:delete', (event, key: unknown) => {
  if (!isMainWindowSender(event.sender)) throw new Error('Not allowed from this window');
  store().delete(key);
});

// Exports through the save dialog; a silent copy into userData (files.ts).
registerFilesHandlers({
  ipcMain,
  dialog,
  getWindow: () => live(mainWindow),
  isMainWindowSender,
  downloadsDir: () => app.getPath('downloads'),
  backupsDir: () => path.join(app.getPath('userData'), 'backups'),
  log: logStartup,
});

function createWindow({ startHidden = false }: { startHidden?: boolean } = {}): BrowserWindow {
  const userData = app.getPath('userData');
  const saved = onScreen(loadWindowState(userData), screen.getAllDisplays().map((d) => d.workArea));
  didCreateMainWindow = true;
  logStartup('createWindow: called');

  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    ...(saved.x != null && saved.y != null ? { x: saved.x, y: saved.y } : {}),
    show: false,
    backgroundColor: windowBackgroundColor(userData, nativeTheme.shouldUseDarkColors),
    // The app is phone-first, so a narrow window is a real layout, not a
    // broken one; this floor keeps the header and a card column usable.
    minWidth: 360,
    minHeight: 520,
    title: 'thingGLANCE',
    ...(IS_MAC ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: DEV,
      // A hidden window keeps sync and the snapshot on their cadence.
      backgroundThrottling: false,
      // The facts the preload exposes as bridge.info (desktopInfo.ts).
      additionalArguments: [
        `${DESKTOP_INFO_ARG}${encodeDesktopInfo({ version: app.getVersion(), isMAS: process.mas === true, secureStorage: isSecureStorageUsable() })}`,
      ],
    },
  });
  mainWindow = win;

  // The last non-maximized bounds, so a maximized window restores correctly.
  let normalBounds = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  const trackBounds = () => {
    const w = live(mainWindow);
    if (w && !w.isMaximized() && !w.isMinimized() && !w.isFullScreen()) normalBounds = w.getBounds();
  };
  win.on('resize', trackBounds);
  win.on('move', trackBounds);
  win.on('close', (event) => {
    saveWindowState(userData, { ...normalBounds, maximized: live(mainWindow)?.isMaximized() ?? false });
    if (closeAction({ platform: process.platform, isQuitting, keepRunning: desktopSettings.keepRunning }) === 'hide') {
      // Closing hides (backgroundMode.ts). Hiding a fullscreen window strands
      // its Space as a black screen on macOS, so leave fullscreen first.
      event.preventDefault();
      const w = live(mainWindow);
      if (!w) return;
      if (w.isFullScreen()) {
        w.once('leave-full-screen', () => live(mainWindow)?.hide());
        w.setFullScreen(false);
      } else {
        w.hide();
      }
      noteFirstBackgroundHide();
    }
  });
  win.on('show', () => sendWake('show'));

  if (saved.maximized) win.maximize();

  // Show after the first paint (no white frame), with a fallback so a renderer
  // that never paints still leaves a visible, reportable window.
  const SHOW_FALLBACK_MS = 10_000;
  let shown = false;
  const showOnce = (why: string) => {
    if (shown) return;
    shown = true;
    // An open-at-login start on Windows or Linux stays in the tray.
    if (startHidden) { logStartup(`main window kept hidden (${why}, started at login)`); return; }
    logStartup(`main window show (${why})`);
    live(mainWindow)?.show();
  };
  const fallbackShow = setTimeout(() => showOnce('fallback-timeout'), SHOW_FALLBACK_MS);
  win.once('ready-to-show', () => { clearTimeout(fallbackShow); showOnce('ready-to-show'); });

  win.webContents.on('did-finish-load', () => logStartup('main window did-finish-load'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => logStartup(`did-fail-load: code=${code} "${desc}" url=${url}`));
  win.webContents.on('preload-error', (_e, preloadPath, err) => logStartup(`preload-error: ${preloadPath}: ${err?.message ?? err}`));

  // Crash recovery: reload, then recreate, then stop (rendererRecovery.ts).
  win.webContents.on('render-process-gone', (_e, details) => {
    logStartup(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`);
    const decision = decideRecovery({ reason: details.reason, isQuitting, attempts: mainRecoveryAttempts, now: Date.now() });
    mainRecoveryAttempts = decision.attempts;
    if (decision.action === 'ignore' || decision.action === 'give-up') {
      if (decision.action === 'give-up') logStartup('crash recovery: giving up (crash loop)');
      return;
    }
    // Deferred so a crash a moment before quit sees the flag before-quit sets.
    setTimeout(() => {
      if (isQuitting) return;
      const w = live(mainWindow);
      if (!w) return;
      logStartup(`crash recovery: ${decision.action}`);
      if (decision.action === 'reload') w.webContents.reload();
      else if (decision.action === 'load-url') void w.loadURL(DEV ? VITE_DEV_SERVER_URL : APP_BASE_URL);
      else {
        w.destroy();
        createWindow();
      }
    }, 250);
  });

  // Links leave the app for the system browser or mail client; the renderer
  // never opens a second window and never navigates off its own origin.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isSameAppOrigin(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  });

  if (DEV) {
    // Vite may not be up yet when concurrently starts Electron; keep retrying
    // a refused dev load. ERR_ABORTED (-3) is a superseded navigation.
    win.webContents.on('did-fail-load', (_e, code, _desc, url) => {
      if (code === -3 || !url?.startsWith(VITE_DEV_SERVER_URL)) return;
      setTimeout(() => { void live(mainWindow)?.loadURL(VITE_DEV_SERVER_URL); }, 1000);
    });
    void win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void win.loadURL(APP_BASE_URL);
  }
  return win;
}

function showMainWindow(): void {
  const w = live(mainWindow);
  if (!w) { createWindow(); return; }
  if (w.isMinimized()) w.restore();
  if (!w.isVisible()) w.show();
  w.focus();
}

// One process at a time: a second launch focuses the first.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = deepLinkFromArgv(argv);
    if (url) openDeepLinkUrl(url);
    else showMainWindow();
  });
}

// Without it Windows attributes notifications to "electron.app.thingGLANCE".
if (process.platform === 'win32') app.setAppUserModelId('com.thingglance.app');

app.setAboutPanelOptions({
  applicationName: 'thingGLANCE',
  applicationVersion: app.getVersion(),
  copyright: 'Copyright © 2026 GLANCE Apps',
  website: 'https://www.glance-apps.com/thingglance',
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  logStartup('app ready');

  // The CSP on every document the renderer loads over the network (dev), and
  // on the app:// document itself below: custom-scheme responses do not pass
  // through onHeadersReceived. The Vite dev server is left alone: the strict
  // policy blocks the react-refresh preamble and the HMR websocket.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (DEV && details.url.startsWith(VITE_DEV_SERVER_URL)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CONTENT_SECURITY_POLICY] } });
  });

  // The renderer asks for nothing beyond clipboard writes (copy to clipboard).
  // Notifications are the main process's own (the reminder scheduler above).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write');
  });

  // app://thingglance/... -> dist/, with SPA fallback (appProtocol.ts).
  protocol.handle(APP_SCHEME, async (request) => {
    const isFile = (p: string): boolean => {
      try { return fs.statSync(p).isFile(); } catch { return false; }
    };
    const resolved = resolveAppRequest(APP_DIST_DIR, request.url, isFile);
    if (resolved.status !== 200 || !resolved.filePath) {
      return new Response(resolved.status === 403 ? 'Forbidden' : 'Not found', {
        status: resolved.status,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
    try {
      const data = await fs.promises.readFile(resolved.filePath);
      const headers: Record<string, string> = { 'Content-Type': resolved.contentType || 'application/octet-stream' };
      if (resolved.contentType?.startsWith('text/html')) headers['Content-Security-Policy'] = CONTENT_SECURITY_POLICY;
      return new Response(data, { status: 200, headers });
    } catch {
      return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  });

  // thingglance:// opens this app. A dev run registers the Electron binary
  // with the app's entry, as Windows and Linux need.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }

  // A link that launched the app opens the window even at login.
  createWindow({ startHidden: !IS_MAC && launchedHidden(process.argv) && !pendingLink });

  createTray();

  // The global shortcuts saved last time.
  if (desktopSettings.popupShortcut) applyShortcut('popup', desktopSettings.popupShortcut);
  if (desktopSettings.windowShortcut) applyShortcut('window', desktopSettings.windowShortcut);
  // globalShortcut throws before ready, and will-quit can fire then (dayGLANCE
  // issue #1352); before ready nothing is registered, so there is nothing to free.
  app.on('will-quit', () => { if (app.isReady()) globalShortcut.unregisterAll(); });

  // The MCP server, when Settings turned it on.
  startLocalIntegrations();
  app.on('will-quit', () => { stopMcpListener(); });

  // Reminders due while the app was not running: within 12 hours fire once.
  reminders.rearm();
  app.on('will-quit', () => reminders.stop());

  // A woken machine or an unlocked screen: the page's foreground kicks.
  powerMonitor.on('resume', () => sendWake('resume'));
  powerMonitor.on('unlock-screen', () => sendWake('unlock'));

  app.on('activate', () => showMainWindow());
});

app.on('before-quit', () => {
  isQuitting = true;
  vaultSse.stop();
});

app.on('window-all-closed', () => {
  if (shouldQuitOnAllWindowsClosed(process.platform, didCreateMainWindow)) {
    logStartup('window-all-closed: quit');
    app.quit();
  }
});
