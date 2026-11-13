# thingGLANCE

**Know what's next for your things.** Warranties, subscriptions, support windows, and the right moment to buy the next one.

thingGLANCE is the fourth GLANCE app (dayGLANCE is orange, lastGLANCE green, lifeGLANCE purple, this one sky blue). It is **not** a home inventory. It tracks the handful of things you own that carry dates: when the warranty lapses, when a plan renews, when security updates stop, and when you said you would replace it.

> Status: prototype (v0.1). Web app + PWA. Native shells, widgets, the desktop app and MCP come later; the code is laid out for them (see [Built for what comes next](#built-for-what-comes-next)).

## What it does

| Screen | What it answers |
| --- | --- |
| **Glance** | "Is there anything I should be thinking about?" A queue of decisions, a 12-month strip, the fleet by how much life is left, plan charges month by month, and an upgrade fund. |
| **Horizon** | Every thing as a lane on one time axis: coverage bars, the support window (dashed when it is an estimate), your planned replacement, renewals. Plus the same dates as an agenda. |
| **Things** | Cards with a life-left ring, verdict (Prime / Solid / Watch / Replace soon / Past its window), coverage and the next date. |
| **Plans** | Every subscription, what it normalises to per month and year, a 12-month charge forecast, and a "review before it renews" flag. |

Ideas that are in and worth a look:

- **The decision queue.** Each dated event enters the queue inside its own lead window (a warranty 45 days out, end of support six months out, an annual renewal a month out, a trial ten days out). Clear it when you have decided, or send it to dayGLANCE as a task. Monthly plans stay quiet unless you flag them for review.
- **Web lookup.** Type a product name and the form fills in: photo, specs and release date from Wikipedia, end of security updates from [endoflife.date](https://endoflife.date). Both are public, key-less, CORS-enabled APIs, so there is no proxy and nothing store-unfriendly. Where a maker has not published an end date, the app estimates one from their usual support window and labels it as an estimate.
- **Upgrade fund.** "Set aside $X a month and every replacement is paid for the day it is due": each thing's price spread over the months it has left.
- **Cost of ownership.** Per day so far, and per day if you keep it as long as planned. Retired things keep their final number (minus what you sold them for).
- **T-minus notation.** `T-12d` before a date, `T+19d` after it.
- **Command palette** (`⌘K` or `/`), `n` for a new thing, `1`–`4` to switch screens.
- **Sample data** that is always relative to today, never syncs, and becomes real the moment you edit it.

## Run it

```bash
npm install
npm run dev        # http://localhost:5190
npm run lint
npm test           # unit tests for the date, cost, lookup and live-sync logic
npm run build      # type-check + production build + service worker
npm run gen:icons  # re-render the PWA icons from public/icons/*.svg
```

## Self-hosting

thingGLANCE is a static web app, so the image is nginx and files: no Node process, no database, nothing to configure in the container. Your data lives in the browser and, if you connect one, in your GLANCEvault.

```yaml
services:
  app:
    image: ghcr.io/krelltunez/thingglance:latest
    ports:
      - "3000:80"
    restart: unless-stopped
```

Or build it yourself with `docker compose up -d --build`. The container answers `GET /healthz` for health checks.

Three things to get right when it sits behind your own domain:

- **HTTPS.** The service worker, install prompt and encryption all need a secure context. Terminate TLS at your reverse proxy.
- **Your vault must allow it.** Add the app's address (for example `https://things.example.com`) to the vault's `GLANCEVAULT_ALLOWED_ORIGINS`, and `thingglance` to `GLANCEVAULT_ALLOWED_APPS`. A vault served over plain HTTP cannot be reached from an HTTPS page. See [Allowing thingGLANCE on your vault](#allowing-thingglance-on-your-vault) if the app still says it is not listed.
- **Do not buffer the vault's event stream.** Live updates arrive over `GET /events` on the vault. If the proxy in front of the *vault* buffers responses, the stream opens and stays silent; Settings → GLANCEvault will say so, and sync falls back to checking every few minutes. For nginx that means `proxy_buffering off;` on that location.

## Sync: GLANCEvault only

Unlike its siblings, thingGLANCE has exactly one sync road: **GLANCEvault**, end-to-end encrypted with the same passphrase and per-account salt as the other GLANCE apps. No WebDAV, iCloud or Direct Access.

- **Vault app name:** `thingglance`. A self-hosted server must list it in `GLANCEVAULT_ALLOWED_APPS` (it is not in the server's default list yet), and the web app's origin must be in `GLANCEVAULT_ALLOWED_ORIGINS`. The connection test reads `/healthz` and says so plainly if the app is not allowed.
- **Connect** with a GLANCEvault Pro account key (the app enrolls the device) or a self-hosted URL + account id + device token, same as lastGLANCE.
- **Entities:** `thing`, `coverage`, `subscription`, `decision`, `device`. Local shape equals sync shape; ids are UUIDs that double as vault entity ids; every entity carries a `kind`.
- **Household.** Track things for everyone in the house, whether or not they use the app. The member list is the shared `glance-users` vault app, the same roster the other apps read and write. A thing has an owner (or belongs to the household) and someone who deals with it; a plan has a payer and can cover several things and people. Saying "This is me" on a device makes that member a user, and either can be marked private, which hides it on everyone else's devices (it is not separately encrypted). See [docs/household-members.md](docs/household-members.md).
- **Live updates.** The app holds the vault's `/events` stream open while it is visible and syncs the moment another device writes. Polling (every five minutes, on focus, and three seconds after a local write) keeps running underneath as the backstop.
- **Intents** go over the vault's `intents` endpoints, always encrypted. thingGLANCE emits `create` (source app `app.thingglance`, `source_entity_id` = the horizon event key) and consumes the `notify` that comes back, so completing the task in dayGLANCE clears the item here on every device.

### Allowing thingGLANCE on your vault

Set this in the vault's `.env`. The list replaces the server's default rather than adding to it, so name every app you use; `glance-users` is the shared household roster.

```
GLANCEVAULT_ALLOWED_APPS=dayglance,dayglance-bridge,glance-users,lastglance,lastglance-people,lifeglance,thingglance
```

Then recreate the container. A stop and start, or a restart, keeps the environment the container was created with and never re-reads `.env`:

```bash
docker compose up -d --force-recreate
```

`GET /healthz` on the vault shows the list in effect. If `thingglance` is still missing:

- `docker compose config | grep ALLOWED` shows what Compose resolved. No `GLANCEVAULT_ALLOWED_APPS` line means the compose file does not pass it through: add `GLANCEVAULT_ALLOWED_APPS: ${GLANCEVAULT_ALLOWED_APPS:-}` under the service's `environment:`. An empty value means `.env` is not beside the compose file, or the line is misspelled or still commented out.
- A vault run from Portainer, Unraid or another stack UI takes its variables from that tool's settings, not from `.env`.

The allowed origins travel the same road, so the same checks apply to `GLANCEVAULT_ALLOWED_ORIGINS`.

### End-to-end test

`npm run test:e2e` drives two browser contexts against a real vault: connect, passphrase (and a wrong one), create / edit / delete across devices, live push, the shared roster, and the intent round-trip. Setup is in the header of [e2e/vault-sync.mjs](e2e/vault-sync.mjs). dayGLANCE itself is not in the loop; the script plays its part.

## Built for what comes next

```
src/
  core/        Pure domain logic. No React, no Dexie, no DOM.
               types · dates · money · health (lifecycle, verdict, fund) ·
               horizon (events, queue) · snapshot
  db/          Dexie tables, the one write path (queries.ts), samples, backup
  sync/        Vault config, engine wiring, connect / test, the sync manager
  multiuser/   glance-users roster engine + device-local preferences
  intents/     Vault transport, key store, emit (create) and receive (notify)
  lookup/      Wikipedia + endoflife.date behind one lookupProduct()
  native/      platform.ts: the single place that knows which shell this is
  state/       React glue: live data context, UI context, settings, toasts
  views/       Glance, Horizon, Things, Plans
  components/  Kit (ui.tsx), domain parts, detail drawer, forms, settings
```

- **Widgets, tray popup, GLANCElauncher, MCP** should read one object: `buildSnapshot()` in [src/core/snapshot.ts](src/core/snapshot.ts). It is plain JSON (counts, burn, the queue, upcoming events, per-thing verdicts) and versioned. Settings → Integrations shows the live one and copies it.
- **Electron main / MCP server / headless refresh** can import `src/core` and `src/sync` directly: neither touches React. The sync manager is a plain observable module.
- **Native shells** plug in at [src/native/platform.ts](src/native/platform.ts): it already keeps the service worker out of non-browser shells and applies the `html.native` / `html.desktop-<platform>` class contract lastGLANCE uses. `vite --mode electron` builds without the PWA plugin.
- **Deep links** exist now for PWA shortcuts and are what widgets and the launcher will use: `/?view=horizon`, `/?action=add-thing`, `/?action=add-subscription`, `/?thing=<id>`.
- **Lookup providers** sit behind `lookupProduct()`, so a native build can add richer sources without touching the form.

## Not done yet

Deliberately out of scope for the prototype: i18n (strings are inline English), local notifications, currency conversion (one currency for everything), receipt or photo attachments, and billing.

## License

MIT
