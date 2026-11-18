# MCP: thingGLANCE for an AI assistant

The desktop app can run an MCP server, so an assistant that speaks MCP (Claude Code, Claude Desktop, any MCP client) can read your things, plans and dates and, if you allow it, change them. The model is lastGLANCE's (`../lastGLANCE/docs/mcp-and-stream-deck.md`), which follows dayGLANCE's; the generic parts come from the shared `@glance-apps/mcp-host` package.

This page is both the design and the contract. The tool names under [Tools](#tools) are what the server registers: `electron/mcpServer.transport.test.ts` reads them from here and fails when the two differ.

| | |
| --- | --- |
| Where it runs | In the desktop app's main process. Not in the phone apps or the web app |
| Where it listens | `127.0.0.1:7910` only. Never reachable from the network |
| Default | Off. Reading and changing are separate switches, each behind its own consent |
| What it can never do | Delete anything |

## Turning it on

Settings, Integrations, "On this computer" (desktop app only).

- **AI assistants (MCP)** turns reading on. The dialog says plainly that what an assistant reads is sent to the company that runs it and leaves thingGLANCE's guarantees. Turning it off and on again asks again.
- **Allow changes** is a second switch on top, with its own dialog.
- The settings are one file in the data folder, `local-integrations.json`, kept by the main process (`electron/localIntegrations.ts`). Every change is a transition through one pure function, and consent can only be given by a transition that carries the dialog's confirmation. A corrupt file is set aside and read as everything off.
- The **access token** is made the first time reading is turned on. It is read on every request, so a new one takes effect at once and disconnects whoever had the old one.
- A port that is taken is a message in Settings, never a crash and never another port.

## Connecting an assistant

**Claude Code, and any client that speaks HTTP.** Settings shows the address and a line ready to copy:

```
claude mcp add --transport http thingglance http://127.0.0.1:7910/mcp --header "Authorization: Bearer <token>"
```

**Claude Desktop** only starts servers over stdio from its config file, so it goes through the family's stdio bridge (`@glance-apps/mcp-bridge`), which is a pipe with no tools of its own. Direct builds for macOS and Windows carry the bridge (in `Resources/mcp-bridge`) and Settings has a button for it.

- **"Set up Claude Desktop"** adds one entry, `mcpServers.thingglance`, to Claude Desktop's config: thingGLANCE's own binary run as Node on the bundled bridge with `--app thingglance`. No Node install, no network. Every other server and every other key in the file is left as it was, and a copy of the file as it was found is kept beside it (`claude_desktop_config.json.bak-thingglance-<time>`). A file that is not valid JSON is never written over: Settings shows the lines to paste instead. Claude Desktop reads its config at start, so it needs a restart.
- **How the bridge finds the app.** The server writes a discovery file while it runs: `mcp.json` (port and token, owner-only) in the app's data folder. The bridge's thingGLANCE profile reads it, so a new token or port needs no second press. The one exception is a Claude Desktop installed as a Windows package (MSIX): it runs the bridge inside its own container, which cannot see that file, so there the port and the token go into the entry itself, and a new token needs the button pressed again.
- **Where the code is.** `electron/mcpDesktopConfig.ts` is the pure half (where the config lives, the entry, the merge) and `electron/mcpDesktopSetup.ts` reads and writes. Both are after lastGLANCE's. `main.ts` loads the second only when the button is pressed. On a profile of its own (`THINGGLANCE_USER_DATA_DIR`, the tests) the config written is a stand-in in that profile, never the one a person's Claude reads.
- **Everything else** (the Mac App Store build, Linux, another stdio client) uses the bridge's own `.mcpb` extension or an `npx` entry: Settings links to the [setup guide](https://github.com/glance-apps/mcp-bridge#thingglance).

## How a request is answered

The server holds no data. Every tool asks the main window's page, which answers from the database, as the member this computer belongs to.

- **The request bridge** (`electron/mcpRendererBridge.ts`, `src/mcp/mcpBridge.ts`). Main sends the page a method and its parameters and waits. It never hangs: no window, or no answer in time, comes back as `renderer_unavailable`, whose message says this is not an empty list. Only the main window is listened to; the tray popup's window is not.
- **Reads** are `src/mcp/readModel.ts`, a pure function over the data.
- **Privacy is applied before either model sees anything.** `src/mcp/readData.ts` passes the data through `visibleTo()`, like every other surface. Another member's private things and plans are not in any answer, and cannot be edited, because the model cannot find them.
- **Dates are local days**, `YYYY-MM-DD`, resolved on the user's machine. Answers that depend on today echo the date and the IANA timezone.
- **Lists are paginated** (50 by default, 200 at most). A cursor is bound to the filters it was issued under.
- **Errors are typed**: a tool error with `{ "error": { "code", "message" } }`. The codes are `validation`, `not_found`, `renderer_unavailable`, `read_only_mode`, `rate_limited`, `writes_disabled` and `internal`.

## Changes

Every write tool goes through the same steps, in order (`electron/mcpWriteTools.ts`):

1. **Consent.** Without "Allow changes" it is a `read_only_mode` error, and nothing reaches the page.
2. **Replay.** Every write takes an optional `idempotency_key`. A key seen before returns the first result and changes nothing. A create's row id is derived from its key, so a retry finds its own row even after the replay window has forgotten it.
3. **The rate limit.** 30 changes a minute. Three overruns in five minutes turn changes off until thingGLANCE restarts, and Settings says so.
4. **The page applies it** (`src/mcp/writeModel.ts`) through the functions the app's own forms call (`src/db/queries.ts`), so it is stamped, synced and promotes sample rows as a tap in the app would. The three creates and "decide" go through `dispatchExternalWrite()`, the one door every write from outside uses; the edits are validated against the forms' own rules.

**Nothing is deleted.** Retiring a thing and cancelling a plan are edits, reversible in the app. Removing anything is done in the app.

### Undo

Each change answers the main process with an undo record, built by the page, which alone has the before-state: remove what was created, or put back the fields an edit changed. The records are kept in the main process for the session only (`electron/mcpJournal.ts`); a restart clears them. They never appear in a tool's output.

Undo is per item and all at once, from Settings and from the tray's menu. A change that no longer applies (the thing has since been removed in the app) is skipped and said so; the rest still run.

### What you can see

- Settings lists what assistants changed this session, with Undo and Undo all, and a notice when the rate limit has paused changes.
- A dot beside the section title: green while the server is running, blue while there are changes to undo (also after the server is turned off), red while changes are paused.
- The tray's menu gains "Undo assistant changes (N)" and "Turn off assistant access", so the server can be stopped without opening the window.

There is no confirmation per change: read-only by default, no deletes, a rate limit and undo instead.

## Tools

Every id is thingGLANCE's own and the same on every device. Pass ids exactly as returned.

A **verdict** says where a thing is in its life: `prime`, `solid`, `watch`, `replace`, `overdue`, `retired` or `unknown`. A **date** has a type: `coverage-end`, `support-end`, `replace`, `renewal`, `trial-end` or `sub-end`, and a state: `open`, `done`, `dismissed` or `sent` (handed to dayGLANCE). One that has passed carries `past: true`.

**The household is a value, not a gap, and every "who" follows one rule.**

- Where one member is named (a thing's owner, a plan's payer, whoever is responsible for either), it is a member or the household itself. For the household the id is `null`, as it is on the way in, and the answer says so: the name is `Household` and `owner`, `payer` or `responsible` is `household`. The word `household` is taken in place of `null` on the way in. A responsible of `household` means nobody in particular deals with it, so everyone is asked.
- Where several can be named (who a plan is used by), `used_by` says which: `members` (`member_ids` and `member_names` list them, one name for each id), `household` (the household as a whole; both lists are then empty) or `not_set` (nobody has said). An empty `member_ids` is never read as the household.
- `used_by_source` says where that answer comes from. `set`: it was chosen by hand, "nobody in particular" included. `thing`: nobody chose, and the plan is attached to a thing, so whoever owns the thing uses the plan, and a new owner takes it over. Things with different owners settle nothing (`thing` with `not_set`), and neither does a thing this member cannot see. A plan attached to nothing is always `set`.
- `thingglance_list_members` counts what belongs to the household: `household_owns`, `household_pays_for`, `household_uses`.

**A plan has a beginning and may have an end.** Every figure below comes from `src/core/money.ts`, which is also what the app draws from: the tools expand nothing of their own.

- `start_date` is the day a plan began, and `start_date_status` says where that stands:

| `start_date_status` | Meaning | `start_date` |
| --- | --- | --- |
| `recorded` | The day is on record | The date |
| `unknown` | It began before it was tracked, and whoever entered it said so. An answer, not a gap: never ask for the date or fill one in | `null` |
| `not_set` | Nobody has said yet. The only state worth asking about | `null` |

  A plan added on a thing takes the thing's purchase date unless it is told otherwise. One on its own starts `not_set`.
- `paid_to_date` is history: the payments made up to yesterday, at today's price (what a plan cost before is not on record). Its `basis` says where the count begins. `start_date`: the plan's own start. With no start on record it is `anchor` when the count begins at a payment made before the plan was entered, and `entry_date` when it begins the day it was entered. An `unknown` start counts the payment its current cycle began with: the plan was already running, or there would have been none to enter. A `not_set` start counts a payment before entry only when the plan's renewal date is itself on or before that day (someone entered a date already paid); with the renewal date still ahead the plan may be new, and nothing earlier is assumed. Without a start it is what is known to have been paid, not everything since the plan began. It is kept apart from the dates ahead. A range that starts in the past (`thingglance_list_upcoming`) lists those payments too, each marked `past: true`, and none from before the count begins.
- `end_date` means one of three things:

| The plan | How it is recorded | What follows |
| --- | --- | --- |
| A lease, or anything paid in installments | `auto_renew: true` with `end_date`, the last day of the term | Paid each cycle until then, never on or after that day. It costs what it costs until then. A `sub-end` date marks the end of the term, and `left_on_term` says what remains |
| Paid up front, not renewing (a prepaid year) | `auto_renew: false` with `end_date`, the day it expires | Already paid: no renewals, no monthly cost, a `sub-end` date when it expires |
| Cancelled | `status: "cancelled"` with `end_date`, the day access runs out | No renewals, no cost, a `sub-end` date when access ends |

### Reading

### `thingglance_ping`

Confirms the server is reachable. Reads nothing.

### `thingglance_get_overview`

Where things stand today: the counts, what the plans cost a month and a year, the charges coming in the next 30 days, the queue of dates that need a decision (at most 50) and the next few after them. The place to start.

### `thingglance_list_things`

The things, soonest to run out first. Filters: `status` (`active` by default, `retired`, `all`), `category`, `verdict`, `owner` (a member id, `me` or `household`) and `query` (words in the name, brand, model or category).

### `thingglance_get_thing`

One thing in full, by `thing_id`: its details, notes and specs, who owns it and who deals with it, its coverage, the plans attached to it and its dates: the ones ahead, and any behind that still wait for a decision. That is what the app's own page for a thing lists. A plan's payments already made are on the plan (`paid_to_date`), never among the dates.

`owned_since` is when the current owner's time with it began: the last hand-over, or the day it was bought. `ownership_history` lists the owners before, oldest first, each as `{ owner, member_id, member_name, from, to }`.

### `thingglance_list_plans`

The plans, most expensive first. Filters: `status` (`current` by default, `active`, `trial`, `cancelled`, `all`), `thing_id`, `used_by` (a member id or `me`: the plans that member uses, the household's included, as the app shows a member's plans; `exact: true` keeps only the ones that name them; or `household`: the plans used by the household as a whole) and `query`. `totals` is what the plans listed come to a month and a year, so it follows the filters; `all_plans_totals` is the same for every plan.

### `thingglance_list_upcoming`

The dates between `from` and `to` (today to 90 days ahead by default, about three years at most), soonest first. Filters: `types`, `thing_id`, `plan_id`. Routine renewals of short-cycle plans are left out unless `include_routine` is true. A `from` before today also lists what has already happened, each marked `past: true`; a plan's renewals are listed only from its start date.

### `thingglance_list_queue`

Every date that needs a decision now, most pressing first.

### `thingglance_list_members`

The household: each member, whether they use the app, what they own, pay for and use, which member this computer belongs to, and what belongs to the household itself (`household_owns`, `household_pays_for`, `household_uses`).

### `thingglance_list_mcp_writes`

What assistants changed this session, newest first, with each changed field's value before. Filter by `thing_id`, `plan_id` or `event_key`.

### Changing

All of these need "Allow changes". An edit sends only the fields to change: a field left out is untouched, and `null` clears one that can be empty.

### `thingglance_create_thing`

Adds a thing. Only `name` is required. Also: `category` (guessed from the name when left out), `brand`, `model`, `purchase_date`, `price`, `retailer`, `support_end`, `lifespan_months`, `owner_member_id`, `notes`. Whoever owns it has had it since the purchase date, not since the day it was added.

### `thingglance_update_thing`

Edits a thing, by `thing_id`. Every field the app's form edits:

| Field | Notes |
| --- | --- |
| `name` | Cannot be empty |
| `category` | A category id |
| `brand`, `model`, `retailer`, `notes` | Text; `null` clears |
| `purchase_date`, `release_date`, `support_end` | Local dates; `null` clears. A `support_end` set here is marked as the user's own |
| `price` | A number; `null` clears |
| `lifespan_months` | 1 to 1200; `null` for the category's usual |
| `pinned` | `true` or `false` |
| `visibility` | `shared` or `private`. Private needs an owner |
| `retired` | `true` takes it out of service, `false` brings it back |
| `resale_value` | Only with a retired thing |

### `thingglance_reassign_thing`

Changes whose a thing is (`owner_member_id`) or who deals with it (`responsible_member_id`), or both. `null` for the owner means the household. A new owner is one of two things:

- **It changed hands** (the default): a hand-me-down dated today, with the earlier owner kept in its history.
- **The owner on record was wrong** (`correction: true`): nothing is added to the history, and the new owner has had it since it was bought. This is the one to use when someone is sorting out who owns what, most often on things that were entered as the household's.

A change of owner on the day a thing was entered is a correction either way. Undo puts the history back exactly as it was.

### `thingglance_add_coverage`

Adds a warranty, an extended warranty or insurance to a thing. `thing_id`, `name` and `end_date` are required. Also: `type` (`warranty` by default, `extended`, `insurance`), `start_date`, `provider`, `cost`, `notes`.

### `thingglance_create_plan`

Adds a plan. `name` and `amount` are required. Also: `cycle` (`monthly` by default, `weekly`, `quarterly`, `yearly`), `anchor_date`, `start_date` (the attached thing's purchase date when left out, else none), `start_date_status` (`unknown`, with no `start_date`, for a plan that began before it was tracked), `end_date`, `provider`, `status` (`active` or `trial`, which needs `trial_end`), `auto_renew`, `review`, `thing_ids`, `member_ids` (who uses it) or `used_by` (`household`, or `not_set` for nobody in particular), `payer_member_id`, `notes`. With neither, a plan attached to a thing is used by the thing's owner. What `end_date` means is in the table above.

### `thingglance_update_plan`

Edits a plan, by `plan_id`. Every field the app's form edits: `name`, `amount`, `cycle`, `anchor_date`, `start_date`, `start_date_status`, `provider`, `status` (`active`, `trial`, `cancelled`), `trial_end`, `end_date`, `auto_renew`, `review_before_renewal`, `thing_ids`, `member_ids`, `used_by`, `payer_member_id`, `responsible_member_id`, `visibility` (private needs a payer) and `notes`. `member_ids` replaces who uses it; `used_by: "household"` says the household as a whole does, and `"not_set"` says nobody in particular. Each is a choice made by hand, after which the plan no longer follows its thing's owner. `used_by_source: "thing"`, on its own, hands the answer back to the owner of the thing it is attached to (refused on a plan attached to nothing); `"set"` on its own keeps who uses it today and stops following. The household and names together are refused. A cancellation is `status: "cancelled"` with the `end_date` access runs to; a lease or a prepaid term is in the table above. A `start_date` makes the status `recorded`; `start_date_status: "unknown"` clears the date and records that answer, and `"not_set"` clears both. Either one together with a date is refused.

### `thingglance_decide_event`

Settles a date in the queue, by `event_key`: `done` (the default), `dismissed`, or `restore` to put it back. It only records the decision. It cancels nothing and renews nothing.

## Resources

| URI | What it is |
| --- | --- |
| `thingglance://queue` | The dates that need a decision now, with today's counts |

## What is not here

- **Deleting.** By design.
- **Sending a date to dayGLANCE.** The app does it; no tool does yet.
- **Coverage edits.** A tool adds coverage; changing or removing one is done in the app.
- **A server without the desktop app.** dayGLANCE has a design for a host that syncs with the vault directly and serves MCP on its own. thingGLANCE's pure core suits it, and it is not built.

## Mac App Store

The listener needs the sandbox's network server entitlement (`com.apple.security.network.server`), which `electron/entitlements.mas.plist` carries for this and for the Stream Deck listener. It binds 127.0.0.1 only. dayGLANCE passed review with the same entitlement, answered with a demo video; expect to need the same.

The Claude Desktop setup is not in this build at all: an app from the store may not change another app's settings or point it at code to run (App Review Guideline 2.5.2). `electron-builder.config.cjs` leaves the two setup modules and the bridge out of the package, `__MAS_BUILD__` compiles the button out of the page, and main registers no handler. `scripts/verify-mas-compileout.mjs --mas <the .app>` reads the built app and fails if any of the three is there (`--direct` checks the opposite on a direct build). No discovery file is written either, so a Mac App Store user pastes the token into the bridge's extension.
