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
| `widget` | The payload the tray draws and the reminders are scheduled from | `startDesktopFeed()` |
| `commands` | Writes queued outside the window, for the page to apply | `collectWidgetWrites()` |
| `links` | A `thingglance://` link waiting to be opened | `followDesktopLinks()` |
| `reminders` | What the scheduler in main holds; read-only | Settings |
| `ownership` | What the Mac App Store build reports about being bought | `src/native/ownership.ts` |
| `localIntegrations` | The MCP server's and the Stream Deck listener's switches and state ([mcp.md](mcp.md), [stream-deck.md](stream-deck.md)) | `src/components/LocalIntegrations.tsx` |
| `mcp` | The MCP server's questions, and the page's answers | `src/mcp/mcpBridge.ts` |
| `mcpJournal` | What assistants changed this session, and undo | `src/components/LocalIntegrations.tsx` |
| `tray` | The popup's own calls; answered only to the popup's window | `src/tray/TrayPopup.tsx` |

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

## Staying alive

- **macOS:** closing the window hides it, as Mac apps do. It leaves fullscreen first, or the Space is left black.
- **Windows and Linux:** with "Keep running in the background" on, closing hides the window to the tray, and the first time a notification says thingGLANCE is still running. With it off, closing quits. It defaults to on, because reminders depend on it.
- **Open at login** is off by default. macOS and Windows use the system's login items; Linux gets an XDG autostart entry. Windows and Linux start hidden (`--hidden`), in the tray.
- Both settings are in Settings, General, "Desktop app", and are kept by the main process in `desktop-settings.json` (`electron/backgroundMode.ts`).
- The window is created with background throttling off, so a hidden one keeps syncing and keeps the snapshot current.

## The feed: one payload for the tray and the reminders

The main window hands the main process the same payload Android's widgets get (`desktopPayload()` in `src/native/desktopShell.ts`): the snapshot ([snapshot.md](snapshot.md)), the few words a surface adds of its own, and whether dayGLANCE can be sent to. It goes whenever the data, the household, the settings or the language change, and every 15 minutes regardless, because a date comes due with no event to say so. An unchanged payload is not sent again.

Main never opens the database and never runs sync. Everything it shows or schedules comes from that payload.

## Reminders

Which dates notify, when and on whose device is decided in `src/core/reminders.ts` and travels in the snapshot as `reminders`. The scheduler in main (`electron/reminderScheduler.ts`) only makes the desktop match that plan, exactly as Android's does: each payload replaces the schedule. Nothing is scheduled from the page.

- The plan is kept in `reminders.json`, with the words its buttons use, so a reminder still fires after a relaunch, before the page is up.
- One timer waits for the next reminder, never more than an hour, so a clock change or a sleep is caught. The schedule is checked again on resume and unlock.
- A reminder missed by less than 12 hours fires once when the app next runs. Older ones are dropped.
- What was due under the old plan fires before a new plan replaces it, and a reminder that has fired is remembered for a day, so a late snapshot can neither swallow one nor fire it twice.
- A click opens the date in the app. On macOS the notification has real buttons: "Done with this", and "Send to dayGLANCE" when dayGLANCE is connected. Windows and Linux get click-to-open only.

The reminder switch and time are the same ones in Settings as on Android. There is no permission to ask for; on a system that cannot show notifications Settings says so.

## Writes from outside the window

The tray and a reminder's buttons change data the page owns. They do it the way a widget does on Android:

1. Main appends a write to `commands.json`: an action from `handleIntent`'s vocabulary (`decide`, `send`), a payload, and a `clientId` it mints (`electron/commandQueue.ts`).
2. Main nudges the page.
3. The page takes the queue and applies each write through `dispatchExternalWrite()`, the one door every write from outside uses, with the same collector that drains Android's queue (`collectWidgetWrites()`).
4. Only then, and only after main has been handed a snapshot that reflects it, is the write acknowledged and removed.

A crash between taking and acknowledging replays the write, and the app's ledger makes the replay harmless. Meanwhile main hides a date that was ticked, or marks one sent, at once (`electron/trayModel.ts`), so the tray does not wait for the round trip. If the page has not confirmed within a minute, the date shows again.

## Links

`thingglance://` is registered with the system (`CFBundleURLTypes` on macOS, the registry on Windows, the `.desktop` file's MimeType on Linux, where an AppImage registers it only once integrated). A link arrives as `open-url` on macOS and as an argument on Windows and Linux, on a cold start or to the instance already running.

Main does not read where a link goes. It checks that it is a `thingglance://` URL of a sane length (`electron/deepLink.ts`), keeps it, shows the window, and the page takes it and calls `openLink()`: the same door as a link from anywhere else, read by the same parser (`src/core/links.ts`). A link only navigates.

## The tray

- **macOS:** a menu bar icon. A click toggles a frameless popup under the icon, which hides when it loses focus. A right click gives Open and Quit.
- **Windows:** the same popup, anchored to the tray icon.
- **Linux:** a native menu only: Open, the dates waiting on a decision each with "Done with this" and Open, and Quit. AppIndicator does not deliver clicks reliably on many desktops, so a popup cannot be anchored there.

The popup is the same bundle loaded with `?tray=1` in a window of its own (`src/tray/TrayPopup.tsx`). It is a widget: `main.tsx` starts none of the shell for it, and main answers the network, the keystore and the queue to the main window only. It draws what main holds of the payload with the app's own pieces: how many things want a decision, each of them with "Done with this" and "Send to dayGLANCE", the next few dates coming up, and the plan charges for the next 30 days. A search field looks through every thing by name and category; Enter opens the first result in the app, and Escape clears the search, then closes the popup.

## Shortcuts

Two global shortcuts, both off until one is recorded in Settings: open the popup (macOS and Windows) and show the window (everywhere). Main keeps them in `desktop-settings.json` and registers them at launch, so they work before the page has loaded. A shortcut another app already holds is reported in Settings, not silently dropped. A shortcut must include Ctrl, Alt or Cmd, or be a function key, so it cannot swallow ordinary typing (`src/native/shortcutRecorder.ts`).

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

Both tests set `THINGGLANCE_USER_DATA_DIR`, which moves the data folder, and pass `--use-mock-keychain`, so they never touch the profile or the login keychain of a copy someone actually uses. (On macOS a rebuilt, ad-hoc signed copy that reads the real keychain item stops at a system prompt, and the test hangs behind it.) The smoke test also sets `THINGGLANCE_SMOKE_HOOKS`, which lets it open the tray popup as a click on the icon would.

Icons come from the same artwork as the web app's: `node scripts/gen-desktop-icons.mjs` writes `electron/resources/`.

Without a signing certificate a macOS build is signed ad hoc (`scripts/codesign-ad-hoc.cjs`), which turns "damaged" into "unidentified developer". With `CSC_LINK` set it is signed with the Developer ID and notarized (`scripts/notarize.cjs`).

## Releasing

`package.json` is the one version, shared with Android ([release.md](release.md)). There are two kinds of desktop build:

| Build | How it ships | Price |
| --- | --- | --- |
| **Direct**: macOS (Developer ID), Windows, Linux | CI, attached to the GitHub release for a `v*` tag | Free |
| **Mac App Store** | Built on a Mac, uploaded with Transporter | Paid up front, as on Google Play; no purchases inside the app |

The parts only the publisher can do are marked **(yours)**. Release notes contain no em dashes, and their times are Mountain Time.

### Once: signing **(yours)**

**Direct macOS build.** Under the repository's Settings, Secrets and variables, Actions. Without them the macOS build is still produced, but signed ad hoc: it opens only after right-click, Open, and Gatekeeper warns. They can be the same team's values the sibling apps' workflows use.

| Secret | What it is |
| --- | --- |
| `CSC_LINK` | The Developer ID Application certificate and key, exported from Keychain Access as a `.p12`, then base64-encoded |
| `CSC_KEY_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_ID` | The Apple ID email of the developer account |
| `APPLE_APP_SPECIFIC_PASSWORD` | An app-specific password from appleid.apple.com, for the notary service |
| `APPLE_TEAM_ID` | The 10-character Team ID |

**Mac App Store build.**

- Apple Developer: an App ID `com.thingglance.app` with macOS enabled, and a Mac App Store provisioning profile for it, saved as `electron/thingglance.mas.provisionprofile`. That path is ignored by git; `MAC_PROVISIONING_PROFILE` can point elsewhere.
- In the Mac's login keychain: "Apple Distribution" (or "3rd Party Mac Developer Application") to sign the app, and "Mac Installer Distribution" (or "3rd Party Mac Developer Installer") to sign the `.pkg`.
- App Store Connect: an app record for `com.thingglance.app` with the macOS platform, priced as a paid app. When the iOS app exists under the same id, one purchase covers both.

Windows is not code-signed, so SmartScreen warns on first run, as it does for the sibling apps.

### Each release

1. Set the version in `package.json`, as for any release.
2. Run the checks: `npm run lint`, `npm test`, `npx tsc -b`, then `npm run build:electron:dir`, `npm run test:electron-smoke` and `npm run test:electron-vault`.
3. To try a packaging change first, run **Release desktop** from the Actions tab. A manual run builds all three platforms and uploads the files to the run, without touching any release.
4. Push the version tag. `release-desktop.yml` builds macOS (`dmg` and `zip`, Apple silicon and Intel), Windows (the NSIS installer) and Linux (`AppImage` and `deb`, x64 and arm64), and adds the files to the GitHub release for the tag: uploaded to it if it exists, else a new draft. A published release stays published. **(yours)** Finish the notes and publish.
5. **Mac App Store (yours)**, on a Mac with the certificates and the profile:

   ```bash
   npm run build:electron:mas
   ```

   This builds the universal `.pkg` in `dist-app/mas-universal/`, sandboxed. Its build number is `YYYYMMDD.HHMM`, so every upload is higher than the last (`BUILD_NUMBER` overrides). Upload it with Transporter, add the build to the macOS version in App Store Connect with the notes, and submit it. TestFlight for Mac takes the same build.

### No auto-update

A direct build updates by downloading the new release. It shows a small "thingGLANCE x.y.z is available" notice: the page asks every 6 hours and on return, the main process reads the GitHub releases API, and the notice links to the release page. Main reports only a published release that is newer and has a download for this OS, so an Android-only release is never announced on the desktop (`electron/updateCheck.ts`). The notice is never shown on the Mac App Store build, which the App Store updates.

### "Owned since" on the Mac

The Mac App Store build records that it was bought, once, the first time it runs: `store: "mas"`, in `owned.json` in the data folder and, through the page, in the vault (`electron/ownership.ts`). The direct builds are free downloads and record nothing. Nothing checks the record; [release.md](release.md#owned-since) says what it is for.

### After a release

- Download the macOS `dmg` on a Mac that has never run the app. A signed build opens without a Gatekeeper warning.
- On an install of the previous version, check that the update notice appears.
- Check the menu bar icon, a reminder and its buttons, and `open thingglance://queue` from a terminal.

## MCP

The desktop app can run an MCP server for an AI assistant: off by default, on 127.0.0.1 only, reading and changing behind separate consents, with undo and no deletes. It has a page of its own: [mcp.md](mcp.md).

## Stream Deck

A listener for the thingGLANCE Stream Deck plugin, off by default, and the plugin itself in `stream-deck-plugin/`. The keys draw the payload the tray holds, and a press goes through the command queue. It has a page of its own: [stream-deck.md](stream-deck.md).

## Still to come

The "Set up Claude Desktop" button, once the family's stdio bridge has a thingGLANCE profile.
