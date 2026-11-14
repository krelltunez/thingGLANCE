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

**One exception:** the vault's live event stream on the web reads a response as it streams, which a transport that returns whole bodies cannot do. It runs only when there is no shell. A shell brings its own stream reader, as the sibling apps do.

## Credentials

Two things on a device are worth stealing: the vault token, and the encryption root key the sync package caches.

- **On the web** both stay where they were: the token in localStorage, the root key in the sync package's own IndexedDB cache. A browser has nowhere better.
- **With a secure store** both move to it. The token is held in memory for the session, filled at boot by `hydrateSecrets()` and written through on change. The root key goes through the hooks the sync package provides for this (`dbCryptoConfig()`).

Things to know when wiring a real keystore:

- **The secure store is three async calls:** `get`, `set`, `remove`, all on strings.
- **A token still in localStorage is moved across at boot**, and removed from there only after the keystore has it. A keystore that refuses leaves everything working as before.
- **A connection change ends in a reload.** `reloadAfterConfigChange()` waits for the keystore first; use it, not a bare `location.reload()`.
- **There is no older root key to migrate**, since no shell has shipped. If a shell ever ships before its keystore is wired, the first launch with one asks for the passphrase again.
- **The intents key needs nothing.** It is already stored as a key the browser will not export.
- **Every place that touches the root key must use `dbCryptoConfig()`**, or one would read the keystore while another wrote IndexedDB.

## Rules from the sibling apps

These cost lastGLANCE and dayGLANCE real time. They are also in the roadmap, next to the phase each belongs to.

- A shell must not run the service worker. `settleServiceWorker()` already removes one outside the browser.
- Register the vault engines before applying writes from outside, or the writes are saved and never pushed.
- A headless page must not register a service worker, and opening the app must abort a headless run in flight.
- iOS keeps 64 pending notifications per app and drops the rest without a word. `capReminders()` exists for that; the family uses 56.
