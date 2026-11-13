// The app's only write path. Every mutation stamps updatedAt and tells the
// vault engine which row changed (markDirty). Remote applies in
// src/sync/dbEngine.ts write to Dexie directly and never come through here,
// so a pulled row can never loop back into a push.

import { db } from './client'
import type { Coverage, Decision, Subscription, Thing, User } from '@/core/types'
import { nowIso, today } from '@/core/dates'
import { markDirty } from '@/sync/dirtyTracker'
import { markRosterDirty } from '@/multiuser/rosterDirtyTracker'

const uuid = () => crypto.randomUUID()

// Strip undefined / empty-string fields so optional data stays absent rather
// than syncing as noise.
function clean<T extends object>(o: T): T {
  const out = {} as Record<string, unknown>
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === '') continue
    if (typeof v === 'number' && Number.isNaN(v)) continue
    out[k] = v
  }
  return out as T
}

// Sample rows are local-only until touched. Editing any member of a sample
// "family" (a thing with its coverages and plans) makes the whole family real,
// so another device never receives a coverage without its thing.
async function promoteFamily(thingId: string | null | undefined): Promise<void> {
  if (!thingId) return
  const thing = await db.things.get(thingId)
  if (!thing?.sample) return
  const stamp = nowIso()
  await db.things.update(thingId, { sample: undefined, updatedAt: stamp })
  markDirty(thingId)
  for (const c of await db.coverages.where('thingId').equals(thingId).toArray()) {
    await db.coverages.update(c.id, { sample: undefined, updatedAt: stamp })
    markDirty(c.id)
  }
  for (const s of await db.subscriptions.where('thingId').equals(thingId).toArray()) {
    await db.subscriptions.update(s.id, { sample: undefined, updatedAt: stamp })
    markDirty(s.id)
  }
}

// ── Things ───────────────────────────────────────────────────────────────────

export type ThingInput = Omit<Thing, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'sample'>

export async function createThing(input: ThingInput): Promise<Thing> {
  const stamp = nowIso()
  const thing = clean({ ...input, id: uuid(), kind: 'thing', createdAt: stamp, updatedAt: stamp }) as Thing
  await db.things.add(thing)
  markDirty(thing.id)
  return thing
}

export async function updateThing(id: string, patch: Partial<ThingInput>): Promise<void> {
  await promoteFamily(id)
  const cur = await db.things.get(id)
  if (!cur) return
  // put (not update) so a cleared optional field is really removed.
  await db.things.put(clean({ ...cur, ...patch, sample: undefined, updatedAt: nowIso() }) as Thing)
  markDirty(id)
}

export async function retireThing(id: string, resaleValue?: number): Promise<void> {
  await updateThing(id, { status: 'retired', retiredAt: today(), resaleValue })
}

export async function reviveThing(id: string): Promise<void> {
  await updateThing(id, { status: 'active', retiredAt: undefined, resaleValue: undefined })
}

// Coverage dies with its thing. Plans do not: the phone goes, the phone plan
// usually stays, so attached subscriptions are detached instead of deleted.
export async function deleteThing(id: string): Promise<void> {
  await promoteFamily(id)
  const stamp = nowIso()
  await db.transaction('rw', db.things, db.coverages, db.subscriptions, db.tombstones, async () => {
    for (const c of await db.coverages.where('thingId').equals(id).toArray()) {
      await db.coverages.delete(c.id)
      await db.tombstones.put({ id: c.id, deletedAt: stamp })
      markDirty(c.id)
    }
    for (const s of await db.subscriptions.where('thingId').equals(id).toArray()) {
      await db.subscriptions.update(s.id, { thingId: null, updatedAt: stamp })
      markDirty(s.id)
    }
    await db.things.delete(id)
    await db.tombstones.put({ id, deletedAt: stamp })
  })
  markDirty(id)
}

// ── Coverage ─────────────────────────────────────────────────────────────────

export type CoverageInput = Omit<Coverage, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'sample'>

export async function saveCoverage(input: CoverageInput, id?: string): Promise<Coverage> {
  await promoteFamily(input.thingId)
  const stamp = nowIso()
  const cur = id ? await db.coverages.get(id) : undefined
  const row = clean({ ...cur, ...input, id: id ?? uuid(), kind: 'coverage', createdAt: cur?.createdAt ?? stamp, updatedAt: stamp, sample: undefined }) as Coverage
  await db.coverages.put(row)
  markDirty(row.id)
  return row
}

export async function deleteCoverage(id: string): Promise<void> {
  const cur = await db.coverages.get(id)
  await promoteFamily(cur?.thingId)
  await db.coverages.delete(id)
  await db.tombstones.put({ id, deletedAt: nowIso() })
  markDirty(id)
}

// ── Subscriptions ────────────────────────────────────────────────────────────

export type SubscriptionInput = Omit<Subscription, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'sample'>

export async function saveSubscription(input: SubscriptionInput, id?: string): Promise<Subscription> {
  const cur = id ? await db.subscriptions.get(id) : undefined
  await promoteFamily(cur?.thingId)
  await promoteFamily(input.thingId)
  const stamp = nowIso()
  const row = clean({ ...cur, ...input, id: id ?? uuid(), kind: 'subscription', createdAt: cur?.createdAt ?? stamp, updatedAt: stamp, sample: undefined }) as Subscription
  // clean() drops nulls it should keep? No: null survives, only undefined and '' go.
  await db.subscriptions.put(row)
  markDirty(row.id)
  return row
}

export async function patchSubscription(id: string, patch: Partial<SubscriptionInput>): Promise<void> {
  const cur = await db.subscriptions.get(id)
  if (!cur) return
  const { id: _id, kind: _kind, createdAt: _c, updatedAt: _u, sample: _s, ...rest } = cur
  await saveSubscription({ ...rest, ...patch }, id)
}

export async function deleteSubscription(id: string): Promise<void> {
  const cur = await db.subscriptions.get(id)
  await promoteFamily(cur?.thingId)
  await db.subscriptions.delete(id)
  await db.tombstones.put({ id, deletedAt: nowIso() })
  markDirty(id)
}

// ── Decisions ────────────────────────────────────────────────────────────────

export async function decide(eventKey: string, state: Decision['state'], taskId?: string): Promise<Decision> {
  const stamp = nowIso()
  const existing = (await db.decisions.where('eventKey').equals(eventKey).toArray())
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]
  const row: Decision = clean({
    ...existing,
    id: existing?.id ?? uuid(),
    kind: 'decision',
    eventKey,
    state,
    taskId: taskId ?? existing?.taskId,
    createdAt: existing?.createdAt ?? stamp,
    updatedAt: stamp,
  }) as Decision
  await db.decisions.put(row)
  markDirty(row.id)
  return row
}

export async function undecide(eventKey: string): Promise<void> {
  const stamp = nowIso()
  for (const d of await db.decisions.where('eventKey').equals(eventKey).toArray()) {
    await db.decisions.delete(d.id)
    await db.tombstones.put({ id: d.id, deletedAt: stamp })
    markDirty(d.id)
  }
}

// ── Household roster (the shared glance-users vault app) ─────────────────────

export async function addUser(name: string): Promise<User> {
  const user: User = { id: uuid(), name: name.trim(), updatedAt: nowIso() }
  await db.users.add(user)
  markRosterDirty(user.id)
  return user
}

export async function renameUser(id: string, name: string): Promise<void> {
  await db.users.update(id, { name: name.trim(), updatedAt: nowIso() })
  markRosterDirty(id)
}

export async function removeUser(id: string): Promise<void> {
  await db.users.delete(id)
  await db.tombstones.put({ id, deletedAt: nowIso() })
  markRosterDirty(id)
}

// ── Housekeeping ─────────────────────────────────────────────────────────────

export async function hasAnyData(): Promise<boolean> {
  return (await db.things.count()) + (await db.subscriptions.count()) > 0
}

export async function countSamples(): Promise<number> {
  const [t, s] = await Promise.all([
    db.things.filter((x) => !!x.sample).count(),
    db.subscriptions.filter((x) => !!x.sample).count(),
  ])
  return t + s
}

// Sample rows never synced, so removing them needs no tombstones.
export async function removeSamples(): Promise<void> {
  await db.transaction('rw', db.things, db.coverages, db.subscriptions, async () => {
    await db.things.filter((x) => !!x.sample).delete()
    await db.coverages.filter((x) => !!x.sample).delete()
    await db.subscriptions.filter((x) => !!x.sample).delete()
  })
}
