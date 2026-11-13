# thingGLANCE roadmap: prototype to every platform

Written 2026-11-12 against v0.1 (web app + PWA). The model is lastGLANCE, minus the sync roads thingGLANCE does not have.

Most of what follows is drawn from lastGLANCE's own docs and code (`../lastGLANCE/docs/`), plus dayGLANCE for MCP, since lastGLANCE's MCP and Stream Deck are still a plan (`../lastGLANCE/docs/mcp-and-stream-deck.md`) and dayGLANCE's are shipped. Where this document states a store rule, it is repeating your notes in `../lastGLANCE/CLAUDE.md` unless it says otherwise.

Sizes are relative: **S** is days, **M** is a week or two, **L** is several weeks.

## End state

| Surface | What ships |
| --- | --- |
| Web / PWA | Self-hostable Docker image, live sync |
| Android | Capacitor app, home-screen widgets, notifications, shortcuts, Quick Settings tiles, share target, Tasker intents, GLANCElauncher provider with headless refresh |
| iOS | Capacitor app, WidgetKit widgets (home, lock screen, Control Center), App Shortcuts for Siri and Spotlight, share extension, notifications |
| macOS, Windows, Linux | Electron app, menu bar / tray popup, global shortcuts, notifications, deep links |
| AI | MCP server in the desktop app, reachable from Claude Desktop and Claude Code |
| Optional | Stream Deck plugin; a vault-hosted MCP that needs no desktop app running |

## What thingGLANCE gets to skip

Being vault-only removes a large share of lastGLANCE's surface area. None of this needs building:

- The WebDAV proxy sidecar: `server.js`, `api/`, the `/api/` nginx location, the Vite dev proxy plugin, and the SSRF test vectors. The Docker image can be nginx and static files alone.
- iCloud: the plugin, both containers, the entitlements, the first-run modal.
- Direct Access: the Android SAF folder sync and the iOS file bookmarks.
- The file-tier sync engine and everything that reconciles it with the vault.
- The custom OkHttp plugin on Android. It exists because CapacitorHttp rejects PROPFIND and MKCOL; the vault only uses ordinary verbs, so `CapacitorHttp` is enough.
- Contacts access (lastGLANCE's People feature).

## Decide these before anything ships

These are cheap now and expensive or impossible to change later.

### 1. Identifiers

| Thing | Proposed value | Why it matters |
| --- | --- | --- |
| Bundle / application ID | `com.thingglance.app` on Android, iOS and the Mac App Store | lastGLANCE's iOS ID (`com.lastglance`) and Android ID (`com.lastglance.app`) never matched, and its docs say mixing them up silently breaks App Groups. Use one. Matching iOS and Mac IDs is also what allows Universal Purchase. |
| App Group (iOS) | `group.com.thingglance.app` | Must be on every App ID before widgets work. A wrong group fails silently. |
| URL scheme | `thingglance://` | One router for widgets, notifications, shortcuts, tray and launcher. |
| Desktop origin | `app://thingglance` | IndexedDB and localStorage are keyed by it. It can never move after the first build. |
| Android WebView origin | `https://localhost` (Capacitor's default) | The headless refresh shares storage with the app only at this origin. |
| Launcher permission and authority | `com.thingglance.permission.LAUNCHER`, `com.thingglance.app.launcher` | Part of the GLANCElauncher contract. |
| Tasker actions | `app.thingglance.{CREATE,OPEN,QUERY,...}` | |
| MCP and Stream Deck ports | 7910 and 7911 | dayGLANCE holds 7893 / 7892 and lastGLANCE plans 7900 / 7901. Check lifeGLANCE has not claimed these. |
| Vault app, intents source | `thingglance`, `app.thingglance` | Already in use by the prototype. |

### 2. Pricing

See [Pricing](#pricing-paywall-or-paid) at the end. The short version: **create the Play listing as paid**, because that is the only choice that keeps both models available.

### 3. The wire contract

The moment real data goes into a vault, the entity shapes in `src/core/types.ts` (`thing`, `coverage`, `subscription`, `decision`) become a contract every future build has to read. Before loading real data, settle the tweaks that would rename or restructure fields. Adding optional fields later is safe; renaming is not.

## Phase 0: self-hosted with real data (S)

> Status, 2026-11-12: the Docker image, CI workflows, lint and live sync are done in this repo. The vault allowlist change (in `glance-vault`) and the test against your real vault and dayGLANCE are still open.

The goal is the thing you asked for first: the app on your own server, pointed at your real vault.

- **Vault allowlist.** Add `thingglance` to `DEFAULT_ALLOWED_APPS` in `../glance-vault/src/config.ts`, release the server, and roll it to GLANCEvault Pro. Until then a self-hosted server needs it in `GLANCEVAULT_ALLOWED_APPS`. The web app's origin also has to be in `GLANCEVAULT_ALLOWED_ORIGINS`, and the vault must be HTTPS if the app is.
- **Docker image.** A two-stage build: `node:20-alpine` to build, `nginx:alpine` to serve `dist/`. Copy lastGLANCE's `nginx.conf` rules that matter (`/sw.js` never cached, hashed assets immutable, SPA fallback) and drop the `/api/` proxy. Add `docker-compose.yml`.
- **CI.** Copy the shape of lastGLANCE's workflows: `ci.yml` (lint, test, build), `publish-ghcr.yml` (multi-arch image on release, with its 30-minute timeout for QEMU), and `testing-image.yml`. The repo has no workflows today, and no ESLint config.
- **Live sync on the web.** Wire the vault's `/events` stream so a change on one device reaches the others in seconds. Today sync runs every five minutes, on focus, and three seconds after a write. lastGLANCE's `src/sync/vaultEventStream.ts` is the reference.
- **Your tweak list.** Do the ones that touch the data model here, before real data.

Done when: the image runs on your server, two of your devices sync through your real vault, and a task sent from the queue appears in your real dayGLANCE. That last step has only been tested against a script playing dayGLANCE's part.

## Phase 1: foundations every shell needs (M)

Each of these is built once in the web app and reused by every shell. Doing them before the first shell is the main lesson in lastGLANCE's and dayGLANCE's docs.

- **One URI router.** Map `thingglance://thing/<id>`, `plan/<id>`, `action/add`, `action/add-plan`, `view/horizon`, `queue` and so on to app state. dayGLANCE's stated hindsight is to send widgets, notifications and shortcuts through one router from day one. The prototype's query-string deep links fold into this.
- **One inbound dispatcher.** A `handleIntent` that applies an external write (from a widget, the launcher, the tray, Tasker, MCP) through the same functions the forms use, with a `clientId` ledger so a re-sent write is never applied twice. Build the idempotency in from the start: every external write carries a caller-supplied id.
- **Injectable network.** Route every vault request through one `shellFetchImpl()` so Capacitor, Electron main and the headless refresh can each substitute their own transport. The prototype calls `fetch` directly in a few places (`src/sync/vaultConnect.ts`, `src/intents/transport.ts`).
- **Secure config shim.** Keep the vault token and derived keys out of plain localStorage on shells that have a keystore. lastGLANCE: `src/sync/secureConfigShim.ts`, `src/sync/nativeKeyHooks.ts`.
- **Reminders as pure logic.** Decide in `src/core` which horizon events notify and when (the lead windows already exist in `horizon.ts`), so each platform only has to schedule what core tells it to.
- **Freeze the snapshot.** `buildSnapshot()` is the object widgets, the tray, the launcher and MCP will read. Review its fields against what each surface needs, then treat it as versioned.
- **i18n.** Move strings to i18next as the siblings do. It is far cheaper before native code starts carrying its own string catalogs. Remember locale JSON has to be in the service worker precache.

## Phase 2: Android (L)

Scaffold with Capacitor 8, then follow the order lastGLANCE's native plan settled on.

1. **Snapshot bridge and one read-only widget.** A `WidgetBridge` plugin writes the snapshot to SharedPreferences. Go straight to Jetpack Glance: lastGLANCE started on RemoteViews and had to migrate.
2. **Notifications.** `@capacitor/local-notifications` with exact alarms, one per event, diff-replaced. Actions: "Done with this" and "Send to dayGLANCE".
3. **Action widgets.** A tap queues a decision natively with a pre-minted id; the page replays it idempotently on next open.
4. **Entry points.** Dynamic shortcuts, a share target, Quick Settings tiles, and the Tasker intents bridge (off by default behind a native toggle).
5. **Hardening.** Keystore-backed secure storage, a native reader for the vault's event stream, back-button and status-bar fixes.

Widgets worth building, in order of value:

- **Needs a decision**: the queue as a list, each row with a clear button.
- **Next up**: one line, the nearest date with its T-minus.
- **Single thing**: its life-left ring and verdict, configurable.
- **Plans this month**: what is about to be charged.
- **Add a thing**: an action tile.

A share target is a particularly good fit here: sharing a product page or name into thingGLANCE can open the add form with the web lookup already run.

Gotchas lastGLANCE documents, so they are not relearned:

- Never register a service worker in a WebView. It served a stale bundle after a store update and produced a blank first launch.
- Adding `@capacitor/app` silently breaks the hardware back button until a listener restores it.
- Keep `minifyEnabled false`. Plugin bridges rely on reflection and widget icons are resolved by name.
- For Tasker: map the fully-qualified action to the short one or every action silently does nothing; use a multi-slot queue, not a single slot; register the wake receiver in `onCreate`, not `onResume`.
- Publish checksums for the sideload APK, since the Play and sideload signatures differ.
- Version code scheme: `major*1000000 + minor*10000 + patch*100`.

**Start the Play clock early.** The closed-testing requirement (12 testers for 14 days) is per package and is pure calendar time. Create the listing, as paid, and get testers in as soon as the shell boots, well before the app is finished.

## Phase 3: GLANCElauncher (M, plus launcher-side work)

The contract, from `../lastGLANCE/docs/launcher-integration.md`:

- **Reads.** A read-only content provider serves the snapshot, with a `meta` row carrying heartbeat fields. Push only when content changed, and call `notifyChange`.
- **Writes.** A broadcast receiver takes actions with `payload` and `clientId` extras into a multi-slot queue. Each write is acknowledged only after its handler finishes. There is no result broadcast; the launcher reads the outcome from the next snapshot.
- **REFRESH.** If the app is alive, hold it awake briefly. If the process is dead, boot the bundle in an Activity-less WebView and run one sync cycle (the headless refresh).
- **Permission.** Signature-or-known-signer, pinned to the launcher's release certificate.

Rules lastGLANCE learned the hard way:

- Register the vault engines before applying launcher writes, or the writes are saved and never pushed.
- Keep the headless bridge on an explicit method allowlist, with a test that fails on anything outside it.
- The headless page must not register a service worker either.
- Opening the app must abort a headless run in flight.

This is where keeping `src/core` and `src/sync` free of React pays off: the headless root can import them directly.

**Launcher-side work is required.** The launcher is currently hardcoded for dayGLANCE and lastGLANCE through its `GlanceClient` seam. thingGLANCE needs a client there and a decision about what its card shows (the queue and the next date are the obvious candidates).

## Phase 4: iOS (L)

Order, again from lastGLANCE's plan:

1. **App Group and the snapshot bridge**, read-only. Put the App Group on every App ID first and regenerate profiles.
2. **Notifications.** Cap scheduled notifications at 56: the iOS limit of 64 is per app.
3. **Widgets and App Intents.** Home screen, lock screen accessories, and a Control Center control. An interactive button clears a queue item and optimistically updates the snapshot.
4. **Entry points.** URL scheme, home-screen quick actions, App Shortcuts for Siri and Spotlight, and a share extension.
5. **Follow-ons.** Keychain storage, a native reader for the vault event stream (WKWebView cannot stream it), and billing only if the app is paywalled.

Gotchas lastGLANCE documents:

- Custom Capacitor plugins are not auto-discovered on iOS. They are registered by hand in a view controller the storyboard instantiates; if that link breaks, every plugin is undefined.
- UIScene lifecycle is mandatory on the current SDK.
- The app and every extension must ship the same build number. Set versions from a generated xcconfig, never in Xcode's General tab.
- An intent in both targets appears twice in Shortcuts unless the extension's copy is marked not discoverable. The Control Center control's intent must also be in the app target or tapping it does nothing.
- Siri phrases go in `.strings`, not a string catalog, below an iOS 17 deployment target.
- Add `maximum-scale=1` on iPhone, or focusing a small input zooms the WebView permanently.
- WidgetKit lists do not scroll, and a share extension can never open its host app, so shared items go into a queue.
- Reboot the device before believing a widget bug. A stale WidgetKit cache survives reinstalls.

## Phase 5: desktop (L)

Plain Electron, not the Capacitor Electron wrapper, as lastGLANCE chose. Its five phases, minus iCloud:

1. **Scaffold.** The `app://thingglance` protocol, window, strict CSP, a smoke test, unsigned builds. `vite build --mode electron` already builds without the PWA plugin.
2. **Network and sync.** Sync stays in the renderer, but every request goes through main, including the vault event stream. That removes the need for a vault CORS entry and lets a strict CSP catch any fetch that was missed. Secrets go in `safeStorage`.
3. **Background mode.** Keep running in the background, open at login, a reminder scheduler owned by main, and the command queue.
4. **Tray / menu bar popup.** The popup never opens the database and never runs sync. The main window pushes the snapshot; main caches it; the popup renders from the cache and writes back through the command queue. This is exactly what `buildSnapshot()` was shaped for.
5. **Release.** macOS dmg and zip (signed, notarized), Windows NSIS, Linux AppImage and deb, each for x64 and arm64, plus a Mac App Store build.

Gotchas lastGLANCE documents:

- Pin the macOS runner version in CI. dayGLANCE's signing broke when `macos-latest` moved.
- Cache and retry Electron downloads.
- Set the app user model ID on Windows or notifications are attributed to "electron.app".
- Hold preload, types and main's IPC channels in step with one source-text contract test.
- Linux gets a native tray menu, not the popup.
- There is no auto-update, only an "update available" notice from the GitHub releases API.

## Phase 6: MCP, then Stream Deck (M each)

**MCP.** The reference is dayGLANCE (`../day-planner/docs/mcp-server-spec.md`, `mcp-tools-reference.md`) and the shared `@glance-apps/mcp-host` package.

- The server runs in Electron main over Streamable HTTP on `127.0.0.1`, checking path, Host, Origin and a bearer token.
- Reads and writes both go over a request bridge to the main window, which answers from live data. A missing window answers `renderer_unavailable`, never an empty list.
- Everything is off by default. Reads and writes need separate consent.
- Every write needs an idempotency key, is rate-limited, returns an undo operation, and can be stopped by a kill switch. No delete tools.
- `../mcp-bridge` connects stdio clients to the app. It hard-codes dayGLANCE today and needs a thingGLANCE profile.

A first tool set, following the `<app>_<verb>_<noun>` convention:

| Read | Write |
| --- | --- |
| `thingglance_get_overview` | `thingglance_create_thing` |
| `thingglance_list_things` | `thingglance_update_thing` |
| `thingglance_get_thing` | `thingglance_add_coverage` |
| `thingglance_list_plans` | `thingglance_create_plan` |
| `thingglance_list_upcoming` | `thingglance_update_plan` |
| `thingglance_list_queue` | `thingglance_decide_event` |
| | `thingglance_list_mcp_writes` |

This is an unusually good fit for an assistant: "what should I cancel?", "what is out of support?", "I just bought a Pixel 9, add it".

**A vault-hosted MCP** is worth considering alongside. dayGLANCE has a design note (`../day-planner/docs/mcp-vault-host.md`) for a host that enrolls as a device, syncs with the vault directly and serves MCP without the desktop app running. thingGLANCE is vault-only with a pure core, which is the shape that design wants.

**Stream Deck** is optional and comes after MCP. Natural keys: the queue count, the nearest T-minus, this month's plan charges. Presses go through the same command queue as the tray.

## Phase 7: store launch (M)

- Listings, screenshots and store assets. lastGLANCE's `store-assets/README.md` has the current required sizes.
- Apple metadata must not mention Android.
- Reviewer access, if there is a paywall.
- The Mac App Store build is made locally and uploaded with Transporter.
- A page on the GLANCE apps site.

## Work in other repos

| Repo | Change | Needed by |
| --- | --- | --- |
| `glance-vault` | Add `thingglance` to the default allowed apps; roll to Pro | Phase 0 |
| `glance-intents` | Add `THINGGLANCE` to `SOURCE_APPS` (the schema already accepts the value) | Any time |
| `day-planner` | A thingGLANCE badge on tasks it created, like the lastGLANCE one | After Phase 0 |
| `GLANCElauncher` | A `GlanceClient` for thingGLANCE and its card | Phase 3 |
| `mcp-bridge` | A thingGLANCE app profile | Phase 6 |
| `glance-billing` | Product IDs, only if paywalled | Phase 2 and 4 |
| `glance-apps-dotcom` | Product page | Phase 7 |

## Suggested order

1. Phase 0, so you are using it with real data while everything else is built.
2. Phase 1, before any shell.
3. Android scaffold far enough to create the Play listing and start the closed-test clock, then the rest of Phase 2.
4. Phase 5 (desktop) or Phase 4 (iOS), whichever you will use more. Desktop unlocks MCP.
5. Phase 3 (launcher) once the Android snapshot is stable.
6. Phase 6, then Phase 7.

Android first and desktop second matches where the family already has the most reusable code.

## Pricing: paywall or paid?

### The constraint that decides it

Per your notes: on Google Play, a free app can never become paid once it has been published to any track, including internal testing. A paid app can become free, once. Apple lets you move between free and paid whenever you like.

So the two starting points are not symmetrical:

- **Start paid**: you can stay paid, or later switch to free with an in-app paywall. Both models remain available.
- **Start free**: paid is gone on Play permanently.

Whatever you prefer long term, **the Play listing should be created as paid**.

### Recommendation: a paid app, one price

| | Paid up front | Free with a paywall |
| --- | --- | --- |
| Code to build and maintain | None | Play Billing, RevenueCat on iOS, StoreKit on Mac, the paywall, restore, reviewer codes |
| Review risk | Low | lastGLANCE was rejected once over the paywall's dismiss control; iOS forbids a close button and requires named benefits and legal links on the wall |
| Try before buying | Not in the stores | Yes |
| Reach | Smaller funnel | Larger funnel |
| Recurring revenue | No | Yes, from the annual plan |
| Reversible on Play | Yes | No |

Reasons it suits this app in particular:

- **The message.** An app whose job is helping you see and cut subscriptions is an awkward thing to sell as a subscription.
- **Recurring revenue already has a home.** thingGLANCE only syncs through GLANCEvault, so anyone who wants more than one device is either self-hosting or paying for Pro. The app does not need to carry a second subscription.
- **The trial exists.** The web app is free and has sample data. "Try it in your browser" does the job a store trial would.
- **It removes a whole workstream** from Android, iOS and Mac, including the parts lastGLANCE's docs flag as fragile (the pinned RevenueCat binary, restore edge cases).
- **Universal Purchase** on Apple: one price covers iPhone, iPad and Mac if the bundle IDs match.

The GitHub sideload APK and the direct desktop downloads can stay free, as the family does today: the stores sell convenience.

**On price:** I would start at $9.99. With no trial in the store, the lower end removes friction, and a paid app's price can be raised later without restriction. $19.99 matches the siblings' lifetime tier, but those buyers get to use the app first.

### Keeping the other door open

If you later move to free with a paywall, earlier buyers must not hit the wall.

- On Apple this is clean: StoreKit reports the app version a customer originally bought.
- On Play I do not know of an equivalent, so treat this as unverified and check before relying on it.

A cheap precaution covers both: from the first paid release, record an "owned since" marker on the device and in the vault. It costs almost nothing now and makes a later switch safe.

### What would change my mind

- If you want the four apps to feel like one product line with one pricing shape, consistency may be worth more than simplicity.
- If you expect store discovery, not your own channels, to bring most users, the free funnel matters more.
- If you want a family bundle or shared entitlement across the four apps later, that is easier to build on in-app purchases.

## Open questions

- Is thingGLANCE meant to be reachable from the launcher for writes (clear a queue item, add a thing), or read-only at first?
- Should plans be creatable from other apps by intent, for example dayGLANCE sending "I subscribed to X"?
- Does lifeGLANCE want a milestone when a thing is bought or retired?
- Which locales ship first?
- Is a Microsoft Store build wanted? dayGLANCE's repo has MSIX handling that could be reused.
