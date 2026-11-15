# GLANCElauncher support: a plan

Status: reviewed and built, 2026-11-15. Kept as the record of the plan. What was built is in [launcher.md](launcher.md) here and in decisions 80 and 81 of `../GLANCElauncher/docs/decisions.md`.

Decided at review:

- The recommendations below stand: pages to the left of Home in the order dayGLANCE, lastGLANCE, thingGLANCE; no page when thingGLANCE is not installed; Done, Restore and Send from the launcher, with adding left to the app's form; dates in the app's own words.
- One build, not two. The page split and thingGLANCE's page ship in the same launcher release.
- Tablet landscape: one app per page, in two columns. dayGLANCE has the month and agenda on the left and goals and projects on the right; lastGLANCE has chores on the left and people on the right.
- thingGLANCE's page follows the app's own Glance screen as closely as it can.
- Both sides were built from one session, in this repository and in `../GLANCElauncher`.

Where the build differs from the plan: the page shows the app's month by month charges chart rather than a list of the next 30 days' charges; the page indicator is a pill at the foot of the page; the sibling apps' closing of a page that has stopped answering was ported after all, because the emulator showed it was needed.

The idea to plan for: planning in the launcher becomes three screens, one per app. From Home, a swipe to the left reaches dayGLANCE planning, another reaches lastGLANCE planning, another reaches thingGLANCE planning.

It is two pieces of work in two repositories, and the first does not need thingGLANCE at all:

1. **The launcher splits its one planning screen into a page per app.** Today's planning screen already holds dayGLANCE and lastGLANCE, stacked. Separating them is a change to the launcher alone and could ship on its own.
2. **thingGLANCE becomes a third app the launcher can read and write**, and gets the third page. This needs a provider and a receiver in thingGLANCE, and a client, a parser and a page in the launcher.

Most of what thingGLANCE needs for this already exists, because the widgets, the background refresh and Tasker were built on the same pattern. The larger share of the work is in the launcher.

## Where things stand

### The launcher today

Read from `../GLANCElauncher` at 1.0.2 (`docs/spec.md`, `docs/decisions.md`, and the code).

- **Two pages, hardcoded.** `LauncherRoot.kt` has `PAGE_PLANNING = 0` and `PAGE_HOME = 1` in a `HorizontalPager` of size 2. Planning is the page to the left of Home, Home is where the app starts and where Home and Back return. Nothing is to the right of Home, by decision. There is no page indicator and no setting for pages.
- **One planning screen for both apps.** `PlanningScreen.kt` is a single scrolling column on a phone and in tablet portrait: dayGLANCE's month, agenda, goals and projects, then lastGLANCE's chores and people, with a jump chip to get down to lastGLANCE. In tablet landscape the two apps are two columns side by side on the one page.
- **Two apps, by name, in about twenty places.** The seam is `GlanceApp`, an enum of `DAYGLANCE` and `LASTGLANCE` carrying each app's package, provider authority, receiver and collections, and `GlanceClient`, which is generic over it. The repository, the parser, the outbox's optimistic patches, the availability and freshness fields, Home's header icons, the install banner, diagnostics, settings, search capture and the fake demo data all name the two apps one by one.
- **The contract with an app** is the one in [ROADMAP.md](ROADMAP.md#phase-3-glancelauncher-m-plus-launcher-side-work): a read-only provider of JSON rows with a `meta` row, writes as broadcasts with `payload` and `clientId` to a receiver, the outcome read back from `meta.handledWrites`, a `REFRESH` broadcast, and one permission per app that trusts the launcher's signing certificate.
- **An app that cannot be read shows demo data.** Not installed, too old and not trusted all look the same to the launcher: it shows its built-in fake data for that app and says "demo". Home shows a banner titled "GLANCElauncher needs both apps".
- English only, Android 12 and later, no network permission, no widgets hosted.

### thingGLANCE today

| The contract asks for | thingGLANCE has |
| --- | --- |
| A snapshot the native side holds | Yes. `buildSnapshot()`, stored natively for the widgets, rebuilt on every change. |
| Writes queued natively, each with an id, applied once | Yes. The widgets' and Tasker's queue, applied through `dispatchExternalWrite()`, deduped by the ledger in `src/intents/ledger.ts`, which was written with the launcher's outbox in mind. |
| A write taken off the queue only once handled | Yes (`acknowledgeWrites`). |
| A refresh with the app closed: the bundle in a WebView with no screen | Yes (`refresh/RefreshWorker.kt`, `src/headless/`), on an allowlist, with no service worker, aborted when the app opens. The four rules lastGLANCE learned the hard way already hold. |
| Links the launcher can open | Yes, `thingglance://`. |
| A content provider serving the snapshot | No. |
| A receiver behind the launcher's permission | No. |
| The permission, trusting the launcher's certificate | No. The names are reserved: `com.thingglance.permission.LAUNCHER`, `com.thingglance.app.launcher`. |
| `handledWrites` where the launcher can read it | No. The ledger exists but stays in the page's storage. |
| The heartbeat (`checkedAt`, `syncedAt`) and a refresh log in the launcher's shape | Partly. There is a refresh log, in thingGLANCE's own shape. |

## Part 1: three planning pages (launcher only)

### The pages

From left to right: thingGLANCE, lastGLANCE, dayGLANCE, Home. Home stays the rightmost page, the start page, and where Home and Back return, so nothing about Home changes and "nothing to the right of Home" still holds.

| Swipes from Home | Page | Holds |
| --- | --- | --- |
| 1 | dayGLANCE planning | The month, the agenda, goals, projects. Today's left column, unchanged. |
| 2 | lastGLANCE planning | Pinned chores, due now and soon, Coming up, Reach out. Today's right column, unchanged. |
| 3 | thingGLANCE planning | New. Described in Part 2. |

What changes around them:

- **A header per page**, with that app's wordmark and that app's data status. Today's header says "day planning" and reports both apps in one label.
- **A page indicator**, since three pages cannot be guessed at the way one could. Three dots in the apps' colours (orange, green, sky blue), with the current one filled. Tapping a dot goes to that page.
- **A way straight to a page.** thingGLANCE planning is three swipes from Home. Tapping an app's icon in Home's header could go to its page. The hook for this half exists and is unused: `LauncherController.showPlanning()`.
- **The jump chip to lastGLANCE goes**, as lastGLANCE no longer shares dayGLANCE's column. The Goals and Projects chips stay.
- **The "+" button adds what the page is about**: a task on dayGLANCE's page, a chore or a person on lastGLANCE's.
- **Back and Home** need no change: both already go to Home from any other page.

### Tablet landscape

Today a tablet in landscape shows both apps at once, as two columns. With a page per app that view goes away, and a single app on a wide page leaves room.

Recommendation: one app per page on every size, and each page uses the width for its own content. dayGLANCE's page puts the month and agenda beside goals and projects; lastGLANCE's puts chores beside people. The launcher has dropped a side-by-side layout once already for a similar reason (decision 17: the planning pane beside Home squeezed the dial to a third of the width).

The alternative is to keep pairs of apps on a tablet in landscape, which makes the page count depend on the window, and leaves a third app with no partner.

### Cost and risk

- The pager already keeps one neighbouring page composed. With four pages it is still at most three at once, and only the page in front and its neighbours. dayGLANCE's page is the heavy one and is Home's neighbour today.
- No data changes. It is a rearrangement of composables that already exist, plus the indicator.
- The spec and decision log need an entry: this revises the two pages of decision 17 and the jump to lastGLANCE of decision 26.

Size: small to medium. It can ship before thingGLANCE has a release.

## Part 2: thingGLANCE in the launcher

### What the page shows

The page is the app's four views in one column, most pressing first. Everything on it is in the snapshot already.

| Section | From the snapshot | A tap | Acts |
| --- | --- | --- | --- |
| **Needs a decision** | `attention`, with the count | Opens the date in the app | "Done with this" and, when connected, "Send to dayGLANCE". A date already sent says so. |
| **Coming up** | `upcoming` | Opens the date | None |
| **Plans, next 30 days** | `charges`, its total, and the monthly figure from `burn` | Opens the plan | None |
| **Things** | `things`, closest to the end of their window first, each with its ring, verdict and countdown | Opens the thing | None |
| "+" | | Opens the app's add form | |

- **Countdowns are worked out by the launcher from each date**, as the widgets do, so they are right at midnight without the app running.
- **The words on a date come from the app** (`title`, `detail`). The launcher is English only and so is thingGLANCE for now. If thingGLANCE gains languages before the launcher does, the dates on this page will be in the app's language and the headings in English. That is how the widgets' picker already works, and it avoids teaching the launcher how to word six kinds of date.
- **With nothing shared yet** (installed, never opened): one line asking to open thingGLANCE once.
- **Privacy** is unchanged: the snapshot is already narrowed to what this phone's member may see.

Home gets one thing: thingGLANCE's icon in the header beside the other two, with the same amber dot for stale data, and going to its page on a tap. No Home cards in the first version.

### Writes from the launcher

| Launcher action | Sent as | Payload |
| --- | --- | --- |
| Done with this | `com.thingglance.app.launcher.DECIDE` | `event_key` |
| Undo, straight after | `DECIDE` | `event_key`, `state: "restore"` |
| Send to dayGLANCE | `com.thingglance.app.launcher.SEND` | `event_key` |
| Confirm the data now | `com.thingglance.app.launcher.REFRESH` | none |

All three writes exist in `handleIntent()` today. The launcher applies each at once to its own copy (the date leaves the list, or reads as sent) and keeps it in its outbox until `meta.handledWrites` shows the id, exactly as it does for a completed chore.

**Adding a thing opens the app's form** (`thingglance://action/add`), not a write. A thing made from a name alone has no dates, and the dates are the point. lastGLANCE made the same choice for adding a person.

### What thingGLANCE has to build

All of it native glue around what is there. Nothing changes in `src/core`.

1. **The launcher payload.** The snapshot the widgets get, built with a longer list of dates (the widgets take 12 of each; a page can show more), plus the newest entries of the write ledger as `handledWrites`, and `canSend`. Stored natively beside the widgets' payload, written on the same triggers and only when it changed.
2. **`LauncherProvider`**, read-only, at `content://com.thingglance.app.launcher/<collection>`: `meta`, `attention`, `upcoming`, `things`, `charges`. Each row has `_id`, `id` and `json` columns, as the launcher's reader expects. Every write of the payload calls `notifyChange`.
3. **`meta`**, one row, in the field names the launcher's parser already reads for the other two apps, so that parser is reused as it is: `updatedAt`, `checkedAt`, `syncedAt`, `rendererAlive`, `headlessRunning`, `refreshLog`, `handledWrites`. Plus thingGLANCE's own: `today`, `timezone`, `currency`, `locale`, `counts`, `burn`, the charges total, `canSend`.
4. **The heartbeat.** `checkedAt` on every build of the snapshot and every return to the front; `syncedAt` for the last completed vault cycle, null when no vault is connected.
5. **`LauncherIntentReceiver`** for `DECIDE`, `SEND` and `REFRESH`, behind the permission. A write goes into the existing queue, marked as the launcher's. It does not consult the Tasker switch and sends no `RESULT`. A `REFRESH` is routed by whether the app's page exists: a live app is asked to sync and is held awake while it does; with none, a headless run is scheduled. Each request is logged in the launcher's shape (`queued`, `scheduled`, `coalesced`, `unanswered`, `throttled`, `aborted`, `ran`, `failed`).
6. **The permission**, `com.thingglance.permission.LAUNCHER`, `signature|knownSigner`, with the launcher's release certificate digest in `res/values/launcher_certs.xml`: the same one digest dayGLANCE and lastGLANCE list.
7. **A word about the launcher in Settings**, for Android users who do not have it, as lastGLANCE does. Optional, and can follow.

Two things to settle while building, both about refreshing:

- **How often.** The launcher asks every live app to refresh on each return to Home, at most every two minutes, and calls data stale after an hour. Those numbers suit a day planner. thingGLANCE's dates move by the day. Recommendation: the launcher asks thingGLANCE only when its page comes into view or its data is more than a few hours old, and calls it stale after a day; thingGLANCE allows a headless run for the launcher at most every ten minutes, as the siblings do. This means a refresh interval and a stale age per app in the launcher, instead of one of each.
- **A frozen app.** Android freezes a backgrounded app within minutes; a refresh that only asks the page would then wait until the app is next opened. thingGLANCE's refresh job already stays alive while it asks a live page, which is what keeps the page thawed, but that path is the one piece of the background refresh that was never exercised on the emulator. It has to be tested here, frozen process included, and the `unanswered` outcome recorded when the page does not reply.

### What the launcher has to build

1. **`GlanceApp.THINGGLANCE`**: package, authority, receiver, collections. The manifest's `uses-permission` and `queries` entries.
2. **Models and parser**: a `ThingGlanceSnapshot` (dates, charges, things, counts, burn) and its row parsers. `appMeta` is reused.
3. **Repository**: thingGLANCE's flows and its two writes on `GlanceRepository`, in `ProviderRepository` (snapshot flow, pending writes, live flag, the `recompute` split) and in `FakeRepository`.
4. **Outbox patches**: "this date is done" and "this date is sent", applied over each snapshot until the write is seen.
5. **Availability and freshness** for a third app. These are named fields per app today. With a third it is worth turning them into one entry per app, so the header, the status label, settings and diagnostics loop over the apps instead of naming them. That is a refactor with no change in behaviour, best done first and on its own.
6. **The page**: header, the four sections, the ring (the launcher has cadence fills and goal rings to borrow from), countdown badges, the empty states.
7. **Around it**: the header icon on Home, thingGLANCE's wordmark and sky blue in the theme (`#0284C7` light, `#38BDF8` dark), a section in diagnostics, a row in settings, deep links in `GlanceIntents`, the developer actions and the freshness script.
8. **Tests**: the parser, the patches, the status text, and the repository test that pins which apps are asked to refresh.

Left for later: thingGLANCE as a target for quick capture and voice (today there are two targets and a `lg ` prefix), and anything of thingGLANCE's on Home beyond the icon.

### thingGLANCE is not required

The launcher's banner says it "needs both apps", and shows demo data for one that is missing. thingGLANCE is a paid app, so neither should apply to it.

Recommendation: **the thingGLANCE page exists only when thingGLANCE is installed.** Without it there are two planning pages and two dots, no demo page and no banner. The launcher's About screen can name thingGLANCE with a link to its listing. A demo page would be an advertisement for a paid app three swipes into someone's home screen.

## Order of work

| Step | Where | Depends on | Size |
| --- | --- | --- | --- |
| A. Split planning into a page per app, with the indicator | Launcher | Nothing | Small to medium |
| B. Availability and freshness per app, not by name | Launcher | Nothing | Small |
| C. Provider, receiver, permission, heartbeat, handled writes | thingGLANCE | Nothing | Medium |
| D. thingGLANCE client, parser, repository, page | Launcher | B and C | Medium |
| E. Capture target, Home cards, Settings promo | Both | D | Small each, optional |

A, B and C can go in parallel. C should be in thingGLANCE's first Play release even if D is not ready: the launcher has no version check, so an app without a provider simply does not get a page.

## How it would be verified

- **thingGLANCE's half without the launcher.** `adb shell` holds every permission, so the device check can query the provider (`content query --uri content://com.thingglance.app.launcher/meta`), send each broadcast to the receiver, and watch `handledWrites` and `refreshLog`: with the app open, in the background and frozen, and killed. Plus unit tests for the rows, the log and the policy.
- **The launcher's half without thingGLANCE.** JVM tests as the launcher has now, and the page against fake data.
- **Both together** needs a launcher build signed with its release key on the same device as thingGLANCE, since the permission trusts only that certificate. The launcher's debug builds carry the release key on a machine that has it. That is your key, so I would not build with it unasked.
- **Not coverable by any of this:** how often a real phone lets the refresh run, and the page on a real tablet.

## Questions for you

1. **Direction and order.** Pages to the left of Home, in the order dayGLANCE, lastGLANCE, thingGLANCE, with Home unchanged on the right. Is that what you meant? thingGLANCE is then three swipes away, which is why the plan adds the dots and the header icons.
2. **When thingGLANCE is not installed:** no page (recommended), or a demo page?
3. **Tablet landscape:** one app per page there too (recommended), or keep two apps side by side?
4. **Writes in the first version:** Done, Undo and Send to dayGLANCE, with adding a thing left to the app's form (recommended)? Or read-only first, which the roadmap left open?
5. **Words on dates:** shown as the app wrote them (recommended), or should the launcher word them itself from the date's type?
6. **Who builds the launcher's side, and when?** Steps A and B are launcher-only and could start now, in a session of their own in that repository.
