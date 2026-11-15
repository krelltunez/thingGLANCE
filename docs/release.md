# Releasing the Android app

How a build gets from this repository to Google Play: the key, the build, what is in it, and what the Play Console will ask. The parts only the publisher can do are marked **(yours)**.

Times in release notes are Mountain Time, and release notes contain no em dashes (the family's rules).

## Once: the upload key **(yours)**

A release is signed with a key that is never in the repository.

```bash
keytool -genkeypair -v -keystore ~/keys/thingglance-upload.jks \
  -alias thingglance -keyalg RSA -keysize 4096 -validity 10000
```

Then copy `android/keystore.properties.example` to `android/keystore.properties` and fill in the four lines. Both that file and any `*.jks` or `*.keystore` are ignored by git.

- **Use Play App Signing** (the default for a new app). Google then holds the key that installs are signed with, and the one above is only the *upload* key: if it is lost, Google can reset it. Without Play App Signing, losing the key means the app can never be updated.
- Keep the keystore and its passwords somewhere that outlives this machine, and outside the repository's folder.
- CI is never given the key. It builds and tests a debug build only (`.github/workflows/android.yml`).

## Each release

1. **Set the version** in `package.json` (`npm version patch`, `minor` or `major`). The Android version name is read from there, and the version code follows from it: `major*1000000 + minor*10000 + patch*100`, so 0.1.0 is 10000 and 1.0.0 is 1000000. The first public release is 1.0.0 (settled 2026-11-15: it is a paid app, and a 0.x number tells a buyer it is not finished). The test uploads made as 0.1.0 have lower codes, so Play accepts it after them.
2. **Run the checks**: `npm run lint`, `npm test`, `npx tsc -b`, `npm run test:e2e`, `./gradlew testDebugUnitTest` in `android/`, and the device check on an emulator ([android.md](android.md#check-it-on-an-emulator)). The device check needs a `--webview-debug` build, so run it before the release build, not on it.
3. **Build**:

   ```bash
   ./build-android.sh --release
   ```

   | File | What it is |
   | --- | --- |
   | `outputs/thingglance.aab` | The bundle Play takes. |
   | `outputs/thingglance.apk` | The same build as an installable APK, for trying it on a phone first. |
   | `outputs/SHA256SUMS.txt` | Checksums of both. |

   The script refuses to build a release without `keystore.properties`, or with an inspectable WebView, and it checks both signatures before it finishes. It prints the signing certificate's SHA-256, which should be the same every time.
4. **Try the APK** on a real phone: `adb install outputs/thingglance.apk`. It cannot be installed over a debug build or a Play install, which are signed with other keys: uninstall first.
5. **Upload the bundle** to a testing track **(yours)**, then promote the one that passes. Do not rebuild it for production.

### Test uploads of the same version

Play refuses any upload whose version code is not higher than every one before it, on any track. For a second try at the same version:

```bash
./build-android.sh --release --build 2    # 0.1.0 becomes code 10002
```

`N` runs from 1 to 99 and only ever goes up. The version name stays the same.

## What is in the build

Facts the Play Console asks for, checked against a release build made by this script.

| | |
| --- | --- |
| Application id | `com.thingglance.app` |
| Minimum Android | 7.0 (API 24) |
| Target | Android 16 (API 36) |
| Native code | None. The 16 KB page size requirement has nothing to apply to. |
| Debuggable | No, and the WebView cannot be inspected. |
| Minified | No (`minifyEnabled false`): plugin bridges are found by reflection. No mapping file to upload. |

**Permissions**, all granted at install except notifications:

| Permission | Why |
| --- | --- |
| `INTERNET`, `ACCESS_NETWORK_STATE` | Syncing with a vault, and the web lookup. |
| `POST_NOTIFICATIONS` | Reminders. Asked for the first time there is something to remind about. |
| `RECEIVE_BOOT_COMPLETED` | Setting the reminders' alarms again after a restart. |
| `WAKE_LOCK`, `FOREGROUND_SERVICE` | Declared by WorkManager, which runs the background refresh. The app starts no foreground service of its own, and declares no foreground service type. |

No exact-alarm permission: reminders use inexact alarms. No location, camera, contacts, storage or advertising id.

**What other apps can reach** (exported): the main activity (launch, `thingglance://` links, text shared from another app, `app.thingglance.OPEN`), the two Quick Settings tiles (only the system can bind them), the single-thing widget's picker, and the automation receiver, which does nothing until the user turns it on ([tasker.md](tasker.md)).

## Where data goes

For the Data safety form and the privacy policy. This is what the code does; how to answer the form is **(yours)**.

- **By default, nowhere.** Everything is kept in the app's own storage on the phone. There is no account, no analytics, no advertising and no crash reporting, and no SDK that does any of those.
- **Sync, if the user connects a vault.** Things, plans, dates and the names of household members are sent to the GLANCEvault server the user chooses: their own, or GLANCEvault Pro at `sync.glancevault.com`. They are encrypted on the phone with a key made from the user's passphrase, so the server holds what it cannot read. The connection itself carries a device token and an account id.
- **Web lookup, when the user uses it** (on by default; a switch in Settings turns it off). The product name typed into the lookup box is sent to Wikipedia and to endoflife.date, which answer with a photo, specs and dates. Nothing else goes with it.
- **dayGLANCE**, if the user turns it on: a date sent as a task travels through the same vault, encrypted the same way.
- **Automation apps**, if the user turns that on: other apps on the phone can add things and read the snapshot ([tasker.md](tasker.md)). It does not leave the phone.
- **Android's cloud backup** leaves out the app's data, the stored credentials, what the widgets show and the reminders (`res/xml/data_extraction_rules.xml`). Moving to a new phone is done through the vault or the in-app backup file. The one thing it keeps is the record that the app was bought ([Owned since](#owned-since)): a date and the store's name, in the user's own Google backup, never sent to the developer.
- Requests may go over plain HTTP only to a vault address the user typed that way (a server on their home network). Google's Data safety form treats data the developer cannot read because it is end-to-end encrypted differently from data it collects; check its current wording when answering.

## Owned since

Built 2026-11-15, before the first production release, so that every buyer has one from the start.

A paid app on Play can become free once, and Play does not tell an app whether its user once bought it. If thingGLANCE ever moved to free with a paywall, the people who had paid would need telling apart from the people who had not. So a copy that was bought keeps a record of it. **Nothing reads the record to allow or refuse anything.** There is no paywall and no check.

- **What counts as bought:** an install made by the Play Store. A build put on the phone any other way (adb, the APK from `outputs/`, a debug build) records nothing, and neither does the web app or the PWA.
- **What is recorded:** the store (`play`), when Android first installed the app on that phone, and the app version that noticed. No account, no order number, nothing about the user.
- **Where it is kept, on the phone:** a preferences file of its own, `thingglance_owned.xml` (`android/.../ownership/`). Unlike the app's other files it is left in Android's cloud backup and in a phone-to-phone transfer, so it follows the buyer to a new phone.
- **Where it is kept, in the vault:** one row per device, kind `owned`, id `owned:<deviceId>` (`src/core/ownership.ts`). It syncs like everything else, encrypted like everything else, and is in the in-app backup file. A device's date only ever moves earlier.
- **Where it shows:** Settings, About: "Bought on Google Play" and the date, the earliest among the household's devices.

What it is not:

- **Not proof.** The app is open source and the record is ordinary data. It is there so honest buyers are not locked out, not to keep anyone out.
- **Not only buyers.** Testers on a Play testing track get a paid app free, and get a record.
- **Not for ever, by itself.** A buyer with no vault and no Android backup who moves to a new phone gets a new record dated from the new install. That is fine while the app is paid. A release that made the app free would have to stop writing new records, and from then on only records carried by a vault or a backup would show that someone had paid.

Checked: unit tests on both sides; the end-to-end run reports a purchase on one device and sees it on another through a vault; the device check confirms a build that Play did not install records nothing. A real record can only be seen on an install from Play: after installing from a testing track, Settings, About should show the line.

## The Play Console **(yours)**

In the order the console asks.

- [ ] **Create the app as paid.** A free app can never become paid once it has been published to any track, internal testing included. Price: $9.99. A paid app needs a payments profile on the developer account.
- [ ] **App signing**: accept Play App Signing, and upload the first bundle signed with the upload key.
- [ ] **Store listing**: name (30 characters), short description (80), full description (4000).
- [ ] **Graphics**: the 512 by 512 icon is `public/icons/icon-512.png`. The feature graphic (1024 by 500) and a set of placeholder phone screenshots are in `store-assets/play/` ([store-assets/README.md](../store-assets/README.md)). Still to be made: the real phone screenshots (2 to 8). The siblings make theirs with the family's screenshot kit, which is not in this repository.
- [ ] **Privacy policy**: `https://www.glance-apps.com/thingglance/privacy`. Play asks for a public address on every app, and for the policy to be reachable inside the app, which it is from Settings, About, beside the terms of use, the support address and the link for reporting an issue. The page lives in the `glance-apps-dotcom` repository (`src/pages/thingglance/privacy.astro`); when what the app does with data changes, change it there too, and the "Where data goes" section above.
- [ ] **App content**: ads (none), app access (everything works without signing in; a vault is optional), content rating questionnaire, target audience, Data safety (the section above), and the declarations for news, health, finance and government apps (none apply).
- [ ] **Testing track**, then production. From an organization account there is no 12-testers-for-14-days wait.

## Decisions still open

- **The APK.** The release build makes one beside the bundle. The app has no paywall, so publishing that APK anywhere is giving the app away.
