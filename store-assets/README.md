# Store assets

What the store listings show. Nothing here is used by the app build.

The Apple set is its own folder because it is not interchangeable with the Play set: the canvases differ, and Apple's rules forbid naming another platform anywhere in a listing.

| File | What it is | Made by |
| --- | --- | --- |
| `play/feature-graphic.png` | The feature graphic, 1024 by 500, no alpha. The family's layout: the app icon, the wordmark and a tagline on the shared night colour. | `node scripts/feature-graphic/render.mjs`, from `scripts/feature-graphic/feature-graphic.html` |
| `play/phone-placeholder/*.png` | Six phone screenshots, 1080 by 2160, no alpha. **Placeholders.** | `node scripts/placeholder-screenshots.mjs`, with the dev server running |
| `apple/listing.md` | The App Store Connect text: name, subtitle, description, keywords, the privacy answers and the notes for App Review. One record for iPhone, iPad and the Mac. | By hand |
| `apple/iphone-placeholder/*.png` | Six iPhone screenshots, 1206 by 2622 (the "iPhone with Dynamic Island (medium display)" slot), no alpha. **Placeholders.** | `node scripts/ios-placeholder-screenshots.mjs`, with the app open on its sample data in an iPhone 17 simulator |
| `captures/<device>/*.png` | The app itself, unframed, in dark mode, at the sizes the family's screenshot kit takes as input: iPhone, iPad (lying down and upright), Mac and Pixel. **Not committed** (git ignores the folder): they are regenerated, and the framed set made from them is what gets committed. | `node scripts/store-captures.mjs`, with the dev server running |

The two Play scripts use the Chrome on the machine, as the end-to-end run does, and the Inter font that is installed with the project. The iPhone script drives the app in the simulator through `scripts/ios-webview.py` ([docs/ios.md](../docs/ios.md)).

## The placeholders

They are the web app at a phone's size on its sample data, not captures from an Android device: the screens are the same, but there is no status bar, no device frame and no caption, and the note that says "you are looking at sample data" is hidden for the capture. The sample data names real products.

The size is deliberate. Play refuses a screenshot whose long side is more than twice its short side, which a raw capture from most phones (1080 by 2400) is.

Upload order: Glance, what needs a decision, Horizon, Things, Plans. The dark Glance is a spare.

The iPhone placeholders are captures of the app itself, status bar and all (set to 9:41 for the capture), in the same order, with the same note hidden. They have no frame and no caption either.

## The captures for the real sets

The real sets are made with the family's screenshot kit, which is not in this repository. What it takes in is the app's own surface with no device around it, and `scripts/store-captures.mjs` makes that: six screens (Glance, what needs a decision, Horizon, Things, Plans, one thing's page) for each device, dark by default as the family's store shots are.

| Device | Capture | Why that size |
| --- | --- | --- |
| `iphone` | 1600 by 3084 | The kit's iPhone content area (400 by 771 at 4x), as lastGLANCE's set used |
| `pixel` | 1600 by 3220 | The kit's Pixel content area, for the Play set |
| `ipad` | 2752 by 2064 | A tablet lying down, which lastGLANCE's frames hold inside an upright canvas |
| `ipad-portrait` | 2064 by 2752 | The same tablet upright, should that read better |
| `mac` | 3360 by 2100 | dayGLANCE's desktop size (1680 by 1050 at 2x), 16:10 like every size the Mac App Store takes. The header leaves room for the window's buttons, as it does in the Mac app |
| `mac-plain` | 3360 by 2100 | The same without that room, for a frame that draws its own title bar |

The data is the app's sample set made into real rows, so the "you are looking at sample data" note is not there to hide, with a household around it (three members, this device one of them) and two changes for a store page: the sample that names another phone platform's handset is a different out-of-support device, since nothing in an Apple listing may show one, and one plan has a fixed term so that a lease shows.

Not captured, because they are not the web surface: the widgets, a reminder, and the Mac's menu bar popup. Those come from a device or the running app.
