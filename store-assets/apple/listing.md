# App Store listing

The text for App Store Connect, for the iPhone and iPad app and for the Mac App Store app (one record: the same bundle ID on both is what makes it a single purchase). Drafted from the app's own words; change what you like before it goes in.

**Apple's metadata rules.** Nothing here may name another platform or store, so none of it mentions Android, Google Play, Windows or Linux. Keep it that way when editing. Prices are not stated in the text either: the store shows them.

Character limits are Apple's; the counts are in the comments.

## Name and subtitle

| Field | Text |
| --- | --- |
| Name (30) | `thingGLANCE` |
| Subtitle (30) | `Warranties, renewals, upkeep` |

## Promotional text (170)

> Know what is next for your things: when a warranty ends, when a plan renews, when updates stop, and the right moment to replace it. Private, on your device.

## Description (4000)

```
thingGLANCE keeps track of the dates attached to the things you own.

When the warranty lapses. When a plan renews. When security updates stop. When you said you would replace it. Each one joins a short list while there is still time to do something about it, and leaves when you have decided.

It is not a home inventory. No serial-number spreadsheets, no receipts to scan. Just the handful of things that carry dates.

WHAT IT ANSWERS

• Glance: is there anything I should be thinking about? The dates that want a decision, the year ahead, what your plans cost, and an upgrade fund.
• Horizon: every thing as a lane on one time axis. Coverage, support, renewals and your planned replacement.
• Things: how much of its life each thing has left, and a plain verdict on where it stands.
• Plans: every subscription, what it adds up to a month and a year, the charges coming, and a flag for the ones to review before they renew.

IDEAS WORTH A LOOK

• A decision queue. A warranty joins it weeks ahead, the end of support months ahead, a trial days ahead. Settle it, or send it to dayGLANCE as a task.
• Web lookup. Type a product's name and the form fills in its details and the date its security updates end, from public sources. Used only when you type into it, and it can be turned off.
• An upgrade fund. What to set aside each month so every replacement is paid for the day it is due.
• Cost of ownership. Per day so far, and per day if you keep it as long as planned.
• Household. Say whose a thing is and who deals with it. Keep an item private.

ON YOUR IPHONE AND IPAD

• Widgets for the Home Screen and the Lock Screen, with a tick to settle a date without opening the app.
• Reminders at the moments that matter: once when a date enters its window, once as a last call.
• Ask Siri what is next, or add a thing from Control Center.
• Share a product page to thingGLANCE to start a new thing.

ON YOUR MAC

• A menu bar popup with what is waiting, and reminders with the window closed.
• An optional local server for AI assistants, off by default, read-only until you allow changes, and never able to delete.
• An optional Stream Deck plugin.

PRIVATE BY DESIGN

• No account. No analytics. No ads. No tracking.
• Everything stays on your device unless you connect GLANCEvault, the family's optional sync server that you run yourself. What it stores is encrypted on your device first, with a passphrase only you know.
• Bought once. No subscription, no purchases inside the app.
• Open source.

thingGLANCE is part of the GLANCE family, with dayGLANCE, lifeGLANCE and lastGLANCE.
```

## Keywords (100, comma separated, no spaces after commas)

```
warranty,subscription,renewal,tracker,expiry,gadgets,devices,upgrade,replace,support,lifespan,plans
```

## What's New (first version)

```
The first release of thingGLANCE.
```

## Addresses

| Field | Value |
| --- | --- |
| Support URL | `https://www.glance-apps.com/contact` |
| Marketing URL | `https://www.glance-apps.com/apps/thingglance` (once the page is live; it is a pull request on `glance-apps-dotcom`) |
| Privacy Policy URL | `https://www.glance-apps.com/thingglance/privacy` |

## Categories and rating

- **Primary category**: Productivity. **Secondary**: Utilities.
- **Age rating**: answer "None" throughout the questionnaire. The web lookup shows text and a product photo from Wikipedia for the name the user types; it is not open web browsing.
- **Copyright**: yours.

## App Privacy

**Data Not Collected.** Nothing the app handles reaches the developer: there is no account, no analytics and no crash reporting, and a vault is the user's own server. [The privacy policy](https://www.glance-apps.com/thingglance/privacy) has the detail, and `docs/release.md` ("Where data goes") is the same statement for Google.

## Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in every Info.plist, so App Store Connect does not ask. The app uses only standard algorithms (AES-256-GCM, PBKDF2-SHA-256, HMAC-SHA-256) for end-to-end sync. The annual self-classification report is filed separately, as for the sibling apps.

## Notes for App Review

```
thingGLANCE needs no account and no sign-in. Everything works on first launch: choose "Explore with sample data" on the welcome screen to see every screen filled in.

Sync is optional and uses GLANCEvault, a server the user runs themselves; none is needed to review the app.

Notifications are local reminders scheduled on the device. The widgets and the share extension read and write only the app's own App Group.

(Mac) The app requests com.apple.security.network.server because two optional features, both off by default, listen on 127.0.0.1 only: a local server that lets an AI assistant on the same Mac read the user's data (Settings, Integrations, On this computer), and a listener for the Stream Deck plugin. Neither is reachable from the network. A short video of both is attached.
```

The video is yours to record: dayGLANCE passed review with the same entitlement and was asked for one.

## Screenshots

- **iPhone with Dynamic Island (medium display)**, 1206 by 2622: `iphone-placeholder/`, six raw captures from the simulator on the sample data. **Placeholders**, like the Play set: no frame and no caption. Made by `node scripts/ios-placeholder-screenshots.mjs` ([README](../README.md)).
- **iPad 13-inch**, 2064 by 2752: still to be made. Required because the app runs on iPad.
- **Mac**, 2880 by 1800 or one of the other Mac sizes: still to be made.

The real set is made with the family's screenshot kit, which is not in this repository.
