# Android

The Android app is the web app inside a Capacitor 8 shell. This page says how to build and check it, what the shell does today, and what is still to come. The plan and its order are in [ROADMAP.md](ROADMAP.md#phase-2-android-l).

- **App ID:** `com.thingglance.app` (the same id is reserved for iOS and the Mac).
- **Version:** read from `package.json`. The version code is `major*1000000 + minor*10000 + patch*100`.
- **Minimum Android:** 7.0 (API 24). Built against API 36.

## Build it

You need JDK 21, the Android SDK (API 36), and Node.

```bash
./build-android.sh
```

That builds the web app, copies it into the Android project, and produces `android/app/build/outputs/apk/debug/app-debug.apk`. The script picks JDK 21 itself; a newer default JDK fails with "Unsupported class file major version".

| Command | What you get |
| --- | --- |
| `./build-android.sh` | A debug APK. |
| `./build-android.sh --webview-debug` | A debug APK whose WebView can be inspected and driven. Needed for the device check below. Never ship one: anyone with a cable could read the app's storage. |
| `./build-android.sh --release` | A signed release APK and a Play bundle. Needs `android/keystore.properties`, which is not in the repository. |

`android/keystore.properties` has four lines: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. Keep it and the keystore file out of git (both are ignored).

To open the project in Android Studio: `npx cap open android`.

## Check it on an emulator

`scripts/android-check.mjs` drives the real app on an emulator, through the WebView's DevTools connection, with the same Playwright calls the web end-to-end run uses. It checks what only a device can show:

- the vault token and the encryption root key are in the Android Keystore, are ciphertext on disk, and are nowhere in the WebView's storage;
- requests go out on the native HTTP stack, so the vault needs no CORS entry for the app;
- no service worker is registered;
- `thingglance://` links open the right place, warm and with a filled-in form;
- something shared from another app opens the add form with its name, and the app icon has its shortcuts;
- the back button closes the keyboard, then the sheet, then returns to the first screen, then leaves the app without closing it;
- a thing added on the phone reaches a web device through a real vault, and the other way;
- the native reader holds the live stream, and a change made on the web reaches the open phone by itself;
- both widgets can be placed, show the right date and countdown, and open the app on a tap;
- the tick on a widget row clears the date with the app not running, the write waits in a queue, and is applied once;
- "Send to dayGLANCE" on a widget row, with the app closed, marks the row at once and reaches a web device as a date handed to dayGLANCE;
- a reminder is held at the chosen time and delivered by Android with the app in the background; "Done with this" on it dismisses it without opening the app, and a widget tick cancels a date's reminder;
- a background refresh carries a tick to a web device, and brings a thing added on the web to the phone's widgets and reminders, with the phone app never opened;
- after being killed, the app is still connected and asks for no passphrase.

```bash
./build-android.sh --webview-debug
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
npm run dev                      # the web device it syncs against
# a throwaway vault, as in the header of e2e/vault-sync.mjs
node scripts/android-check.mjs emulator-5554
```

`QUICK=1` in front skips the part that waits several minutes for Android to deliver a notification.

**It wipes the app's data on its target, so it refuses anything that is not an emulator.** If a real phone is plugged in too, always pass the emulator's serial to `adb` (`-s emulator-5554`): a bare `adb install` with two devices attached fails, and with one attached it goes to the phone.

Three things to know when writing checks like it:

- While DevTools is attached, the page is held "visible". It never hears that the app went to the background and came back, so the sync that runs on coming to the front does not run. Detach before sending the app to the background and attach again afterwards.
- The first back press in a form goes to the on-screen keyboard, as in any Android app.
- Do not use `force-stop` to stand in for a closed app. It puts the package in the "stopped" state, and Android 15 then disables its widgets until the user opens the app. The check ends the process from inside the app's own sandbox instead (`run-as`), which is what Android reclaiming memory looks like.

## What the shell does

Everything goes through the seams in [shells.md](shells.md). The Android side of each:

| Seam | Android |
| --- | --- |
| Keystore | `SecureStorePlugin` and `SecureStore` (`android/app/src/main/java/com/thingglance/app`). AES-GCM values in a private preferences file, the key in the Android Keystore. Nothing stored answers `null`; a Keystore that cannot be used rejects, and the web side tells the two apart. An entry that can never be read again (restored onto another device) is dropped. |
| Network | `CapacitorHttp` replaces `window.fetch` with the native HTTP stack. `src/native/capacitor.ts` registers it as the shell's transport, which also puts the app's deadlines on it (it ignores `AbortSignal` by itself). |
| Live updates | `VaultSsePlugin` and `VaultSseClient` (`sse/`) hold the vault's event stream natively and pass each event block to the web app, which treats it exactly as the web reader's. |
| Links | The manifest takes `thingglance://` URLs. `@capacitor/app` hands them to `openLink()`, both when the app is running and when a link starts it. `LaunchLinks` turns every other way of starting the app into such a link first, so the web side still has one router. |
| Back button | `src/native/backStack.ts`: the app registers what "back" closes; the shell leaves the app only when nothing was closed. |
| Status bar | Transparent, with icons that follow the app's theme. The layout keeps clear of it with the safe-area insets. |
| Service worker | Never registered in the WebView. |

## Live updates

While the app is on screen it holds the vault's event stream open, so a change made on another device shows up in a few seconds. The WebView cannot read that stream itself (its requests go out on a native stack that returns whole responses, and this one never ends), so the shell does:

- **`VaultSseClient`** connects to `{vault}/events` with the device token, splits the stream into event blocks, and reconnects with backoff when it drops. It is the sibling apps' reader, ported.
- **It runs only while the app wants it and is on screen.** It drops in the background, where Android would cut the socket anyway, and on reconnect the vault's first frame says where things stand, so nothing is missed.
- **The web app treats a block exactly as the web reader's**: the same parser, the same coalescer, the same sync (`createBridgeSseClient` in `src/sync/vaultEventStream.ts`). A nudge only ever makes the app sync sooner; polling carries on underneath and nothing depends on a nudge arriving.
- **The token does not travel in the clear over the internet.** Plain HTTP is accepted for this connection only to the device itself, a private network range or a `.local` name. Anything else stops the reader with `insecure`, and the app keeps polling.
- **A refused token or a vault without `/events` stops it for good** (`auth`, `unsupported`); Settings → GLANCEvault shows live updates as off or unsupported.

`window.__glanceVaultSse` in the WebView has the reader's state, as on the web, for diagnosing a build with no tools attached.

## Other ways in

- **Sharing into the app.** Share a product page or a name from any app and the add form opens with it filled in. The page title wins; failing that, the shared text without its links; a bare address names nothing, so the form opens empty. It becomes an ordinary `thingglance://action/add?name=` link (`LaunchLinks`).
- **Shortcuts on the app icon** (long-press): Add a thing, Add a plan, Needs a decision. Each is a link (`res/xml/shortcuts.xml`).
- **An old start is not replayed.** When Android rebuilds the app after killing it, or reopens it from Recents, it hands over the intent that first started it. `LaunchLinks` strips a link or a share from such a replay, so a form closed hours ago does not reopen.

## Widgets

Two so far, both Jetpack Glance (`android/app/src/main/java/com/thingglance/app/glance`):

| Widget | Shows |
| --- | --- |
| **Needs a decision** | The app's queue: each date inside its lead window, with its countdown. It scrolls. A tap on a row opens that date; the buttons at its end send it to dayGLANCE or clear it, without opening the app; the title opens the queue. |
| **Next up** | One line: what needs a decision first, else the nearest date ahead that has not been cleared. When it is showing a date that needs a decision it has the same buttons, and clearing it brings the next one up. A date that is merely the nearest ahead has none, as in the app. |

How they get their content:

- **The app writes it down.** `src/native/widgetBridge.ts` hands `WidgetBridgePlugin` a payload whenever the data, the household, the currency or the language changes, and once more as the app goes to the background. The payload is the snapshot from [snapshot.md](snapshot.md), the same object every other surface reads, plus the widgets' own few words, already in the app's language. The native side has no string catalog for them.
- **Countdowns are worked out when the widget draws**, from each date, not baked in. A widget is drawn hours after the app last ran; "T-12d" has to be right then. The system redraws them every six hours, and the background refresh hands them a new snapshot about as often.
- **A widget reads the payload inside its composition** (`rememberWidgetData`). Reading it once before composing is the obvious thing and is wrong: Glance keeps a drawn widget's composition alive for a while, and an update only recomposes it with what it read at the start.
- **A missing or unreadable payload draws as "open the app"**, never as the system's error tile. Rows without a key or a real date are left out.
- **A tap on a row is a `thingglance://` link** (the snapshot carries one for every date): it opens the app somewhere and changes nothing.
- **"Send to dayGLANCE" is offered only when the app is connected to dayGLANCE** (the payload says so). A button that can only fail is worse than no button. A date sent this way reads as sent at once and keeps its tick; the app does the sending, since it holds the key and the connection. If the vault cannot be reached the send stays queued and is tried again, so the task is not silently lost; if dayGLANCE has been switched off meanwhile it is dropped and the row goes back to open.
- **The buttons are the only things a widget can change, and it does not change them itself.** A widget cannot run the app, so `ClearDateAction` queues a write in `SharedDataStore`, in the shape the app's one door for outside writes takes (`{ action, payload, clientId }`), with an id it mints. The row leaves the widget at once, because a widget hides any date with a write waiting. The app collects the queue when it starts, when it comes to the front, and straight away if it happens to be running (`collectWidgetWrites` in `src/native/widgetBridge.ts`), and applies each through `dispatchExternalWrite`, so a write collected twice is applied once. A write is taken off the queue only after the widgets have been handed a snapshot that reflects it; the other way round, the row would flash back.
- **The rest follows without the app being opened.** The date's reminders on this phone are cancelled at once, and a background refresh is asked for, which carries the write to the vault and so to the household's other devices.

Settings has an "add to home screen" button for each (Android 8 and later, where the launcher supports it).

`WidgetDataTest` (run with `./gradlew testDebugUnitTest` in `android/`) pins the countdown against the web app's own notation, feeds the parser broken payloads, and checks the write queue. The device check places both widgets on the emulator's home screen, reads what they show, taps a row, then kills the app and taps a tick.

## Reminders

Android notifications for the dates that are worth one. Which dates, when, and on whose device is decided in `src/core/reminders.ts` and travels in the snapshot. The scheduling is native (`reminders/`), so it works whoever brings the plan: the app on screen, a background refresh with no screen, or a tick on a widget.

- **The snapshot is the hand-over.** The payload the widgets draw from carries the reminder plan too. Whenever it arrives (`WidgetBridgePlugin.updateSnapshot`, or the same call from a background refresh), `ReminderScheduler` makes Android's alarms match it: what is new or changed is scheduled, what is gone is cancelled, and an unchanged plan touches nothing. `ReminderPlan.diff` is the Kotlin mirror of `diffReminders()` in core, and `ReminderPlanTest` holds the two together, down to the id hash.
- **Inexact alarms, on purpose.** "Your warranty ends in a week" does not need to arrive to the second, and exact alarms are a permission Play restricts to alarm clocks and calendars. Expect a reminder a minute or two after its time.
- **Permission is asked once**, by Android's own prompt, at the first moment there is something to remind about (Android 13 and later; older versions need none). Settings → General has the switch and the time of day. Alarms are set either way; without permission Android shows nothing.
- **A tap opens the date** (a `thingglance://` link). **The buttons do not open the app.** "Done with this" dismisses the notification, cancels the date's other reminders, takes it off the widgets, and queues the write for the app, exactly as a widget tick does. "Send to dayGLANCE" (shown when the app is connected to dayGLANCE) does the same with a send: the date is dayGLANCE's to remind about from then on.
- **A tick on a widget cancels that date's reminders at once**, on this phone, without waiting for the app.
- **Words come from the app.** The title and body are the snapshot's. The channel name and the button label travel with the payload and are kept, so a reminder that fires while the app is closed still has them.
- **After a restart of the phone, or an update of the app,** the alarms are set again from what was held. One that came due in the meantime is dropped, not sent late.

There is no notifications plugin: an earlier version scheduled from the web side through `@capacitor/local-notifications`, which could only happen with the app open.

## Background refresh

A few times a day, and soon after something is done on the home screen while the app is closed, the app catches up without being opened (`refresh/`, `src/headless/`).

What a run does, in order: sync with the vault; apply what was ticked on widgets and notifications; sync again to push those; hand over a fresh snapshot, from which the widgets are redrawn and the reminders re-planned. A device with no vault still gets the last two, because dates move into their windows whether or not anything syncs.

- **It is the web app, with no screen.** `RefreshWorker` boots the same bundle in a WebView that has no Activity, at `https://localhost/index.html?headless=refresh`, the app's own origin, so it works on the app's own storage. `main.tsx` runs `runHeadlessRefresh()` there instead of the app.
- **It is a shell like any other.** There is no Capacitor without an Activity, so `HeadlessBridge` offers the run a keystore and HTTP, and `src/headless/headlessMode.ts` registers them through the same seams the app uses ([shells.md](shells.md)). From there on it is ordinary app code: the same engines, the same door for outside writes, the same snapshot.
- **An allowlist on both sides.** The run starts only what its list needs; nothing renders. `HeadlessBridge` has nine methods and no others, and a test holds the web side to exactly those.
- **Two pages never work on the same storage.** If the app is opened during a run, `MainActivity` destroys the run's WebView before its own page loads, and the run also checks between steps. Nothing is lost: a write leaves the native queue only after it has been applied and the home screen updated, and whatever was applied but not yet pushed goes up with the app's own first sync.
- **If the app is alive but not on screen** when the routine run comes due, no second page is started. The app's own page is asked to do the same work.
- **Two triggers.** The routine run is periodic work, about every six hours (Android decides exactly when). The other is asked for by a widget tick or a notification's "Done with this" when the app is closed, waits for a network, and is not repeated within a minute: a request that comes too soon is not dropped but answered by one more run when the minute is up, so several taps are one run.
- **It leaves a record.** The last twenty runs are kept (what triggered each, when, how it went). Settings → General shows when the last one finished.

On the emulator a run takes well under a second of work.

`RefreshPolicyTest` covers the decisions; `src/headless/headlessRefresh.test.ts` covers the run's order, its failures and the allowlist. The device check ticks a date with the app killed and watches it reach a web device, then adds a thing on the web and watches it reach the phone's widgets and get a reminder, all with the phone app never opened. Android will not run periodic work ahead of its schedule however it is asked, so debug builds have a hook for the check (`DebugRefreshReceiver`, under `src/debug`, not in a release build).

Other choices worth knowing:

- **Cleartext HTTP is allowed**, so a self-hosted vault on a home network (`http://192.168.x.x:8080`) works. Android cannot scope that to the local network. Everything sent to a vault is encrypted before it leaves; what plain HTTP exposes is the device token, so use HTTPS for a vault reachable from outside.
- **Cloud backup leaves out the WebView's storage and the Keystore entries.** The vault, or the in-app backup file, is how data moves to a new phone. A direct phone-to-phone transfer is allowed; credentials do not survive it (the Keystore key stays behind), so the new phone asks to connect again.
- **`minifyEnabled` stays off.** Plugin bridges are found by reflection.
- **Icons and splash images** are rendered from the web app's artwork by `node scripts/gen-android-icons.mjs`.

## Not there yet

- **More widgets** (a single thing, plans this month, an add tile).
- Quick Settings tiles, Tasker.
- **A release build.** Nothing has been signed or uploaded. The Play listing (paid, $9.99) and its closed test are still to be set up.
