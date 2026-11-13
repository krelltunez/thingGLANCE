# thingGLANCE: Household Members and Users Spec

Nov 12, 2026 · Jason Krellner

> Where this sits in the plan: [ROADMAP.md, Phase 0.5](ROADMAP.md#phase-05-household-members-and-users-l-in-stages). The spec below is as written. The last section, [Findings against the code](#findings-against-the-code-2026-11-13), was added on 2026-11-13 and answers the third open question.

## Purpose and status

thingGLANCE tracks things for everyone in a household, but only some of those people use the app. This spec defines how members and users work so the data model gets it right from the start.

- **This is not a build prompt.** Work it into the build when the data model, sync and household features come up. Nothing here should interrupt current work (Docker support, etc.).
- **GLANCEvault already has most of this.** Its roster already holds members who are not users. Build on that; do not create a parallel roster.
- **Sync is optional.** thingGLANCE is fully usable local-only on one device. Sync is GLANCEvault only (self-hosted or Pro). No WebDAV. iCloud is undecided and out of scope here.

## Core concepts

A member is a person the household tracks things for. A user is a member who runs the app on at least one device. Every user is a member; most members are not users.

| Concept | What it is | Where it lives |
| --- | --- | --- |
| Household | The group that shares data. One GLANCEvault `account_id`. | GLANCEvault account |
| Member | A person on the roster: a kid, an elderly parent, a partner, the user themselves. | Household data (synced, encrypted like any entity) |
| User | A member linked to one or more device credentials. A flag plus link on the member, not a separate record. | Member record + GLANCEvault credentials |
| Device credential | One device's GLANCEvault credential (existing per-device model). | GLANCEvault server |

Key principle: **the server does not know who is who.** Members are encrypted household data. The only server-side tie is credential to `account_id`, as today. The member-to-credential link is stored in the member record, inside the encrypted payload.

## Shared package: @glance-apps/household

Extract the roster into its own package, next to `@glance-apps/billing` and `@glance-apps/sync`, so every GLANCE app reads and writes members the same way. thingGLANCE is the first consumer; the others adopt it over time.

**Core member record** (kept deliberately small, nothing sensitive):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Stable forever. Every app references members by this. |
| `name` | string | Display name. |
| `color` / `avatar` | string, optional | For chips and filters. |
| `relationship` | string, optional | Free text or small enum (self, partner, child, parent, other). |
| `credentialIds` | string\[\] | Linked device credentials. Non-empty means the member is a user. |
| `mergedInto` | UUID, optional | Tombstone pointer after a merge (see lifecycle). |
| `createdAt` / `updatedAt` / `deletedAt` | timestamps | Standard sync fields. |

**Per-app extensions.** Each app stores its own member data in its own entity keyed by member `id` (for example `thing_member_prefs`, or lifeGLANCE's birth date and timeline data). Apps never add columns to the core record. This keeps one app's details out of every other app.

**Package surface (suggested):** list/get members, create, update, link/unlink credential, merge, resolve id (follows `mergedInto`), and a change subscription for UI.

## thingGLANCE data model

Every thing and plan says whose it is, who handles it, and who can see it. Owner and responsible are separate on purpose: a kid owns the iPad, a parent gets the alerts.

**Things**

| Field | Type | Rule |
| --- | --- | --- |
| `ownerMemberId` | UUID or null | Any member. Null means Household (shared items: the TV, the router). |
| `responsibleMemberId` | UUID or null | Must be a user. Gets the decision alerts. Defaults to the creator. |
| `visibility` | `shared` or `private` | Default `shared`. `private` only allowed when the owner is a user. |
| `ownershipHistory` | list of {memberId, from, to} | Appended on reassign (hand-me-downs). |

**Plans**

| Field | Type | Rule |
| --- | --- | --- |
| `payerMemberId` | UUID or null | Who pays. Null means Household. Drives "what I pay" totals. |
| `responsibleMemberId` | UUID or null | Must be a user. Gets renewal and trial alerts. |
| `coversMemberIds` | UUID\[\] | Who the plan serves (family plans cover several). |
| `coversThingIds` | UUID\[\] | Things the plan attaches to (AppleCare+ to an iPhone, a carrier plan to a phone). |
| `visibility` | `shared` or `private` | Same rule as things. |

All references go through the package's resolve function so merged members redirect automatically.

## Rules and lifecycle

Adding a person and making them a user are separate steps, and removing a user never removes the person.

| Action | What happens |
| --- | --- |
| Add member | Name only is enough. Takes seconds, no invite, no device. |
| Invite (make user) | Links a new device credential to an existing member. Everything already filed under them stays. Never create a second member for the same person. |
| Revoke user | Unlinks the credential. Member stays on the roster with all their things. Items where they were responsible become unassigned (see notifications). |
| Remove member | Blocked while they own things, pay for plans or are responsible for anything. Prompt to reassign first, then soft-delete. |
| Reassign (hand-me-down) | Change owner on a thing. Keeps history, coverage, plans and dates. Appends to `ownershipHistory`. Not a retire and re-add. |
| Merge | Pick the surviving member. Rewrite references in all thingGLANCE entities to the survivor. Set `mergedInto` on the other and soft-delete it, so late-syncing devices and other apps still resolve. |

**Duplicate detection.** Suggest a merge when two members share a name (case-insensitive, trimmed). Never merge automatically.

**Picker rules.** The owner picker lists all members plus Household. The responsible picker lists users only.

## Onboarding, local-only mode, views and notifications

**Onboarding.** On first sync, if the household roster already exists (from any GLANCE app), offer it: "Found your household: 4 people. Use them?" One tap adopts the roster. Otherwise, prompt to add yourself plus anyone else, skippable.

**Local-only mode.** Members work fully without sync. The single device is the only user, so responsible defaults to the device's own member and private is effectively moot. Provide roster export/import (a small file) so a local-only user can copy their household between GLANCE apps.

**Views.**

- Member filter on Glance, Horizon, Things and Plans ("Emma's stuff").
- Upgrade fund per member, plus the household total.
- Plan totals: household total and "what I pay" (by payer).
- Owner shown on thing cards and Fleet rows when the household has more than one member.

**Notifications.**

- Decision, renewal and trial alerts go to the responsible user only.
- Unassigned items (no responsible user, for example after a revoke) alert all users and show a "needs someone" prompt.
- Private items alert only the owner's devices.

## Out of scope and open questions

**Out of scope:** roles and permissions, per-item access lists beyond shared/private, a kid-facing UI, adopting the package in the other GLANCE apps (later, separately).

**Open questions:**

- [ ] **Private is a UI rule, not encryption.** All household devices share the same keys, so private items are hidden, not cryptographically sealed. Is that acceptable, or do private items need per-member keys? (Recommendation: accept it for v1 and say so plainly in the UI copy.)
- [ ] **Private items when the owner is revoked.** Keep them hidden until the member is re-linked, or let the revoking user choose to share or delete them?
- [x] **Does the existing GLANCEvault roster already match the core record above?** Code should compare it and list the gaps before building. Answered below: it matches on `id`, `name` and `updatedAt` and on nothing else.

## Findings against the code (2026-11-13)

Compared by reading, not by running anything: this repo, `../lastGLANCE` and `../day-planner` (their `rosterVault` modules), `../glance-vault` (`config.ts`, `credentials.ts`, `routes/enroll.ts`, `routes/admin.ts`) and `../glance-sync` (`dbEngine.js`). lifeGLANCE has a `rosterVault.js` too; I did not read it.

### What the roster is today

- A vault app called `glance-users`, one row per member, encrypted under the account's root key. The whole entity is `{ id, name, updatedAt }`.
- A delete is the sync engine's tombstone. It carries a `deletedAt` stamp and no payload.
- **There is no user on the wire.** Which member a device belongs to is a device-local preference (`tg_me_user_id` here, the equivalent in the siblings). So the roster does hold people who never run the app, as the spec says, but only because it holds nothing except names. Nothing ties a member to a credential.
- There is no `@glance-apps/household` package and no `glance-household` repo yet. Each app carries its own copy of the roster engine.

### Gaps in the core record

| Spec field | Today | Note |
| --- | --- | --- |
| `id`, `name`, `updatedAt` | Present | Same meaning. |
| `color` / `avatar`, `relationship` | Missing | Additive. |
| `credentialIds` | Missing | See "Linking a device" below. |
| `mergedInto` | Missing | Cannot live on a soft-deleted row: see below. |
| `createdAt` | Missing | Additive. |
| `deletedAt` | Not a field | It exists only on the engine's tombstone. |

### Three things that change the design

**1. Sibling apps will erase new fields.** lastGLANCE and dayGLANCE both push a member as exactly `{ id, name, updatedAt }` (`toRosterEntity`), and sync is last-writer-wins on the whole entity. They read a richer record without complaint, since their guard only checks those three fields, but the next rename made in either app writes the short shape back and `credentialIds`, `color` and `mergedInto` are gone. Patching the siblings to preserve unknown fields does not fully fix it, because every copy already installed keeps doing it.

Recommendation: **leave the `glance-users` row exactly as it is and put the new core fields in a companion record** keyed by the same member id, owned by the household package. Old apps never see it, so they cannot damage it. This is the same pattern the spec already uses for per-app extensions, and it is not a second roster: the list of who exists stays in `glance-users`. It needs one new entry in the vault's allowed apps (for example `glance-household`), which can ride along with the `thingglance` entry that is already pending.

**2. A merged member cannot be both soft-deleted and carry `mergedInto`.** A tombstone has no payload, so a device that syncs late sees a delete and nothing to follow. The companion record solves this as well: soft-delete the `glance-users` row, so sibling apps simply see the person disappear, and keep the companion row alive with `mergedInto` set. The resolve function reads the companion.

**3. A device often does not know its own credential id.** `/enroll` returns `credentialId`, and this app currently throws it away, which is a small fix. But a self-hosted device is connected by pasting a token and is never told the id. Two ways out:

- Link by `deviceId` instead. Every device already has one, the server already binds each credential to it, and it survives a re-enrollment (which mints a new credential id). The field would be `deviceIds`.
- Or add a small `whoami` route to the vault that returns the credential id for the presented credential.

Recommendation: link by `deviceId`. It needs no server change and no migration of existing self-hosted devices. One wrinkle to remember: the roster engine identifies itself to the vault as `<deviceId>-roster`, so the link must store the plain device id.

### Smaller points

- **Revoke.** Unlinking a member is an app-side edit. Actually cutting a device off the vault is an operator route today (`POST /admin/credentials/:id/revoke`); there is no route a household member can call. I did not check what a GLANCEvault Pro account page offers. The spec's "Revoke user" row therefore means "unlink" unless the vault grows an account-level revoke.
- **Invite.** No server work is needed. A new device connects the way it does now (account key or token, then the passphrase) and then picks "this is me" from the roster; that pick is what writes the link.
- **File roads.** The siblings also carry the roster as `glance-users.json` over WebDAV and Direct Access. thingGLANCE is vault only, so a household that syncs its other apps only by file will not see its roster here until it connects a vault. Roster export/import covers that case.
- **Sibling references after a merge.** lastGLANCE and dayGLANCE reference members by id and know nothing of `mergedInto`. Until they adopt the package, a merge done here leaves their items pointing at a member who has disappeared. Worth a warning in the merge dialog.

### thingGLANCE's own model against the spec

| Spec | v0.1 (`src/core/types.ts`) | Change |
| --- | --- | --- |
| `Thing.ownerMemberId` (one, or null for Household) | `ownerIds: string[]` | Rename and narrow. One owner maps across; none or several becomes Household. |
| `Thing.responsibleMemberId`, `visibility`, `ownershipHistory` | Missing | Additive. |
| `Subscription.payerMemberId` | `payerId` | Rename. |
| `Subscription.coversThingIds[]` | `thingId` (one) | Rename and widen. |
| `Subscription.coversMemberIds`, `responsibleMemberId`, `visibility` | Missing | Additive. |
| `Coverage` | `thingId` | No change. It follows its thing's owner and visibility. |
| `Decision` | `eventKey`, `state` | No change. A decision about a private item still syncs to every device; it is only ever shown through its event, which is hidden. |
| Member | `User { id, name, updatedAt }` | Becomes the package's member type. |
| "Multi-user" on/off switch (device-local) | `tg_multi_user_enabled` | Goes away. The spec derives it: show owners when the roster has more than one member. |
| Mine / Everyone switch | `tg_user_filter` | Becomes the member filter. |

Three of these are renames, which is the one kind of change the roadmap warns about once real data is in a vault. See stage A in the roadmap.

### Where the spec and the repo disagree

- The spec says iCloud is undecided. `CLAUDE.md` and the roadmap both say there is no iCloud road. Nothing here depends on the answer, so the roadmap is unchanged; if iCloud is genuinely back on the table it needs its own decision.
