# Store assets

What the store listings show. Nothing here is used by the app build.

The Apple set is its own folder because it is not interchangeable with the Play set: the canvases differ, and Apple's rules forbid naming another platform anywhere in a listing.

| File | What it is | Made by |
| --- | --- | --- |
| `play/feature-graphic.png` | The feature graphic, 1024 by 500, no alpha. The family's layout: the app icon, the wordmark and a tagline on the shared night colour. | `node scripts/feature-graphic/render.mjs`, from `scripts/feature-graphic/feature-graphic.html` |
| `play/phone-placeholder/*.png` | Six phone screenshots, 1080 by 2160, no alpha. **Placeholders.** | `node scripts/placeholder-screenshots.mjs`, with the dev server running |
| `apple/listing.md` | The App Store Connect text: name, subtitle, description, keywords, the privacy answers and the notes for App Review. One record for iPhone, iPad and the Mac. | By hand |
| `apple/iphone/`, `apple/ipad/`, `apple/mac/` | **The sets to upload**: framed and captioned, at the sizes the App Store takes. Seven iPhone frames, three for the iPad, three for the Mac. | `scripts/store-frames.py`, from the captures, with the family's screenshot kit (below) |
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
| `mac-plain` | 2880 by 1800 | The kit's Mac content size (1440 by 900 at 2x), 16:10 like every size the Mac App Store takes. The kit stacks a real title bar above it, so it has no room left for the window's buttons. dayGLANCE's 1680 by 1050 fits the framer too, but this app's page stops growing at 1560 wide and its text reads small in the frame at that |
| `mac` | 2880 by 1800 | The same with the room the Mac app's header leaves for the window's buttons: the window as the app itself draws it, not an input to the kit |

The data is the app's sample set made into real rows, so the "you are looking at sample data" note is not there to hide, with a household around it (three members, this device one of them) and two changes for a store page: the sample that names another phone platform's handset is a different out-of-support device, since nothing in an Apple listing may show one, and one plan has a fixed term so that a lease shows.

The Mac's menu bar popup is a window of the desktop app, not a page a browser can open, so it has a script of its own: `node scripts/store-capture-popup.mjs`, after `npm run build:electron:main`, with the dev server running. It starts the desktop app unpackaged on a profile of its own, fills it with the same data, opens the popup as a click on the menu bar icon does, and saves it twice into `captures/mac/`, as it opens and scrolled to its end, at four times its size (380 by 560 becomes 1520 by 2240).

The widgets are not drawn by the app's page at all, so they come from the simulator: one capture of an iPhone 17's Home Screen (1206 by 2622) in dark appearance, saved as `captures/iphone-home/home-screen-widgets-dark.png`, with three of the app's widgets on it. To make it again: build and install the app ([docs/ios.md](../docs/ios.md)), give it the same data, `xcrun simctl ui 'iPhone 17' appearance dark`, add "A single thing" and "Plans, next 30 days" (both small) above "Needs a decision" (medium) from the Home Screen's own Add Widget, point the first at a thing with life left (long-press, Edit Widget), then `xcrun simctl io 'iPhone 17' screenshot`. The frame cuts each card out on its own corners, at boxes measured from that capture (`CARDS` in `scripts/store-frames.py`): a different device or arrangement needs them measured again.

## The framed sets

`scripts/store-frames.py` makes the sets the stores take from those captures, with the kit:

```bash
python3 scripts/store-frames.py --kit <the unzipped kit> --eyebrow-font <DejaVuSans-Bold.ttf> [iphone] [ipad] [mac]
```

| Set | Size | Frames |
| --- | --- | --- |
| `apple/iphone/` | 1206 by 2622 | Glance, what needs a decision, Horizon, Things, Plans, one thing's page, and the Home Screen's widgets |
| `apple/ipad/` | 2064 by 2752 | Glance, Horizon and Plans: the tablet lying down in an upright canvas |
| `apple/mac/` | 2880 by 1800 | Glance, Horizon and Things |

The kit is used as it is: nothing in it is edited or copied into this repository. Its framers are imported from where it was unzipped, and the script sets what they hold as module globals, which is how the kit's README says a second app is framed: the paths to its fonts and donors, the brand colour (sky blue, `56, 189, 248`), and the tones of the bands behind the status bar and the home indicator, sampled from each capture's own top and bottom edge. Three things are this app's own:

- **The widget frame.** The kit's is dayGLANCE's: one card on the retired 1320-wide canvas. This one is the same composition (caption, light halo, bullets) with three cards, kept where the Home Screen has them and at their own size, on the canvas the store takes now.
- **The Mac's title bar.** The kit stacks the donor's real bar above the app, in dayGLANCE's tone. Here the dark behind the traffic lights is put on this app's tone first, so it does not read as a lighter stripe.
- **The captions**, which are the lists at the top of the script: an eyebrow and two lines for each frame.

It needs Pillow and numpy, and DejaVu Sans Bold for the eyebrow line (the kit expects it from the system; a Mac does not have it).

Still to do: a frame for the Mac's menu bar popup, which the kit has no framer for.
