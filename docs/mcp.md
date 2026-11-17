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

A **verdict** says where a thing is in its life: `prime`, `solid`, `watch`, `replace`, `overdue`, `retired` or `unknown`. A **date** has a type: `coverage-end`, `support-end`, `replace`, `renewal`, `trial-end` or `sub-end`, and a state: `open`, `done`, `dismissed` or `sent` (handed to dayGLANCE).

### Reading

### `thingglance_ping`

Confirms the server is reachable. Reads nothing.

### `thingglance_get_overview`

Where things stand today: the counts, what the plans cost a month and a year, the charges coming in the next 30 days, the queue of dates that need a decision (at most 50) and the next few after them. The place to start.

### `thingglance_list_things`

The things, soonest to run out first. Filters: `status` (`active` by default, `retired`, `all`), `category`, `verdict`, `owner` (a member id, `me` or `household`) and `query` (words in the name, brand, model or category).

### `thingglance_get_thing`

One thing in full, by `thing_id`: its details, notes and specs, who owns it and who deals with it, its coverage, the plans attached to it and its dates ahead.

### `thingglance_list_plans`

The plans, most expensive first, with the totals. Filters: `status` (`current` by default, `active`, `trial`, `cancelled`, `all`), `thing_id` and `query`.

### `thingglance_list_upcoming`

The dates between `from` and `to` (today to 90 days ahead by default, about three years at most), soonest first. Filters: `types`, `thing_id`, `plan_id`. Routine renewals of short-cycle plans are left out unless `include_routine` is true.

### `thingglance_list_queue`

Every date that needs a decision now, most pressing first.

### `thingglance_list_members`

The household: each member, whether they use the app, what they own and pay for, and which member this computer belongs to.

### `thingglance_list_mcp_writes`

What assistants changed this session, newest first, with each changed field's value before. Filter by `thing_id`, `plan_id` or `event_key`.

### Changing

All of these need "Allow changes". An edit sends only the fields to change: a field left out is untouched, and `null` clears one that can be empty.

### `thingglance_create_thing`

Adds a thing. Only `name` is required. Also: `category` (guessed from the name when left out), `brand`, `model`, `purchase_date`, `price`, `retailer`, `support_end`, `lifespan_months`, `owner_member_id`, `notes`.

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

Changes whose a thing is (`owner_member_id`) or who deals with it (`responsible_member_id`), or both. A new owner is recorded as a hand-me-down, with the earlier owner kept in its history. `null` for the owner means the household.

### `thingglance_add_coverage`

Adds a warranty, an extended warranty or insurance to a thing. `thing_id`, `name` and `end_date` are required. Also: `type` (`warranty` by default, `extended`, `insurance`), `start_date`, `provider`, `cost`, `notes`.

### `thingglance_create_plan`

Adds a plan. `name` and `amount` are required. Also: `cycle` (`monthly` by default, `weekly`, `quarterly`, `yearly`), `anchor_date`, `provider`, `status` (`active` or `trial`, which needs `trial_end`), `auto_renew`, `review`, `thing_ids`, `payer_member_id`, `notes`.

### `thingglance_update_plan`

Edits a plan, by `plan_id`. Every field the app's form edits: `name`, `amount`, `cycle`, `anchor_date`, `provider`, `status` (`active`, `trial`, `cancelled`), `trial_end`, `end_date`, `auto_renew`, `review_before_renewal`, `thing_ids`, `payer_member_id`, `responsible_member_id`, `visibility` (private needs a payer) and `notes`. A cancellation is `status: "cancelled"` with the `end_date` access runs to.

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
