# CLAUDE.md

Working notes for AI-assisted sessions in this repo.

## What this is

thingGLANCE: the GLANCE family's tracker for things that carry dates (warranties, subscriptions, support windows, planned replacement). Sky blue. Web app + PWA today; Capacitor, Electron (tray, MCP) and GLANCElauncher integration are expected later. It is NOT a home inventory: resist features that only catalogue.

Sibling repos sit next to this one (`../lastGLANCE` is the closest model: same stack, TypeScript, Dexie, Tailwind). When wiring anything family-shaped (vault, roster, intents, shells), read how lastGLANCE does it first and match the wire contract.

## Conventions

- **Sync is GLANCEvault only.** Do not add WebDAV, iCloud or Direct Access roads.
- **`src/core` stays pure**: no React, Dexie or DOM imports. Widgets, the tray, MCP and headless runs will import it.
- **One write path**: every local mutation goes through `src/db/queries.ts`, which stamps `updatedAt` and calls `markDirty`. Remote applies in `src/sync/dbEngine.ts` write to Dexie directly and must never call `markDirty`.
- **Local shape == sync shape.** UUID ids double as vault entity ids; every synced entity has a `kind`. The only local-only field is `sample`.
- **Household members**: before touching owners, payers, the roster or who gets alerted, read `docs/household-members.md` (the spec, how it differs from the code, and what was built). The `glance-users` row stays `{ id, name, updatedAt }`: sibling apps erase anything else put on it. A user is a member with a `device` row; each device writes only its own. There is no multi-user switch: `multiUser` in the data context just means the roster has more than one member, and the roster syncs whenever the vault is on.
- **Privacy is applied once, at the door.** `visibleTo()` (`src/core/household.ts`) strips other members' private items in `DataProvider` and in `buildSnapshot()`. Build new surfaces from those, never from the raw tables.
- **Every row that comes in is read through `src/core/shape.ts`** (Dexie upgrade, vault apply, backup import), so v0.1 rows are carried forward. Add a reader there when a synced field is renamed.
- **Sample rows never sync.** `toSync` answers null for them; editing one promotes its whole family (thing + coverages + plans) via `promoteFamily`.
- **Other surfaces read `buildSnapshot()`** (`src/core/snapshot.ts`). Its shape is a frozen contract: read `docs/snapshot.md` before touching it. Adding a field keeps the version; anything else bumps `SNAPSHOT_VERSION`. `snapshot.test.ts` pins the field lists.
- **Reminders are decided in `src/core/reminders.ts`**, never in a shell. A shell only makes the platform's pending notifications match `planReminders()` (also in the snapshot as `reminders`).
- **Colours are CSS variables** (`src/index.css`) mapped in `tailwind.config.ts`. Use the semantic names (`bg-panel`, `text-dim`, `text-accent`, `ok` / `warn` / `bad` / `sub`), never raw palette classes, so light and dark stay one set of class names.
- **Live push is additive.** `src/sync/vaultEventStream.ts` only ever triggers the same drains the polling cadence runs. Never make anything depend on a nudge arriving.
- **A passphrase is proven against the sibling apps before it is trusted** (`src/sync/keyCheck.ts`). The sync engine only checks a key against the app's own namespace, which is empty when thingGLANCE joins an existing account, so on its own it accepts any passphrase. Never call `engine.ensureRootKey()` on a new passphrase without that check first.
- **Vault intents are always encrypted.** No plaintext path, send or receive.
- A config change to the vault connection ends in `window.location.reload()`: the sync package keeps its root key in module state.
- Release notes contain no em dashes (family rule). Times are Mountain Time (America/Denver).

## Verifying

- `npm run lint` (zero warnings allowed), `npm test` (unit), `npx tsc -b` (types), `npm run build` (includes the service worker). CI runs all four and builds the Docker image.
- Component files export components only (the fast-refresh lint rule). Helpers live beside them: `components/kit.ts`, `components/useEventActions.ts`, `state/data.ts`.
- `npm run test:e2e` for anything touching sync, the roster or intents. It needs the dev server and a local vault; the header of `e2e/vault-sync.mjs` has the one-liner that starts one from `../glance-vault` with `thingglance` allowed.
- Dev server is on port 5190 (`.claude/launch.json`), deliberately not Vite's default so its localStorage never shares an origin with a sibling app's dev server.
