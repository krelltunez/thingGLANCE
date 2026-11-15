# GLANCElauncher

GLANCElauncher is the family's Android home screen. To the left of its Home it has a planning page for each GLANCE app that is installed. thingGLANCE's page shows what the app's own Glance screen shows: what needs a decision, the year ahead, the things closest to the end of their window, and what plans are about to charge. A date can be cleared or sent to dayGLANCE from there.

This page is thingGLANCE's half of that: what it serves, what it accepts, and how it is built. The launcher's half is in its own repository (`../GLANCElauncher/docs/spec.md`, "Real data"). The contract is the one dayGLANCE and lastGLANCE already keep with the launcher (`../lastGLANCE/docs/launcher-integration.md`), so that the launcher's reader, outbox and diagnostics work for all three.

Android 12 and later only. Nothing here runs on the web or in the PWA.

## Who may use it

One permission guards both the provider and the receiver:

```
com.thingglance.permission.LAUNCHER   signature|knownSigner
```

It is held by an app signed with thingGLANCE's own key, or with one of the certificates listed in `android/app/src/main/res/values/launcher_certs.xml`. That file lists the **launcher's** release certificate, the same one digest dayGLANCE and lastGLANCE list. The launcher's key was given to Play App Signing, so its Play build and its GitHub build carry the same certificate.

**This says nothing about how thingGLANCE is signed.** The trust runs one way: thingGLANCE names who may read it. A debug build, a build signed with the upload key and the build Play re-signs with its own app signing key all trust the same launcher, and the launcher does not check who signed thingGLANCE. Setting the app up in Play changes nothing here.

What does matter is the launcher's signature. A launcher built without its release key (a fork, a debug build on a machine without the keystore) is refused and shows no thingGLANCE page. `knownSigner` does not exist before Android 12; the launcher itself needs Android 12.

No switch in Settings. The automation switch ([tasker.md](tasker.md)) is for the door any app on the phone can knock on; this door only opens to the launcher.

## What the launcher reads

`content://com.thingglance.app.launcher/<collection>`, read-only. Each row has `_id`, `id` and `json`. The rows are mapped out of the payload the app already hands the widgets (`src/native/widgetBridge.ts`), so the launcher, the widgets and the notifications cannot disagree. Every change notifies the authority.

| Collection | Rows | Row id |
| --- | --- | --- |
| `meta` | One | `meta` |
| `attention` | What needs a decision, most pressing first (up to 40) | The event's `key` |
| `upcoming` | What is still ahead, soonest first (up to 40) | The event's `key` |
| `things` | Every thing in service | The thing's id |
| `charges` | What plans will charge in the next 30 days (up to 40) | `subscriptionId:date` |

An event, a thing and a charge are exactly the objects in the snapshot ([snapshot.md](snapshot.md)): nothing is renamed on the way.

A date ticked off on a widget or a notification that the app has not applied yet is already gone from `attention` here (and reads `done` in `upcoming`), as it is on the widgets.

### `meta`

The freshness fields carry the names the launcher reads from the sibling apps.

| Field | Meaning |
| --- | --- |
| `version` | This contract's version: 1. |
| `empty` | True when the app is installed and has never handed anything over. The other collections are empty; the launcher asks the user to open the app once. |
| `updatedAt` | When the snapshot was built (ISO). |
| `checkedAt` | When the app last looked, whether or not anything had changed (epoch ms). |
| `syncedAt` | When the vault last synced in full (ISO), or null with no vault. |
| `rendererAlive` | Whether the app's own page exists right now. |
| `headlessRunning` | Whether a background refresh is running right now. |
| `refreshLog` | The last 20 `REFRESH` requests and how each went. |
| `handledWrites` | The newest 60 outside writes that were applied: `clientId`, `action`, `entityId`. The launcher stops re-sending a write once its id is here. |
| `today`, `currency`, `locale` | The day the lists were built for, the currency of every amount, the language of the text. |
| `counts`, `burn` | As in the snapshot. `counts.attention` is less what is waiting to be applied. |
| `charges` | `days`, `total`, `count`, and `months`: the year ahead, a total per calendar month. |
| `canSend` | True when this device is connected to dayGLANCE. Only then should "Send to dayGLANCE" be offered. |
| `labels` | The app's words for what the launcher cannot word itself: `verdicts` by code, `sent`, and the countdown's unit templates. |

Privacy needs nothing extra: the payload is already narrowed to what this phone's member may see.

## What the launcher sends

Broadcasts to `com.thingglance.app.launcher.LauncherIntentReceiver`, each with a `clientId` text extra and, for a write, a `payload` text extra holding JSON.

| Action | Payload | Does |
| --- | --- | --- |
| `com.thingglance.app.launcher.DECIDE` | `event_key`, optionally `state` (`done`, `dismissed`, `restore`; `done` when left out) | Clears a date, or puts it back |
| `com.thingglance.app.launcher.SEND` | `event_key` | Hands a date to dayGLANCE as a task |
| `com.thingglance.app.launcher.REFRESH` | None | "Confirm your data now" |

There is no create. Adding a thing opens the app's own form (`thingglance://action/add`): a thing made from a name alone has no dates.

A write is queued natively as `{ action, payload, clientId }` in the same queue the widgets and Tasker use, and the app applies it through `dispatchExternalWrite()`, once: the ledger in `src/intents/ledger.ts` answers a repeat without applying it. No answer is broadcast. The launcher keeps the write in its outbox, shows its effect at once, and drops it when `meta.handledWrites` shows the id.

Who applies it depends on whether the app's page exists:

- **It does** (the app is open or in the background): the page is told, and `LauncherAwakeWorker` holds the app awake until the write has left the queue. Android freezes a backgrounded app within minutes, and without the hold the write would wait until the app is next opened.
- **It does not**: a background refresh is asked for (`RefreshWorker.requestSoon`), which applies the write and carries it to the vault.

### REFRESH

The launcher asks when its thingGLANCE page comes into view and the data is getting old. Every request is logged, and the launcher reads how it went from `meta.refreshLog`:

| Outcome | Means |
| --- | --- |
| `queued` | The app's page was asked and has not answered yet |
| `ran`, `failed` | The page, or a background run (`headless: true`), finished: `durationMs`, and `waitMs` for how long Android held a background run back |
| `unanswered` | The page was held awake for a minute and never answered |
| `scheduled` | No page: a background run is on its way |
| `throttled` | No page, and a background run was made less than ten minutes ago |
| `coalesced` | Another request was already on its way |
| `aborted` | The app was opened first; it syncs as it opens |
| `deferred` | No background run could be scheduled |

A live page does what the routine refresh does (sync, apply what is queued, hand over) and reports through `WidgetBridge.recordLauncherRefresh`. A background run is the ordinary one ([android.md](android.md#background-refresh)) with the launcher's request id attached; it needs nothing new on the headless allowlist.

The ten-minute floor is deliberate. thingGLANCE's dates move by the day, and a background run every time someone returns to their home screen would spend battery to learn nothing.

### A page that has stopped answering

A backgrounded WebView can stop answering its bridge while still running a script handed to it directly. On the emulator this showed about a minute after the app was left, not every time; the sibling apps met it on phones. Held awake or not, such a page never applies a write and never runs a refresh.

So when a hold ends with the work not done, `LauncherPageRetire` closes the page and a background run does the work instead, as if the app had been swiped away. It only does so when nothing is lost, and every step must hold:

- the app has been in the background for 45 seconds or more;
- the page answers a check, handed to it as a script, with `ok`. It answers `busy` while a form or a sheet is open (`window.__tgRetireCheck` in `src/native/widgetBridge.ts`), and then it is left alone;
- it is still in the background at the moment it closes.

For a `REFRESH` the request's entry says the page was closed (`pageClosed`), and the run that follows is logged as `<clientId>-headless`, which is what the launcher's diagnostics expect from the sibling apps. For a write, the queued write is simply applied by the run. The next time the app is opened it starts fresh from storage.

The routine refresh, a few times a day, does not do this: it asks a live page and moves on.

## Freshness

- `checkedAt` is stamped every time a payload is written, and by `WidgetBridge.heartbeat` when the app looked and nothing had changed (so an unchanged payload is not written again just to say so).
- `syncedAt` travels in the payload, and with the heartbeat.
- The launcher measures staleness from `syncedAt`, else `checkedAt`, else `updatedAt`.

## Where it lives

| What | Where |
| --- | --- |
| The launcher's share of the payload: longer lists, `handledWrites`, `syncedAt` | `launcherBlock()` in `src/native/widgetBridge.ts` |
| Payload to rows | `android/.../launcher/LauncherRows.kt` (pure, tested) |
| The provider | `android/.../launcher/LauncherProvider.kt` |
| The receiver | `android/.../launcher/LauncherIntentReceiver.kt` |
| Routing and logging a `REFRESH` | `android/.../launcher/LauncherRefresh.kt` (pure, tested) |
| Holding the app awake | `android/.../launcher/LauncherAwakeWorker.kt` |
| Closing a page that stopped answering | `android/.../launcher/LauncherPageRetire.kt`, `MainActivity.java` |
| The heartbeat and the refresh log | `SharedDataStore.kt` |

## Checking it

- `./gradlew testDebugUnitTest` covers the rows, the routing, the log and the write's shape. `npm test` covers the launcher's share of the payload.
- On a device, the permission keeps `adb shell` out as it keeps every other app out, so the provider and the receiver can only be exercised by a launcher signed with its release key, installed beside thingGLANCE. A launcher debug build carries that key on a machine that has it. `scripts/android-check.mjs` therefore does not cover this page's subject.
- Checked by hand on the emulator, 2026-11-15, with such a launcher build: the page from sample data; "Done with this" and Restore from the launcher; a `REFRESH` with the app closed (a background run), with it alive (`ran`) and with its page stalled (`unanswered`); and a write sent to a stalled page, which was closed and the write applied by a background run about twenty seconds later. Not checked: "Send to dayGLANCE" from the launcher (needs a vault and dayGLANCE connected), a page closed on a `REFRESH` rather than a write, and anything on a real phone.
