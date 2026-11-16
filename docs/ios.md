# iOS

The iPhone and iPad app is the web app in a Capacitor 8 shell (`ios/`), as the Android app is. The model is lastGLANCE's (`../lastGLANCE/docs/ios-native-features-plan.md`), minus what thingGLANCE does not have: no iCloud, no billing, no Direct Access.

| | |
| --- | --- |
| Bundle ID | `com.thingglance.app`, the same as Android and the Mac App Store |
| App Group | `group.com.thingglance.app` |
| Runs on | iOS 15 and later |
| Origin | `capacitor://localhost`. The data is keyed by it |

Built: the app itself, the shell seams (keychain, network, live sync, links), reminders with their buttons, the widgets (Home Screen, Lock Screen and a Control Center button), quick actions on the icon, shortcuts for Siri and Spotlight, and sharing into the app.

## Build it

```bash
npm run build:ios          # the web build, `cap sync ios`, and the version file
open ios/App/App.xcodeproj # then run on a simulator or a device from Xcode
```

There are no CocoaPods: Capacitor and its plugins are Swift packages (`ios/App/CapApp-SPM`, written by `cap sync`; do not edit it).

**Versions come from a generated file, never from Xcode's General tab.** `scripts/sync-ios-version.mjs` writes `ios/version.generated.xcconfig`, which both of the project's base configurations include, so the app and every extension ship the same two numbers. The version is `package.json`'s. The build number is the number Android's `versionCode` is (1.0.0 is 1000000); a second upload of the same version needs the next one, `IOS_BUILD=1000001 npm run build:ios`. The script refuses to run if `project.pbxproj` sets either value itself, because a target's own setting wins without a word.

The icon and the launch image are generated from `public/icons/icon.svg`: `node scripts/gen-ios-icons.mjs` after a brand change, and commit the output.

## Check it on a simulator

```bash
xcrun simctl boot 'iPhone 17'
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath /tmp/tg-ios build
xcrun simctl install booted /tmp/tg-ios/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch --console-pty booted com.thingglance.app   # every bridge call is printed
```

- `npm run test:ios` runs the shared Swift package's tests on the Mac, with no simulator.
- `scripts/ios-webview.py <device> com.thingglance.app '<expression>'` evaluates JavaScript in the running app's WebView (a debug build's is inspectable) and prints the result, awaiting a promise: `'Capacitor.Plugins.Reminders.pending()'`, for one. It speaks the Web Inspector's own protocol to the simulator, so it needs nothing installed. Give it several expressions, or `-` to read one per line, to keep one connection open: a new connection that follows another waits about ten seconds.
- A local vault over plain http works from the simulator (`http://localhost:8791`, as in the header of `e2e/vault-sync.mjs`).
- `xcrun simctl openurl booted 'thingglance://queue'` opens a link.
- A reminder can be shown without waiting for its day: `xcrun simctl push booted com.thingglance.app payload.apns`, where the payload carries `aps.alert`, `aps.category` (`tg.date` or `tg.date.send`) and, beside `aps`, the reminder's `id`, `eventKey` and `link`.

CI (`.github/workflows/ios.yml`) runs the Swift tests and compiles the app for the simulator, unsigned, on every change under `ios/`, `src/` and the scripts.

## What the shell does

The seams are the ones in [shells.md](shells.md); `src/native/capacitor.ts` registers them for both phones.

| | |
| --- | --- |
| **Plugins** | The app's own plugins are not found by themselves on iOS. `BridgeViewController` registers each one, and `SceneDelegate` puts that controller in the window. With a plain `CAPBridgeViewController` there, every plugin is undefined on the web side |
| **Keystore** | `SecureStorePlugin`: the Keychain, this device only, readable after the first unlock. Nothing stored is a `null`; a Keychain that cannot be used is a rejection, which the app treats differently (`src/sync/secrets.ts`) |
| **Signing out by deleting** | The Keychain outlives the app. On the first run after an install the plugin clears what an earlier copy left, so deleting thingGLANCE signs this device out, as on Android |
| **Network** | `CapacitorHttp` puts `fetch` on the native stack, so the vault needs no CORS entry. Plain http is allowed to the local network only (`NSAllowsLocalNetworking`): a vault at home works, and nothing further away is reached without TLS |
| **Live sync** | `VaultSsePlugin` and `VaultSseClient` read the vault's event stream natively and pass each event in; the WebView cannot stream it. Copied from lastGLANCE. It runs only while the app is in front, and only ever makes a sync come sooner |
| **Links** | `thingglance://` is in `Info.plist`. Capacitor hands a link to the web side, which opens it in one place (`src/state/useLinks.ts`). A link only navigates |
| **Keyboard** | The WebView itself shrinks when the keyboard comes up (`@capacitor/keyboard`, `resize: native`), which is what `interactive-widget=resizes-content` does on Android. The plugin is left out of the Android build (`android.includePlugins`) |
| **Focus** | A field focused by the page does not raise the keyboard; a tap does. Capacitor's default is the other way, which threw the keyboard over every form as it opened |
| **Zoom** | On an iPhone the viewport is capped at scale 1 (`src/native/viewportZoom.ts`), or focusing a small field zooms the page with no way back |
| **Owned since** | `OwnershipPlugin` answers with the App Store's own date for the purchase (`store: "appstore"`), and only for a copy the App Store installed. A record, never a check ([release.md](release.md#owned-since)) |

## The App Group

`ios/App/Packages/GlanceKit` is a small Swift package the app and the widget extension both link: Foundation only, so its tests run on a Mac.

- `SharedStore` is the App Group's defaults: the payload the app writes (`{ snapshot, labels, canSend, launcher }`, as `src/native/widgetBridge.ts` builds it for Android), and the queue of writes made outside the app.
- `PendingWrites` is that queue: `{ action, payload, clientId }` entries, `decide` and `send`, the same objects Android queues. Nothing native applies one. The app collects them (`collectWidgetWrites`), puts each through `dispatchExternalWrite()`, hands over a snapshot that shows the result, and only then acknowledges.
- `ReminderPlan` reads the reminders out of the payload and works out what to schedule and cancel.
- `OutsideLinks` is the links made outside the app: one place the app was asked to open at, and a queue of things shared into it. See [Other ways in](#other-ways-in).
- `WidgetData` is what a widget draws: the dates, charges and things read out of the payload, less whatever was ticked outside the app since. `Countdown` is the days arithmetic and the `T-12d` notation.

The group must be on the App ID in the developer portal and in every extension's entitlements, spelled the same. A wrong name fails without a word: `WidgetBridgePlugin.updateSnapshot` rejects when the group is missing, which is the one place it shows.

## Widgets

The extension is `ios/App/GlanceWidgets` (target `GlanceWidgetsExtension`, bundle ID `com.thingglance.app.widgets`, iOS 17 and later; the app itself still runs on 15). It is the Android set ([android.md](android.md#widgets)), drawn from the same payload:

| Widget | Sizes | Shows |
| --- | --- | --- |
| Needs a decision | medium, large | The queue, most pressing first, each date with a tick and, where this device is connected to dayGLANCE, a send button |
| Next up | small, medium | One date: the first in the queue, or with nothing waiting the next one ahead |
| Plans, next 30 days | small, medium, large | What the plans will charge, and the total |
| A single thing | small, medium | One thing's life-left ring, verdict and countdown. Edit Widget picks which; left alone it is the thing closest to the end of its window |
| Add a thing | small | Opens the app on a new thing |
| Waiting (Lock Screen) | circular, inline | How many dates are waiting |
| Next up (Lock Screen) | rectangular | The next date, counted down |

- **Nothing is baked in.** A widget is drawn hours after the app last ran, so it counts the days itself; each timeline is one entry and a refresh at midnight. The app reloads the timelines whenever it hands over a new payload.
- **A tick runs in the extension**, with no app and no WebView (`EventIntents.swift`). It queues a `decide` or a `send` in the App Group and reloads the widgets, which leave the date out, or mark it sent, by reading the queue. The app applies the write when it next runs. The two intents are not offered in the Shortcuts app.
- **Lists do not scroll** in WidgetKit, so the row count is measured: `ViewThatFits` takes the longest list that fits, and a last line says how many more there are.
- **The words are the app's.** Titles, empty lines, verdict names and the countdown's units come from the payload's `labels`, in the app's language. What iOS shows before any payload exists, and in the widget gallery, is English in the Swift.
- **A chosen thing that is gone** keeps the widget's choice and says "No longer tracked", where dropping the choice would quietly show another thing.
- Settings says where the widgets are; iOS has no way for an app to offer one.
- **Restart the device before believing a widget bug.** A stale WidgetKit cache survives a reinstall.

## Other ways in

Every one of these ends in a link or in the widgets' queue, the two doors in [links-and-intents.md](links-and-intents.md). None changes data by itself.

- **Quick actions on the icon** (long-press): Add a thing, Add a plan, Needs a decision, as on Android. They are in `Info.plist`, and an item's type is the link it opens.
- **Shortcuts for Siri, Spotlight and the Shortcuts app** (`App/Shortcuts/ThingShortcuts.swift`, iOS 17 and later). "What's next" answers with how many dates are waiting and which comes first, and "Settle a date" marks one in the queue as done with; both run with the app closed, from what the app last wrote to the App Group, and settling queues a `decide` like a widget's tick. "Add a thing" and "Show what needs a decision" open the app. Every phrase carries the app's name, or iOS drops it without a word.
- **The Control Center button** (iOS 18): Add a thing. Its file (`ios/App/Shared/AddThingControl.swift`) is in both the app and the widget extension: the extension shows the control, and the app has to hold the intent too or a tap does nothing. That intent is hidden from the Shortcuts app, where one vended by two targets would appear twice.
- **Sharing into the app** (`ios/App/ShareExtension`, `com.thingglance.app.share`). Share a product page or a name from any app. The page's title wins; failing that, the shared text without its links; a bare address names nothing, so the form opens empty: Android's rule, and the same `thingglance://action/add?name=` link. A share extension can never open its app, so the link waits and the form opens the next time thingGLANCE comes to the front. Several shares queue, and open one per visit.

**How a link made outside reaches the page.** An extension cannot hand the app a link, and an intent that opens the app runs before the page exists. So the native side writes the link down in the App Group (`SharedStore.setPendingLink`, `queueShare`) and the web side takes it (`WidgetBridge.takeLink()`, `followQueuedLinks()` in `src/native/capacitor.ts`): at the start, when told one is waiting, and each time the app comes to the front. Only a `thingglance://` link is ever handed on, and it goes to `openLink()` like any other. A tap on a reminder and a `thingglance://` URL from another app still arrive through Capacitor.

## Reminders

Which dates notify, and when, is decided in `src/core/reminders.ts` and travels in the snapshot. `ReminderScheduler` makes the system's pending notifications match that list each time the app hands over a payload: it schedules what is new, cancels what is gone and leaves the rest. iOS delivers them with the app closed.

- **The system is the only record.** Each request carries the reminder it was made from, so there is no second list to drift.
- **56 at most**, the soonest first. iOS keeps 64 per app and drops the rest without a word.
- **By the wall clock**: a reminder for nine stays at nine if the phone changes time zone before the app next runs.
- **Buttons.** "Done with this", and "Send to dayGLANCE" when this device is connected to it. A button queues a write, with an id made from the reminder's, and the app applies it when it next runs: at once if it is running, otherwise on the next open. A tap on the reminder itself opens its link.
- **Permission** is asked once, the first time there is something to remind about (`src/native/notifications.ts`), and scheduling starts as soon as it is given.
- **Capacitor must not take the notification delegate** (`ios.handleApplicationNotifications: false` in `capacitor.config.ts`). Left on, it replaces `ReminderResponder` when the bridge starts, and every reminder is hidden while the app is open and every button dropped.

Unlike Android, nothing refreshes in the background yet: a date settled on another device stays scheduled here until the app is next opened.

## What was checked, and what was not

On the iPhone 17 simulator (iOS 27.2), with a throwaway local vault:

- The app starts, and all five of its plugins answer.
- Sample data writes the payload to the App Group; with permission given, 43 reminders were pending, one for each in the plan.
- A reminder's "Done with this" queued the write, the running app applied it, and the queue went from 4 dates to 3.
- A `thingglance://event/...` link opened the plan it names.
- Connecting to the vault kept the connection in the Keychain; a restart was still connected and asked for no passphrase; deleting and reinstalling the app started signed out.
- A thing added on the phone reached a browser on the same account, and one added in the browser reached the phone within seconds, with the native stream connected.

- The widgets drew from the sample data in the gallery in every Home Screen size. With "Needs a decision" on the Home Screen, a tick removed the date at once and queued the write; opening the app applied it (4 dates to 3) and emptied the queue.

- The icon's three quick actions: "Add a plan" opened its form in the running app, and "Add a thing" did from a cold start.
- The four shortcuts and their eight phrases are in the app's App Intents metadata, and both extensions are embedded.

Not checked: the share extension and the shortcuts by hand (Siri, Spotlight, the Shortcuts app), the Control Center button, the Lock Screen widgets and "Add a thing" by eye, the thing picker, a widget in dark mode, a real device, a signed build, TestFlight, the App Store record, a reminder arriving on its own day with the app closed, "Send to dayGLANCE" from a reminder, and an iPad.

## Before the first upload

The whole checklist is [release-apple.md](release-apple.md). The two things the build itself depends on:

- App IDs `com.thingglance.app`, `com.thingglance.app.widgets` and `com.thingglance.app.share`, each with the App Groups capability and the group `group.com.thingglance.app`, and a development team set on all three targets in Xcode (none is committed).
- The annual encryption self-classification report: `ITSAppUsesNonExemptEncryption` is `false` because the app uses only standard algorithms for end-to-end sync, as the sibling apps declare.
