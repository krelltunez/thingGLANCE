# Store assets

What the store listings show. Nothing here is used by the app build.

The Apple set is its own folder because it is not interchangeable with the Play set: the canvases differ, and Apple's rules forbid naming another platform anywhere in a listing.

| File | What it is | Made by |
| --- | --- | --- |
| `play/feature-graphic.png` | The feature graphic, 1024 by 500, no alpha. The family's layout: the app icon, the wordmark and a tagline on the shared night colour. | `node scripts/feature-graphic/render.mjs`, from `scripts/feature-graphic/feature-graphic.html` |
| `play/phone-placeholder/*.png` | Six phone screenshots, 1080 by 2160, no alpha. **Placeholders.** | `node scripts/placeholder-screenshots.mjs`, with the dev server running |
| `apple/listing.md` | The App Store Connect text: name, subtitle, description, keywords, the privacy answers and the notes for App Review. One record for iPhone, iPad and the Mac. | By hand |
| `apple/iphone-placeholder/*.png` | Six iPhone screenshots, 1206 by 2622 (the "iPhone with Dynamic Island (medium display)" slot), no alpha. **Placeholders.** | `node scripts/ios-placeholder-screenshots.mjs`, with the app open on its sample data in an iPhone 17 simulator |

The two Play scripts use the Chrome on the machine, as the end-to-end run does, and the Inter font that is installed with the project. The iPhone script drives the app in the simulator through `scripts/ios-webview.py` ([docs/ios.md](../docs/ios.md)).

## The placeholders

They are the web app at a phone's size on its sample data, not captures from an Android device: the screens are the same, but there is no status bar, no device frame and no caption, and the note that says "you are looking at sample data" is hidden for the capture. The sample data names real products.

The size is deliberate. Play refuses a screenshot whose long side is more than twice its short side, which a raw capture from most phones (1080 by 2400) is.

Upload order: Glance, what needs a decision, Horizon, Things, Plans. The dark Glance is a spare.

The iPhone placeholders are captures of the app itself, status bar and all (set to 9:41 for the capture), in the same order, with the same note hidden. They have no frame and no caption either.

The real sets are still to be made, for both stores, with an iPad set (2064 by 2752) and a Mac set for Apple. The sibling apps frame theirs with the family's screenshot kit, which is not in this repository.
