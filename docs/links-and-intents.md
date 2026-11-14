# Links and outside writes

Two doors lead into the app from outside it. Both are built once in the web app and reused by every shell.

- **Links** open the app at a place. They never change data.
- **Intents** change or ask something. Each one carries an id and is applied once.

Keeping them apart is deliberate. A link can come from anywhere, a web page included, so there is no link that clears, creates or deletes.

## Links

`src/core/links.ts` holds the grammar: `parseLink()` reads a link, `formatLink()` writes one, and they round-trip. `src/state/useLinks.ts` is the only place a link turns into something on screen.

| Link | Opens |
| --- | --- |
| `thingglance://thing/<id>` | A thing's detail |
| `thingglance://plan/<id>` | A plan |
| `thingglance://event/<key>` | Whatever a date on the horizon belongs to: its plan, else its thing |
| `thingglance://view/<name>` | `glance`, `horizon`, `things` or `plans` |
| `thingglance://queue` | What needs a decision |
| `thingglance://action/add` | The add-a-thing form. `?name=` prefills it |
| `thingglance://action/add-plan` | The add-a-plan form. `?name=` prefills it |
| `thingglance://settings/<section>` | Settings, optionally at `general`, `vault`, `household`, `integrations`, `data` or `about` |
| `thingglance://search` | The command palette |

Anything else parses to nothing and is ignored.

**How a link arrives**

- A shell calls `openLink(link)` from `src/native/links.ts` when the operating system hands it one (a widget tap, a notification tap, the tray, a shortcut). A link that arrives before the app is listening is kept until it is.
- The web app has no scheme of its own, so the same paths are accepted on its own address: `/?link=thing/<id>` or `/?link=<a full link>`. The installed PWA registers `web+thingglance://` and receives those the same way.
- The older query forms still work, since shortcuts installed before this point at them: `/?view=horizon`, `/?action=add-thing`, `/?action=add-subscription`, `/?thing=<id>`.

Every event and reminder in [the snapshot](snapshot.md) carries its `link`, so a widget row or a notification only has to open what it was given.

A link to something this device cannot see (removed, or private to another member) says so and opens nothing.

## Intents

`handleIntent()` in `src/intents/handleIntent.ts` takes `{ action, payload, clientId }` and answers a plain result. It knows nothing about where the request came from. `dispatchExternalWrite()` in `src/intents/inbound.ts` is the live version a shell's bridge calls.

| Action | Payload | Answers |
| --- | --- | --- |
| `create_thing` | `name`, and optionally `category`, `brand`, `model`, `retailer`, `purchase_date`, `price`, `lifespan_months`, `support_end`, `owner_member_id`, `notes` | `thing_id` |
| `add_coverage` | `thing_id`, `name`, `end_date`, and optionally `type` (`warranty`, `extended`, `insurance`), `start_date`, `provider`, `cost`, `notes` | `coverage_id` |
| `create_plan` | `name`, `amount`, and optionally `cycle`, `anchor_date`, `provider`, `thing_ids`, `payer_member_id`, `auto_renew`, `status`, `trial_end`, `review`, `notes` | `plan_id` |
| `decide` | `event_key`, and optionally `state`: `done` (the default), `dismissed` or `restore` | `event_key`, `state` |
| `send` | `event_key` | `event_key`. Hands the date to dayGLANCE as a task |
| `open` | `link` | Nothing. The link goes through the router above |
| `query` | Nothing | `snapshot` |

Dates are `YYYY-MM-DD`. A failure answers `success: false` with a `code` (`invalid`, `not_found`, `unavailable`, `client_id_required`, `unknown_action` or `failed`) and an `error` a person can read.

There is no delete, on purpose.

### Rules every caller gets

- **Every write needs a `clientId`**: an id the caller chooses and sends again unchanged if it retries. A write whose id was already applied answers `deduped: true` with the same entity id and changes nothing. `open` and `query` need none.
- **A UUID `clientId` becomes the new row's own id** on a create. The same write arriving on another device then makes the same row, not a second one.
- **A write that was refused is not remembered**, so a corrected retry with the same id goes through.
- **Writes use the same functions the forms use** (`src/db/queries.ts`): they are stamped, marked for sync, and promote sample rows.
- **A caller acts as this device's member.** It cannot see, add coverage to, clear or send anything that is private to someone else.
- After a write that changed something, `tg:external-write` fires on `window`, so a shell can push a fresh snapshot.

The record of applied ids is `tg_handled_writes` in localStorage, the newest 500.

### Not here yet

Updating a thing or a plan, handing a thing to another member, and the list of past outside writes with undo. Those arrive with the MCP tools in Phase 6, which is what needs them.

## Trying it

No shell exists yet, so the dev server exposes both doors on `window.__thingglance`:

```js
__thingglance.openLink('thingglance://view/horizon')
await __thingglance.intent({ action: 'create_thing', clientId: crypto.randomUUID(), payload: { name: 'Pixel 9' } })
await __thingglance.intent({ action: 'query' })
```
