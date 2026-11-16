# Releasing on the App Store

The iPhone and iPad app, and the Mac App Store app beside it. Android's release is [release.md](release.md); the desktop downloads and the mechanics of the Mac App Store build are in [desktop.md](desktop.md#releasing). What only you can do is marked **(yours)**.

The three share one bundle ID, `com.thingglance.app`, which is what lets App Store Connect sell the iPhone, iPad and Mac apps as one purchase.

## Once **(yours)**

In the Apple Developer portal:

- [ ] **The App Group** `group.com.thingglance.app`.
- [ ] **Three App IDs** with the App Groups capability and that group: `com.thingglance.app` (iOS and macOS), `com.thingglance.app.widgets`, `com.thingglance.app.share`. A group missing from one of them fails without a word: the widgets show "Open thingGLANCE to load your dates" for ever.
- [ ] **A development team** on all three targets in Xcode (Signing and Capabilities). None is committed. Automatic signing makes the profiles.

In App Store Connect:

- [ ] **One app record** for the bundle ID, with the iOS and macOS platforms on it.
- [ ] **Paid, $9.99**, with no purchases inside the app. Unlike Google Play, Apple lets a price change either way later.

## Each release

1. The version is `package.json`'s, the same number Android and the desktop ship.
2. `npm run build:ios`. It builds the web app, syncs it into `ios/`, and writes the version and build number every target takes ([ios.md](ios.md#build-it)). A second upload of the same version needs the next build number: `IOS_BUILD=1000001 npm run build:ios`.
3. **(yours)** In Xcode: open `ios/App/App.xcodeproj`, choose Any iOS Device, Product, Archive, then Distribute App to App Store Connect. The archive carries the app and both extensions.
4. **(yours)** The Mac App Store build, on the same Mac: `npm run build:electron:mas`, then Transporter ([desktop.md](desktop.md#releasing)).
5. **(yours)** TestFlight first. Then the checks below, on a real device, before sending it for review.

### On a real device, before review

The simulator run in [ios.md](ios.md#what-was-checked-and-what-was-not) could not cover these:

- [ ] The app starts, and connects to your vault. A restart stays connected.
- [ ] A widget on the Home Screen shows your dates; a tick settles one, and the app agrees when opened. One on the Lock Screen.
- [ ] A reminder arrives on its day with the app closed, and "Done with this" works from it.
- [ ] "Send to dayGLANCE" from a widget row and from a reminder, with dayGLANCE connected.
- [ ] Share a product page from Safari to thingGLANCE; open the app and the form is filled in.
- [ ] "What's next in thingGLANCE" to Siri, and the shortcuts in the Shortcuts app.
- [ ] The Control Center button (iOS 18 and later).
- [ ] An iPad, in both orientations.
- [ ] After a widget misbehaves, restart the device before believing it: a stale WidgetKit cache survives a reinstall.

## App Store Connect **(yours)**

In the order it asks. The text is in [`store-assets/apple/listing.md`](../store-assets/apple/listing.md).

- [ ] **Name, subtitle, promotional text, description, keywords.** Nothing in them may name another platform or store.
- [ ] **Screenshots**: iPhone (1206 by 2622), iPad 13-inch (2064 by 2752) and Mac. `store-assets/apple/iphone-placeholder/` has placeholders for the first; the real sets are made with the family's screenshot kit.
- [ ] **Support, marketing and privacy policy addresses.** The product page and the policy's update for these apps are pull requests on `glance-apps-dotcom`; merge them before submitting, since the policy has to describe what is submitted.
- [ ] **App Privacy**: Data Not Collected.
- [ ] **Age rating**, **category** (Productivity, then Utilities), **copyright**.
- [ ] **Export compliance** is answered by the Info.plists; the yearly self-classification report is separate.
- [ ] **Notes for App Review**, with the video for the Mac app's network server entitlement.
- [ ] **Universal purchase**: add the macOS platform to the same record, so buying one is buying all three.

## Owned since

A copy the App Store installed records that it was bought: the store's own date for the purchase, `store: "appstore"`, and the app version ([release.md](release.md#owned-since)). The Mac App Store build records `store: "mas"`. A build from Xcode or TestFlight records nothing. It is a record and never a check.

## Device backups

Decided 2026-11-16: the iOS app's data stays in the device's own backup, unlike Android's. The vault connection does not travel (it is in the Keychain, for this device only), and a copy restored onto another device takes a new device id and says that it is not syncing there ([ios.md](ios.md#backups)). The privacy policy says the same.

- [ ] **On real devices:** restore a backup of a connected iPhone onto a second device. It should open with the data, not connected, with "Sync needs attention" in the header, and both devices should sync once the second is connected again. A simulator cannot make a backup; what was checked there is a copy of the app's container moved to a second simulator.

## Decisions still open

- **Languages.** The app ships English. The words iOS shows before the app has run (widget gallery names, quick actions, Siri phrases, the share sheet's card) are English in the Swift and the Info.plist; a second language needs string catalogs for them as well as a `src/locales` folder. Below an iOS 17 deployment target, Siri phrases go in `.strings`, not a string catalog.
- **A background refresh.** Android refreshes a few times a day with the app closed. iOS does not yet: a date settled on another device stays in the widgets and the reminders here until the app is next opened.
- **An App Store badge on the site.** The product page says "coming soon" until there is a listing to link to.
