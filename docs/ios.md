# iOS

The iPhone and iPad app is the web app in a Capacitor 8 shell (`ios/`), as the Android app is. The model is lastGLANCE's (`../lastGLANCE/docs/ios-native-features-plan.md`), minus what thingGLANCE does not have: no iCloud, no billing, no Direct Access.

| | |
| --- | --- |
| Bundle ID | `com.thingglance.app`, the same as Android and the Mac App Store |
| App Group | `group.com.thingglance.app` |
| Runs on | iOS 15 and later |
| Origin | `capacitor://localhost`. The data is keyed by it |

Built so far: the app itself, the shell seams (keychain, network, live sync, links), reminders with their buttons, and the App Group hand-off the widgets will read. Still to come: the widgets, the Control Center control, home-screen quick actions, App Shortcuts and the share extension.

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
- `scripts/ios-webview.py <device> com.thingglance.app '<expression>'` evaluates JavaScript in the running app's WebView (a debug build's is inspectable) and prints the result, awaiting a promise: `'Capacitor.Plugins.Reminders.pending()'`, for one. It speaks the Web Inspector's own protocol to the simulator, so it needs nothing installed.
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

`ios/App/Packages/GlanceKit` is a small Swift package the app links and the extensions will: Foundation only, so its tests run on a Mac.

- `SharedStore` is the App Group's defaults: the payload the app writes (`{ snapshot, labels, canSend, launcher }`, as `src/native/widgetBridge.ts` builds it for Android), and the queue of writes made outside the app.
- `PendingWrites` is that queue: `{ action, payload, clientId }` entries, `decide` and `send`, the same objects Android queues. Nothing native applies one. The app collects them (`collectWidgetWrites`), puts each through `dispatchExternalWrite()`, hands over a snapshot that shows the result, and only then acknowledges.
- `ReminderPlan` reads the reminders out of the payload and works out what to schedule and cancel.

The group must be on the App ID in the developer portal and in every extension's entitlements, spelled the same. A wrong name fails without a word: `WidgetBridgePlugin.updateSnapshot` rejects when the group is missing, which is the one place it shows.

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

Not checked: a real device, a signed build, TestFlight, the App Store record, a reminder arriving on its own day with the app closed, "Send to dayGLANCE" from a reminder, and an iPad.

## Before the first upload

- An App ID `com.thingglance.app` with the App Groups capability, the group `group.com.thingglance.app`, and a development team set on the App target in Xcode (none is committed).
- The annual encryption self-classification report: `ITSAppUsesNonExemptEncryption` is `false` because the app uses only standard algorithms for end-to-end sync, as the sibling apps declare.
