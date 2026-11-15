# Store assets

What the Google Play listing shows. Nothing here is used by the app build.

| File | What it is | Made by |
| --- | --- | --- |
| `play/feature-graphic.png` | The feature graphic, 1024 by 500, no alpha. The family's layout: the app icon, the wordmark and a tagline on the shared night colour. | `node scripts/feature-graphic/render.mjs`, from `scripts/feature-graphic/feature-graphic.html` |
| `play/phone-placeholder/*.png` | Six phone screenshots, 1080 by 2160, no alpha. **Placeholders.** | `node scripts/placeholder-screenshots.mjs`, with the dev server running |

Both scripts use the Chrome on the machine, as the end-to-end run does, and the Inter font that is installed with the project.

## The placeholders

They are the web app at a phone's size on its sample data, not captures from an Android device: the screens are the same, but there is no status bar, no device frame and no caption, and the note that says "you are looking at sample data" is hidden for the capture. The sample data names real products.

The size is deliberate. Play refuses a screenshot whose long side is more than twice its short side, which a raw capture from most phones (1080 by 2400) is.

Upload order: Glance, what needs a decision, Horizon, Things, Plans. The dark Glance is a spare.

The real set is still to be made. The sibling apps frame theirs with the family's screenshot kit, which is not in this repository.
