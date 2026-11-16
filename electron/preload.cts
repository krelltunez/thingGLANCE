// The thingGLANCE desktop bridge: the one object the renderer sees, as
// `window.thingglanceDesktop` (docs/desktop.md). The renderer's types and the
// method allowlist are src/native/desktop.ts, and bridgeContract.test.ts holds
// this file, that one and main.ts's IPC handlers to the same list.
//
// Sandboxed: this script may import only `electron`, so it decodes the info
// switch itself rather than importing electron/desktopInfo.ts. Keep each group
// a flat object literal of `name: (...) => ...` entries; the contract test
// reads them from the source.

import { contextBridge, ipcRenderer } from 'electron';

const DESKTOP_INFO_ARG = '--thingglance-desktop-info=';

function readInfo(): { version: string; isMAS: boolean; secureStorage: boolean } {
  const arg = process.argv.find((a) => a.startsWith(DESKTOP_INFO_ARG));
  try {
    const parsed = JSON.parse(decodeURIComponent((arg ?? '').slice(DESKTOP_INFO_ARG.length)));
    if (typeof parsed?.version === 'string' && typeof parsed?.isMAS === 'boolean' && typeof parsed?.secureStorage === 'boolean') {
      return { version: parsed.version, isMAS: parsed.isMAS, secureStorage: parsed.secureStorage };
    }
  } catch { /* absent or malformed: fall through */ }
  return { version: '', isMAS: false, secureStorage: false };
}

const info = readInfo();

// A main-to-renderer event as a listener the renderer can remove: returns the
// unsubscribe function. The IPC event object never reaches the page.
function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

contextBridge.exposeInMainWorld('thingglanceDesktop', {
  info: {
    platform: process.platform,
    version: info.version,
    isMAS: info.isMAS,
    secureStorage: info.secureStorage,
  },
  shell: {
    setMenuLabels: (labels: Record<string, string>) => ipcRenderer.send('shell:set-menu-labels', labels),
    setTheme: (dark: boolean) => ipcRenderer.send('shell:set-theme', dark),
    exitFullscreen: () => ipcRenderer.send('shell:exit-fullscreen'),
    log: (message: string) => ipcRenderer.send('shell:log', message),
    onWake: (listener: (payload: unknown) => void) => subscribe('shell:wake', listener),
  },
  http: {
    request: (method: string, url: string, headers: Record<string, string>, body: string | null) => ipcRenderer.invoke('http:request', method, url, headers, body),
    inspect: (url: string) => ipcRenderer.invoke('http:inspect', url),
    grant: (url: string, labels: Record<string, string>) => ipcRenderer.invoke('http:grant', url, labels),
    grants: () => ipcRenderer.invoke('http:grants'),
    revoke: (origin: string) => ipcRenderer.invoke('http:revoke', origin),
  },
  vaultSse: {
    start: (options: { vaultUrl: string; vaultToken: string; accountId: string }) => ipcRenderer.invoke('vault-sse:start', options),
    stop: () => ipcRenderer.invoke('vault-sse:stop'),
    onMessage: (listener: (message: unknown) => void) => subscribe('vault-sse:message', listener),
  },
  secureStore: {
    get: (key: string) => ipcRenderer.invoke('secure-store:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('secure-store:set', key, value),
    delete: (key: string) => ipcRenderer.invoke('secure-store:delete', key),
  },
  files: {
    saveText: (options: { filename: string; text: string }) => ipcRenderer.invoke('files:save-text', options),
    stash: (options: { filename: string; text: string }) => ipcRenderer.invoke('files:stash', options),
  },
});
