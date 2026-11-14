# What a shell plugs into

thingGLANCE is a web app. A shell (Capacitor on a phone, Electron on a desktop, a headless refresh with no window) wraps the same bundle and gives it things a browser lacks. This page lists every place a shell connects, so the first shell is a matter of supplying bridges and not of threading conditionals through the app.

Nothing below is used by a shell yet. Each seam is built and tested in the web app, where it does nothing or falls back to the browser.

| A shell wants to | It uses | Where |
| --- | --- | --- |
| Say what it is | `shell()`, `desktopBridge()` and the `html.native` / `html.desktop-<platform>` classes | `src/native/platform.ts` |
| Make the app's requests itself | `registerShell({ fetch })` | `src/native/shell.ts`, `src/sync/shellFetch.ts` |
| Keep credentials in the keystore | `registerShell({ secureStore })` | `src/native/shell.ts`, `src/sync/secrets.ts`, `src/sync/keyHooks.ts` |
| Open the app at a place | `openLink(link)` | `src/native/links.ts`, [links-and-intents.md](links-and-intents.md) |
| Change or ask something | `dispatchExternalWrite({ action, payload, clientId })` | `src/intents/inbound.ts`, [links-and-intents.md](links-and-intents.md) |
| Show something outside the app | `buildSnapshot()` | `src/core/snapshot.ts`, [snapshot.md](snapshot.md) |
| Schedule notifications | The snapshot's `reminders`, or `planReminders()` | `src/core/reminders.ts`, [snapshot.md](snapshot.md#reminder-rules) |
| Know a write from outside landed | The `tg:external-write` event on `window` | `src/intents/inbound.ts` |
| Set or follow the language | `setLanguage(tag)`, or `setLanguage(null)` to follow the device | `src/i18n.ts`, [i18n.md](i18n.md) |
| Show words of its own | The catalog files, and the snapshot's `locale` | `src/locales/<tag>/translation.json`, [i18n.md](i18n.md#other-surfaces) |

## Supplying the bridge

A shell hands over one object, in either of two ways:

```ts
import { registerShell } from '@/native/shell'
registerShell({ fetch: shellFetch, secureStore })
```

or, from an Electron preload script, `window.thingglanceShell = { fetch, secureStore }`.

It has to be in place before `src/main.tsx` runs, because boot reads the credentials from it before anything renders.

## The network

Every request the app makes goes through `src/sync/shellFetch.ts`:

- `shellFetchImpl()` is what the vault client and the sync engines receive as `fetchImpl`.
- `netFetch()` is for the app's own requests: the vault's health check and enrollment, the intents transport, and the product lookups.

With no shell both are the browser's `fetch`. With one, every request goes out on the shell's transport. Electron needs this because its renderer is allowed no request of its own; an Android headless refresh needs it because there is no page.

`shellFetch.test.ts` reads the source and fails if a bare `fetch()` appears anywhere else, or a vault client or sync engine is built without `fetchImpl`.

**Deadlines are enforced here, not left to the transport.** A request that carries an `AbortSignal` is settled by that signal even on a transport that ignores it (Capacitor's patched `fetch` never reads it). A request on a shell's transport that carries none gets a 60-second ceiling, because the vault client sets no timeout of its own. One stalled request can never hold up sync for good.

**One exception:** the vault's live event stream on the web reads a response as it streams, which a transport that returns whole bodies cannot do. It runs only when there is no shell, and "no shell" means both that the platform says so (`shell()`) and that no bridge supplies a `fetch`. A shell brings its own stream reader, as the sibling apps do.

**Not covered:** images. A product photo is an `<img>`, so it loads on the WebView's own stack. That is fine on Android; a desktop renderer with no network of its own will need them fetched by the main process.

## Credentials

Two things on a device are worth stealing: the vault token, and the encryption root key the sync package caches.

- **On the web** both stay where they were: the token in localStorage, the root key in the sync package's own IndexedDB cache. A browser has nowhere better.
- **With a secure store** both move to it. The token is held in memory for the session, filled at boot by `hydrateSecrets()` and written through on change. The root key goes through the hooks the sync package provides for this (`dbCryptoConfig()`).

Things to know when wiring a real keystore:

- **The secure store is three async calls:** `get`, `set`, `remove`, all on strings. `get` answers `null` for "nothing stored" and rejects for "could not read"; the app treats those differently, so do not turn one into the other.
- **The app does not trust it to be fast, ordered or reliable.** Every call goes through `secureOp()` (`src/sync/secrets.ts`): one at a time, in the order asked, each with a 4-second deadline. A plugin does not need to serialise its own calls.
- **What it stores is opaque.** The token is wrapped with a revision number; the root key is wrapped with the account it belongs to. Store the strings as given.
- **A keystore that refuses a write loses nothing.** The change is kept in localStorage (as on the web) with its revision, survives the reload, and is moved across on the next boot. The newest revision always wins, so an older copy can never overwrite a newer connection.
- **A keystore that cannot be read at boot is reported, not mistaken for "not connected".** Sync shows an error asking for a restart, and edits made in that session are held on disk (`src/sync/dirtyHold.ts`) and uploaded by the next launch that can read it.
- **A connection change ends in a reload.** `reloadAfterConfigChange()` waits for every keystore write first (the root key's included); use it, not a bare `location.reload()`. It cannot hang.
- **Nothing is left in IndexedDB.** A root key cached there before the keystore existed is moved across at boot and the database deleted (`settleKeyStorage()`).
- **There is one copy of the key.** The key for tasks sent to dayGLANCE is the same 32 bytes as the root key (same passphrase, same salt, same derivation). With a keystore it is rebuilt from the root key record and never stored on its own.
- **A key is only handed back for the account it was stored for.** One left behind by a failed removal is dropped, never restored into another account.
- **Stream state is tied to its account too.** The token (keystore) and the sync cursors (localStorage) commit at different moments. If the process dies between them, the next start sees cursors that belong to another account and clears them (`settleStreamOwner()`).
- **Every place that touches the root key must use `dbCryptoConfig()`**, or one would read the keystore while another wrote IndexedDB.

## Rules from the sibling apps

These cost lastGLANCE and dayGLANCE real time. They are also in the roadmap, next to the phase each belongs to.

- A shell must not run the service worker. `settleServiceWorker()` already removes one outside the browser.
- A write from outside can arrive before the app has mounted and started its engines (a notification action on a cold start). It is saved, and its sync is held until the engine registers; nothing has to be queued by the shell.
- A headless page must not register a service worker, and opening the app must abort a headless run in flight.
- iOS keeps 64 pending notifications per app and drops the rest without a word. `capReminders()` exists for that; the family uses 56.
