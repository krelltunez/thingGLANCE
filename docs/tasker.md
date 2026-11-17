# Driving thingGLANCE from Tasker

On Android, another app can drive thingGLANCE by sending it intents: Tasker, MacroDroid, Automate, or anything else that can send one. It can add a thing or a plan, add cover to a thing, clear a date, hand a date to dayGLANCE, read what is coming, and open the app at a particular place.

Android only. It is the same door every other outside caller uses ([links-and-intents.md](links-and-intents.md)); this page is how to reach it from an automation app, and how it is built.

## Turn it on

**Settings, Integrations, Automation apps: "Accept actions from other apps on this phone".** It is off until you turn it on.

While it is on, any app installed on the phone can send these actions, not only the one you have in mind, and an answer sent without an address can be read by any app that listens for it. Turning it off again also drops anything still waiting to be applied.

`OPEN` needs no switch. It only opens the app somewhere, as a `thingglance://` link does.

## The actions

Each is an Android intent. The **action** is one of the names below. What it should do goes in one text extra called **`payload`**, holding a JSON object.

| Action | Does | Answers with |
| --- | --- | --- |
| `app.thingglance.CREATE` | Adds a thing | `thing_id` |
| `app.thingglance.CREATE_PLAN` | Adds a plan | `plan_id` |
| `app.thingglance.ADD_COVERAGE` | Adds a warranty or other cover to a thing | `coverage_id` |
| `app.thingglance.DECIDE` | Clears a date from what needs a decision, or puts it back | `event_key`, `state` |
| `app.thingglance.SEND` | Hands a date to dayGLANCE as a task | `event_key` |
| `app.thingglance.QUERY` | Reads the snapshot: counts, what needs a decision, what is coming, each thing | `snapshot` |
| `app.thingglance.OPEN` | Opens the app, optionally at a link | Nothing |

There is no delete, on purpose.

### How to send one

In Tasker: **Send Intent**.

| Field | Value |
| --- | --- |
| Action | `app.thingglance.CREATE` |
| Extra | `payload:{"name":"%thing_name","reply_to":"net.dinglisch.android.taskerm"}` |
| Package | `com.thingglance.app` |
| Target | **Broadcast Receiver** (for `OPEN`: **Activity**) |

**Package must be set.** Android does not deliver a broadcast with no package to an app that is not running, so one sent without it is silently lost.

Everything but `OPEN` is a broadcast. It is accepted whether thingGLANCE is on screen, in the background or not running at all, and it never brings the app forward. With the app running it is applied at once. With the app closed it is applied by a background refresh, which also sends it on to your vault: usually within seconds, and within a minute or two if one has only just run.

### Payloads

The fields are the ones in [links-and-intents.md](links-and-intents.md#intents), which also says what a date, an amount or a category may be. In short:

`CREATE`

```json
{ "name": "Pixel 9", "purchase_date": "2026-11-14", "price": "799" }
```

`name` is required. Optional: `category`, `brand`, `model`, `retailer`, `purchase_date`, `price`, `lifespan_months`, `support_end`, `owner_member_id`, `notes`. The category is guessed from the name when left out. A thing added this way has no cover yet: the add form in the app adds a manufacturer warranty for you, this does not. Follow it with `ADD_COVERAGE` if you know the warranty.

`CREATE_PLAN`

```json
{ "name": "iCloud+ 2 TB", "amount": "9.99", "cycle": "monthly", "anchor_date": "2026-12-01" }
```

`name` and `amount` are required. Optional: `cycle` (`weekly`, `monthly`, `quarterly`, `yearly`), `anchor_date` (any renewal date), `start_date` (the day it began: the attached thing's purchase date when left out, else none), `start_date_status` (`unknown` and no `start_date`, for a plan that began before you tracked it), `end_date` (with `auto_renew` on, the last day of a lease or a payment plan; with it off, the day it expires), `provider`, `thing_ids`, `member_ids` (the members who use it) or `used_by` set to `household` (the household as a whole), `payer_member_id` (a member id, or `household`), `auto_renew`, `status`, `trial_end`, `review`, `notes`.

`ADD_COVERAGE`

```json
{ "thing_id": "…", "name": "AppleCare+", "end_date": "2028-11-14", "type": "extended" }
```

`thing_id`, `name` and `end_date` are required. The id is what `CREATE` answered with, or one from a `QUERY`.

`DECIDE` and `SEND`

```json
{ "event_key": "coverage-end:…:2027-01-15" }
```

`event_key` is the `key` of a date in a `QUERY` answer (`snapshot.attention` and `snapshot.upcoming`). `DECIDE` takes an optional `state`: `done` (the default), `dismissed`, or `restore` to put a cleared date back. `SEND` needs thingGLANCE connected to dayGLANCE.

`QUERY`

```json
{ "reply_to": "net.dinglisch.android.taskerm" }
```

Nothing is required. The answer is [the snapshot](snapshot.md), the same object the widgets draw from, as the app last wrote it: `generatedAt` in it says when. It is answered on the spot, app running or not.

`OPEN`

```json
{ "link": "thingglance://view/plans" }
```

Send it to the **Activity**. `link` is any link from [links-and-intents.md](links-and-intents.md#links), with or without `thingglance://` in front (`"queue"`, `"action/add?name=Kettle"`). Left out, the app simply opens. A plain text extra called `link` works too.

### Two fields every action takes

| Field | What it is for |
| --- | --- |
| `client_id` | Your own id for this write, any text up to 200 characters. Sent again unchanged, the write is applied once, and the answer says `"deduped": true`. Use it wherever a profile might fire twice. Left out, an id is made for you, which the answer carries back as `client_id`; a second firing is then a second write. If it is a UUID, a created thing or plan takes it as its own id. |
| `reply_to` | The package name of the app that should get the answer (Tasker's is `net.dinglisch.android.taskerm`). The answer is then delivered to that app only. Left out, it is broadcast to any app that listens. |

Tasker hands everything over as text, so a number written as text (`"9.99"`) is accepted.

## Reading the answer

Every action but `OPEN` is answered with a broadcast, `app.thingglance.RESULT`, carrying two text extras:

| Extra | Holds |
| --- | --- |
| `action` | The action you sent, exactly as you sent it |
| `result` | The answer, as JSON |

In Tasker: a profile on **Event, System, Intent Received** with action `app.thingglance.RESULT`. The extras arrive as `%action` and `%result`, and Tasker reads JSON by path: `%result.thing_id`, `%result.snapshot.counts.attention`.

```json
{ "success": true, "thing_id": "0d9c2f1e-…", "client_id": "0d9c2f1e-…" }
```

```json
{ "success": false, "code": "invalid", "error": "\"name\" is required", "client_id": "…" }
```

`code` is one of `invalid`, `not_found`, `unavailable`, `client_id_required`, `unknown_action` or `failed`. A write that was refused is not remembered, so the same `client_id` can be sent again once the payload is put right.

One case is not answered straight away: a `SEND` when the vault cannot be reached is kept and tried again, and answered when it has gone or been refused for good.

## Things to try

- **A purchase email arrives**: `CREATE` with the product's name and today as `purchase_date`, then `ADD_COVERAGE` with the `thing_id` from the answer and the day the warranty ends.
- **A morning summary**: `QUERY`, then speak or show `%result.snapshot.counts.attention` and the first title in `%result.snapshot.attention`.
- **A subscription confirmation**: `CREATE_PLAN` with the amount and the renewal date.
- **A home-screen button**: `OPEN` with `{"link":"queue"}`.

## How it is built

- `AutomationReceiver` (`android/.../automation/`) is declared in the manifest, so Android delivers to it whatever state the app is in. With the switch off it returns before reading anything.
- **A write joins the queue the widgets use.** `Automation.entry()` turns the broadcast into `{ action, payload, clientId }`, mapping the broadcast's action to the handler's own name (`app.thingglance.CREATE` to `create_thing`), and remembers what was asked and where the answer goes. It is queued in `SharedDataStore` beside the widgets' ticks. From there nothing is new: the app collects the queue (`collectWidgetWrites` in `src/native/widgetBridge.ts`) and applies each through `dispatchExternalWrite()`, on screen or in a background refresh.
- **The answer comes back with the acknowledgement.** When the app takes writes off the queue it says how each went (`acknowledgeWrites(ids, results)`, on both the plugin and the headless bridge). `Automation.acknowledged()` broadcasts a `RESULT` for each entry that asked for one. A widget's tick is in the same queue and asks for none.
- **`QUERY` never reaches the app.** The receiver answers it from the payload the app last wrote for the widgets, which is why it works with nothing running.
- **`OPEN` is a link.** `LaunchLinks` turns it into a `thingglance://` VIEW, so it goes through the one router and can only navigate.
- **The switch is kept natively** (`SharedDataStore`), read by the receiver and again before any `RESULT` is sent. `src/native/automation.ts` only reads and sets it.
- A date cleared by `DECIDE` leaves the widgets at once, like a tick; a `restore` does not hide anything.

`AutomationTest` covers the mapping, the payload, ids, addresses, answers and the queue. The device check (`scripts/android-check.mjs`) sends real broadcasts with `am broadcast`: with the switch off, on, repeated, refused, with the app killed, and `OPEN` from cold. A receiver that exists only in debug builds stands in for the automation app and writes each answer to the log.

## Not here

- No outgoing event when a date comes due. A reminder is a notification, which Tasker can already react to.
- No update or delete of a thing or a plan ([links-and-intents.md](links-and-intents.md#not-here-yet)).
