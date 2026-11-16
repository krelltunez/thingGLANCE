# The desktop app

thingGLANCE on macOS, Windows and Linux is the web bundle in an Electron shell. The model is lastGLANCE's desktop app (`../lastGLANCE/docs/desktop-app.md`), which follows dayGLANCE's; the generic pieces are copied from it, each with a line at the top saying where it came from. thingGLANCE needs less of it: sync is GLANCEvault only, so there is no iCloud Drive and no Direct Access, and the app is paid up front, so there is no billing.

This page describes what is built. The phases still to come are at the end.

| Decided | Value |
| --- | --- |
| Origin | `app://thingglance`, from the first build, and it never changes |
| Application id | `com.thingglance.app` on every build, the Mac App Store one included |
| Data folder | `<appData>/thingGLANCE` |
| Electron | The same major as lastGLANCE and dayGLANCE (43) |
| Ports | 7910 for MCP and 7911 for Stream Deck, reserved for later |

## Shape

**Plain Electron**, not the Capacitor Electron wrapper. `Capacitor.isNativePlatform()` stays false on the desktop, and `shell()` (`src/native/platform.ts`) answers `'desktop'` because the bridge is there.

**One bridge object.** The preload (`electron/preload.cts`) exposes `window.thingglanceDesktop` through `contextBridge`, grouped by what each group stands in for:

| Group | What it is | Used by |
| --- | --- | --- |
| `info` | `platform`, `version`, `isMAS`, `secureStorage` | `src/native/desktop.ts` |
| `shell` | Menu labels, the theme, leaving fullscreen, a log line, the wake signal | `src/native/desktopShell.ts` |
| `http` | A request made by the main process, and the permission for a private address | `desktopFetch()`, `src/sync/privateAddress.ts` |
| `vaultSse` | The vault's live stream, read by the main process | the shell's `eventStream` |
| `secureStore` | `get`, `set`, `delete` over Electron's `safeStorage` | the shell's `secureStore` |
| `files` | A backup through the save dialog; a silent copy into the data folder | `src/db/backup.ts` |

`src/native/desktop.ts` is the contract: the interfaces, the allowlist (`DESKTOP_BRIDGE_METHODS`) and `desktopBridge()`. `src/native/desktopShell.ts` is what the app does with it, and it is the same thing `src/native/capacitor.ts` does on a phone: it calls `registerShell({ fetch, secureStore, eventStream })` before anything else runs, so the rest of the app goes on using the seams in [shells.md](shells.md) and never asks which shell it is in.

**The allowlist is held by a test.** `electron/bridgeContract.test.ts` reads the source of the preload, of `desktop.ts` and of every main-process module and fails when a method or an IPC channel exists on one side only.

## Origin, storage and loading

- **The origin is `app://thingglance`.** The scheme is registered as standard and secure before the app is ready, and `electron/appProtocol.ts` serves `dist/` with the single-page fallback and a path-traversal guard. IndexedDB and localStorage are keyed by origin, so moving it later would orphan everything a person has entered. `file://` is never shipped.
- **No service worker.** `app://` is not registered to allow one, and `settleServiceWorker()` removes any it finds outside a browser tab.
- **The CSP is set by the main process** on the `app://` document: `connect-src 'self'`, so the page can make no network request of its own. That is also a test of the next section: a request that was missed fails loudly instead of quietly meeting a server's CORS rules. The dev server is left alone so hot reload works.
- **Images are the one outside host.** A thing's photo is the Wikimedia thumbnail the lookup found, shown with an `<img>`. `img-src` allows `https://upload.wikimedia.org` and nothing else; the page's own code still cannot read or send anything there.
- **The window paints the app's background before the page does** (`electron/windowState.ts`), from the theme the page last reported, so a launch does not flash the other colour. Size and position are remembered, and a position on a display that is gone is dropped.

## Every request through main

The page's requests all go through `src/sync/shellFetch.ts`, and on the desktop the transport behind it is `bridge.http`: `net.fetch` in the main process (`electron/httpProxy.ts`), with a 30 second timeout and redirects followed by hand, each hop checked again and credentials dropped on a redirect to another origin. A request that got no response comes back as an error and the page's `fetch` rejects, as a browser's does.

So a vault needs no `app://thingglance` entry in its allowed origins, and a self-hosted one on a home network works with no CORS setup at all. `e2e/electron-vault.mjs` runs two copies of the packaged app against a vault that lists only the web dev server's origin.

**The live stream** runs in the main process too (`electron/vaultSse.ts`) and is passed to the page in the message shapes the Android shell uses, so `src/sync/vaultEventStream.ts` treats both the same.

### Servers on your own network

A page that can ask the main process to fetch any URL could be used to reach things on the local network, so the main process refuses private, loopback, carrier-grade NAT and unique-local addresses (`electron/proxyUrlPolicy.ts`, held to the table in `electron/ssrf-vectors.json`) until the user allows that one origin.

- The vault form asks first (`http.inspect`), and says the address needs permission instead of reporting a network error for a server it never contacted.
- "Allow this address…" opens a native dialog that names the origin and what it resolves to. Only that button can open it. The dialog's words come from the catalog, sent with the request; the origin and addresses are added by the main process, where no label can hide them.
- A grant covers one scheme, host and port. Allowed addresses are listed under Settings, GLANCEvault, each with Remove.
- A redirect target and a link-local address can never be allowed.

## Credentials

`bridge.secureStore` is Electron's `safeStorage`: the macOS Keychain, Windows DPAPI, or the Linux secret service. The ciphertext is in `secure-store.json` in the data folder. On a Linux machine with no keyring `safeStorage` falls back to plain text, so `info.secureStorage` is false there, the shell registers no keystore, and the app keeps its web storage as a browser does. It never claims protection it does not give.

Everything in [shells.md](shells.md#credentials) applies unchanged: the app orders and bounds every call itself, and stores opaque strings.

## The window

- macOS hides the title bar and keeps the traffic lights; the header leaves room for them and is the drag region (`html.desktop-darwin` in `src/index.css`).
- Windows and Linux keep the native frame, with an application menu in the app's language. The words are the `menu` block of the catalog, pushed by the page (`menuLabels()`); macOS keeps its own menu, which the system localizes.
- Links to the web and `mailto:` open in the system's browser and mail client. The window never navigates off its own origin and never opens a second window.
- Escape leaves fullscreen, when nothing in the app wanted the key.
- A window that stays up across a sleep never sees `visibilitychange`, which is what sync and the intents poll kick on. The main process says when the machine woke, the screen unlocked or the window was shown, and the page replays the event.

## Hardening

- Context isolation on, node integration off, a sandboxed preload.
- Every handler checks that the caller is the main window.
- One instance: a second launch focuses the first.
- A crashed page is reloaded, then the window is rebuilt, then it stops (`electron/rendererRecovery.ts`).
- Developer tools are off in packaged builds. In their place there is a bounded log in the data folder (`thingglance-startup.log`), which the page can add lines to (`desktopLog()`).

## Building and running

| Script | What it does |
| --- | --- |
| `npm run dev:electron` | Vite on port 5193 with hot reload; main and preload recompile on save and the app restarts |
| `npm run build:electron` | The installers for this OS, in `dist-app/` |
| `npm run build:electron:dir` | The unpacked app only, which is what the two tests launch |
| `npm run test:electron-smoke` | Launches the packaged app and checks what no unit test can see |
| `npm run test:electron-vault` | Two copies of the packaged app syncing through a local vault |

`vite build --mode electron` is the same bundle without the PWA plugin. Main is compiled by `tsc` (`tsconfig.electron.json`, ES modules), and the preload separately as CommonJS (`tsconfig.electron.preload.json`), because a sandboxed preload cannot be a module. The package ships no `node_modules`: the page is one bundle and main needs only Electron and Node. `electron/builderConfig.test.ts` holds that, and the rest of `electron-builder.config.cjs`, without packaging anything.

Both tests set `THINGGLANCE_USER_DATA_DIR`, which moves the data folder, so they never touch the profile of a copy someone actually uses.

Icons come from the same artwork as the web app's: `node scripts/gen-desktop-icons.mjs` writes `electron/resources/`.

Without a signing certificate a macOS build is signed ad hoc (`scripts/codesign-ad-hoc.cjs`), which turns "damaged" into "unidentified developer". With `CSC_LINK` set it is signed with the Developer ID and notarized (`scripts/notarize.cjs`).

## Still to come

1. **Background mode.** Staying alive with the window closed, opening at login, reminders scheduled by the main process from the snapshot's `reminders`, and a queue for writes that come from outside the window.
2. **The tray popup and `thingglance://` links.** The popup is drawn from the snapshot and never opens the database.
3. **Release.** The release workflow, the Mac App Store build, and the "update available" notice on direct builds.
4. **MCP, then Stream Deck**, on the same queue and snapshot.
