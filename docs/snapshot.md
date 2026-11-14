# The glance snapshot

`buildSnapshot()` in `src/core/snapshot.ts` answers one question: what should a surface outside the app show? Home-screen widgets, the menu bar popup, GLANCElauncher cards and MCP tools all read this object and nothing else, so every surface agrees with the app.

It is plain JSON. A native shell stores it for a widget, a headless refresh hands it to the launcher, and an MCP tool returns it as it is.

**Version 1 is frozen as of 2026-11-13.** `src/core/snapshot.test.ts` pins the field lists below, so a change to the shape fails a test until someone has decided what kind of change it is.

## Changing it

Readers are separate programs, and a stored snapshot may have been written by an older or newer build than the one reading it.

- **Adding a field keeps the version.** Readers must ignore fields they do not know.
- **Removing or renaming a field, or changing its type or what it means, is breaking.** Bump `SNAPSHOT_VERSION`, update this page, and expect every reader to need a change.
- A reader that meets a `version` higher than it knows should show nothing rather than guess.

## Privacy

`buildSnapshot()` applies `visibleTo()` itself. Another member's private things and plans are not in the snapshot, in any field, whatever is passed in. A snapshot is built for one device; do not share one between members.

## Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | `1` | The contract version. |
| `generatedAt` | ISO timestamp | When it was built. A reader can show "as of" from this, and the launcher uses it as a heartbeat. |
| `day` | `YYYY-MM-DD` | The local day it was built for. `days` values count from here. |
| `currency` | ISO 4217 code | The currency of every amount. Nothing is converted. |
| `scope.viewerId` | member id or null | The member this device belongs to. Null when nobody has claimed it. |
| `scope.memberId` | member id or null | The member the dated lists were narrowed to. Null for everyone. |
| `counts` | object | `things` in service, `subscriptions` not cancelled, `attention` (the queue's length), `urgent` (queue items due within two weeks or past). |
| `burn` | object | `monthly` and `yearly` plan cost, and `replacementMonthly`, the upgrade fund's monthly target. |
| `attention` | events | What needs a decision, most pressing first. Capped by the `limit` option (8 by default). |
| `upcoming` | events | What is coming, soonest first, without routine short-cycle renewals. Same cap. |
| `things` | things | Every thing in service. |
| `reminders` | reminders | The notifications this device should have pending, soonest first. |

### An event

| Field | Type | Meaning |
| --- | --- | --- |
| `key` | string | Stable id: `type:entityId:date`. Use it to clear the item or send it to dayGLANCE. |
| `type` | string | `coverage-end`, `support-end`, `replace`, `renewal`, `trial-end` or `sub-end`. |
| `date` | `YYYY-MM-DD` | The date itself. |
| `days` | number | Days from `day`. Negative when the date has passed. |
| `severity` | string | `past`, `urgent`, `soon` or `later`. |
| `title`, `detail` | string | Two lines of display text. |
| `thingId`, `subscriptionId` | string, optional | What a tap should open. |
| `amount` | number, optional | In `currency`. |
| `handlerId` | member id or null | Who deals with it. Null when it falls to nobody. |
| `link` | string | What a tap opens: a `thingglance://event/<key>` link. Hand it to the app as it is. |

### A thing

`id`, `name`, `category`, `verdict` (`prime`, `solid`, `watch`, `replace`, `overdue` or `unknown`), `remaining` (share of its window left, 0 to 1), `lifeEnd`, `daysLeft` and `ownerMemberId` (null for the household). `remaining`, `lifeEnd` and `daysLeft` are null when the thing has no dates yet.

### A reminder

Built by `planReminders()` in `src/core/reminders.ts`. A shell makes the platform's pending notifications match this list: schedule what is new, cancel what is gone.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable: the event's `key`, `@`, and the stage. Scheduling it again replaces it. `reminderNumericId(id)` gives the 32-bit id native notifications need. |
| `eventKey`, `type` | string | The event it is about. |
| `stage` | string | `heads-up` (the date has entered its window) or `last-call`. |
| `at` | epoch milliseconds | When it fires. |
| `day` | `YYYY-MM-DD` | The local day it fires on. |
| `eventDate`, `daysBefore` | day, number | The date it is about and how far ahead of it this fires. |
| `title`, `body` | string | The notification's text. |
| `link` | string | What a tap opens, as on an event. |
| `thingId`, `subscriptionId`, `amount` | optional | As on an event. |

The list is capped (56 by default, under the iOS limit of 64 pending per app) and keeps what fires soonest. Every later run plans again and pulls the next ones in.

## Reminder rules

- **Two nudges at most per date.** A heads-up when the date enters its lead window, which is the moment it joins the queue, and a last call closer in: 7 days for coverage, 30 for support ending and a planned replacement, 3 for a renewal or a plan ending, 2 for a trial.
- **No catching up.** A nudge whose moment has passed is not sent late. The date is already in the queue.
- **Nothing for what is settled.** A date that was cleared, or sent to dayGLANCE, gets no reminder. Neither does a routine monthly renewal nobody asked to review.
- **Who is told.** If someone deals with the date, only their devices. If it falls to nobody, every device. A device nobody has claimed hears only about those. A private item is its owner's alone.
- **When in the day.** 9:00 local time unless the device prefers otherwise.
