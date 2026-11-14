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
- the back button closes the keyboard, then the sheet, then returns to the first screen, then leaves the app without closing it;
- a thing added on the phone reaches a web device through a real vault, and the other way;
- after being killed, the app is still connected and asks for no passphrase.

```bash
./build-android.sh --webview-debug
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
npm run dev                      # the web device it syncs against
# a throwaway vault, as in the header of e2e/vault-sync.mjs
node scripts/android-check.mjs emulator-5554
```

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
| Links | The manifest takes `thingglance://` URLs. `@capacitor/app` hands them to `openLink()`, both when the app is running and when a link starts it. |
| Back button | `src/native/backStack.ts`: the app registers what "back" closes; the shell leaves the app only when nothing was closed. |
| Status bar | Transparent, with icons that follow the app's theme. The layout keeps clear of it with the safe-area insets. |
| Service worker | Never registered in the WebView. |

Other choices worth knowing:

- **Cleartext HTTP is allowed**, so a self-hosted vault on a home network (`http://192.168.x.x:8080`) works. Android cannot scope that to the local network. Everything sent to a vault is encrypted before it leaves; what plain HTTP exposes is the device token, so use HTTPS for a vault reachable from outside.
- **Cloud backup leaves out the WebView's storage and the Keystore entries.** The vault, or the in-app backup file, is how data moves to a new phone. A direct phone-to-phone transfer is allowed; credentials do not survive it (the Keystore key stays behind), so the new phone asks to connect again.
- **`minifyEnabled` stays off.** Plugin bridges are found by reflection.
- **Icons and splash images** are rendered from the web app's artwork by `node scripts/gen-android-icons.mjs`.

## Not there yet

- **Live updates.** The web app holds the vault's event stream open; the phone does not yet. A change made elsewhere arrives when the app is opened, every five minutes while it is open, or after a local edit. A native stream reader is in the roadmap's hardening step.
- **Widgets, notifications, shortcuts, the share target, Tasker.** The snapshot and the reminder plan they will read are already in place (`docs/snapshot.md`).
- **A release build.** Nothing has been signed or uploaded. The Play listing (paid, $9.99) and its closed test are still to be set up.
