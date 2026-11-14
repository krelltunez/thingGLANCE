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
- both widgets can be placed, show the right date and countdown, and open the app on a tap;
- the tick on a widget row clears the date with the app not running, the write waits in a queue, and the app applies it once when it next runs;
- a reminder is scheduled at the chosen time, delivered by Android with the app in the background, and "Done with this" on it clears the date;
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

Two things to know when writing checks like it:

- While DevTools is attached, the page is held "visible". It never hears that the app went to the background and came back, so the sync that runs on coming to the front does not run. Detach before sending the app to the background and attach again afterwards.
- The first back press in a form goes to the on-screen keyboard, as in any Android app.

## What the shell does

Everything goes through the seams in [shells.md](shells.md). The Android side of each:

| Seam | Android |
| --- | --- |
| Keystore | `SecureStorePlugin` and `SecureStore` (`android/app/src/main/java/com/thingglance/app`). AES-GCM values in a private preferences file, the key in the Android Keystore. Nothing stored answers `null`; a Keystore that cannot be used rejects, and the web side tells the two apart. An entry that can never be read again (restored onto another device) is dropped. |
| Network | `CapacitorHttp` replaces `window.fetch` with the native HTTP stack. `src/native/capacitor.ts` registers it as the shell's transport, which also puts the app's deadlines on it (it ignores `AbortSignal` by itself). |
| Links | The manifest takes `thingglance://` URLs. `@capacitor/app` hands them to `openLink()`, both when the app is running and when a link starts it. `LaunchLinks` turns every other way of starting the app into such a link first, so the web side still has one router. |
| Back button | `src/native/backStack.ts`: the app registers what "back" closes; the shell leaves the app only when nothing was closed. |
| Status bar | Transparent, with icons that follow the app's theme. The layout keeps clear of it with the safe-area insets. |
| Service worker | Never registered in the WebView. |

## Other ways in

- **Sharing into the app.** Share a product page or a name from any app and the add form opens with it filled in. The page title wins; failing that, the shared text without its links; a bare address names nothing, so the form opens empty. It becomes an ordinary `thingglance://action/add?name=` link (`LaunchLinks`).
- **Shortcuts on the app icon** (long-press): Add a thing, Add a plan, Needs a decision. Each is a link (`res/xml/shortcuts.xml`).
- **An old start is not replayed.** When Android rebuilds the app after killing it, or reopens it from Recents, it hands over the intent that first started it. `LaunchLinks` strips a link or a share from such a replay, so a form closed hours ago does not reopen.

## Widgets

Two so far, both Jetpack Glance (`android/app/src/main/java/com/thingglance/app/glance`):

| Widget | Shows |
| --- | --- |
| **Needs a decision** | The app's queue: each date inside its lead window, with its countdown. It scrolls. A tap on a row opens that date; the tick at its end clears it without opening the app; the title opens the queue. |
| **Next up** | One line: what needs a decision first, else the nearest date ahead that has not been cleared. |

How they get their content:

- **The app writes it down.** `src/native/widgetBridge.ts` hands `WidgetBridgePlugin` a payload whenever the data, the household, the currency or the language changes, and once more as the app goes to the background. The payload is the snapshot from [snapshot.md](snapshot.md), the same object every other surface reads, plus the widgets' own few words, already in the app's language. The native side has no string catalog for them.
- **Countdowns are worked out when the widget draws**, from each date, not baked in. A widget is drawn hours after the app last ran; "T-12d" has to be right then. The system redraws them every six hours even if the app is never opened.
- **A widget reads the payload inside its composition** (`rememberWidgetData`). Reading it once before composing is the obvious thing and is wrong: Glance keeps a drawn widget's composition alive for a while, and an update only recomposes it with what it read at the start.
- **A missing or unreadable payload draws as "open the app"**, never as the system's error tile. Rows without a key or a real date are left out.
- **A tap on a row is a `thingglance://` link** (the snapshot carries one for every date): it opens the app somewhere and changes nothing.
- **The tick is the one thing a widget can change, and it does not change it itself.** A widget cannot run the app, so `ClearDateAction` queues a write in `SharedDataStore`, in the shape the app's one door for outside writes takes (`{ action, payload, clientId }`), with an id it mints. The row leaves the widget at once, because a widget hides any date with a write waiting. The app collects the queue when it starts, when it comes to the front, and straight away if it happens to be running (`collectWidgetWrites` in `src/native/widgetBridge.ts`), and applies each through `dispatchExternalWrite`, so a write collected twice is applied once. A write is taken off the queue only after the widgets have been handed a snapshot that reflects it; the other way round, the row would flash back.
- **Until the app has run, only the widget knows.** The date's reminder is still scheduled and other devices still show it. A background refresh would close that gap; it is not built yet.

Settings has an "add to home screen" button for each (Android 8 and later, where the launcher supports it).

`WidgetDataTest` (run with `./gradlew testDebugUnitTest` in `android/`) pins the countdown against the web app's own notation, feeds the parser broken payloads, and checks the write queue. The device check places both widgets on the emulator's home screen, reads what they show, taps a row, then kills the app and taps a tick.

## Reminders

Android notifications for the dates that are worth one. Which dates, when, and on whose device is decided in `src/core/reminders.ts` and travels in the snapshot; `src/native/notifications.ts` only makes what Android has pending match that plan.

- **A diff, not a reschedule.** `diffReminders()` (in core, so every shell does it the same way) says what to schedule and what to cancel. Each notification carries a signature of what it shows, so one whose time or wording changed is replaced and one that is unchanged is left alone. It runs whenever the snapshot is rebuilt.
- **Inexact alarms, on purpose.** "Your warranty ends in a week" does not need to arrive to the second. Exact alarms are a special permission on Android 12 and later that Play restricts to alarm clocks and calendars, so the app does not ask for it, and the manifest removes the one the notifications plugin declares. Expect a reminder a minute or two after its time.
- **Permission is asked once**, by Android's own prompt, at the first moment there is something to remind about (Android 13 and later; older versions need none). Settings → General has the switch and the time of day. Without permission nothing is scheduled.
- **A tap opens the date.** "Done with this" on the notification clears it, through the same door every write from outside uses (`dispatchExternalWrite`), with the reminder's own id, so a tap delivered twice clears once.
- **Words come from the app.** The title and body are the snapshot's; the channel name and the action label come from the catalog and are registered again when the language changes.
- **After a restart of the phone** the notifications plugin puts the pending ones back.

The device check sets the reminder time two minutes ahead, adds a thing whose warranty ends in exactly seven days, waits for Android to deliver the notification with the app in the background, and taps "Done with this".

Other choices worth knowing:

- **Cleartext HTTP is allowed**, so a self-hosted vault on a home network (`http://192.168.x.x:8080`) works. Android cannot scope that to the local network. Everything sent to a vault is encrypted before it leaves; what plain HTTP exposes is the device token, so use HTTPS for a vault reachable from outside.
- **Cloud backup leaves out the WebView's storage and the Keystore entries.** The vault, or the in-app backup file, is how data moves to a new phone. A direct phone-to-phone transfer is allowed; credentials do not survive it (the Keystore key stays behind), so the new phone asks to connect again.
- **`minifyEnabled` stays off.** Plugin bridges are found by reflection.
- **Icons and splash images** are rendered from the web app's artwork by `node scripts/gen-android-icons.mjs`.

## Not there yet

- **Live updates.** The web app holds the vault's event stream open; the phone does not yet. A change made elsewhere arrives when the app is opened, every five minutes while it is open, or after a local edit. A native stream reader is in the roadmap's hardening step.
- **More widgets** (a single thing, plans this month, an add tile).
- **"Send to dayGLANCE" on a notification**, Quick Settings tiles, Tasker.
- **A background refresh.** If the app is not opened for days, the widgets keep counting down correctly but do not learn of dates that have since entered their window.
- **A release build.** Nothing has been signed or uploaded. The Play listing (paid, $9.99) and its closed test are still to be set up.
