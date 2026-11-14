// The app's only write path. Every mutation stamps updatedAt and tells the
// vault engine which row changed (markDirty). Remote applies in
// src/sync/dbEngine.ts write to Dexie directly and never come through here,
// so a pulled row can never loop back into a push.

import { db } from './client'
import type { Coverage, Decision, DeviceLink, Member, Subscription, Thing } from '@/core/types'
import { nowIso, today } from '@/core/dates'
import { handDown, isTied, memberTies, privateHeld, reassignPlan, reassignThing, userIds, type MemberTies } from '@/core/household'
import { markDirty } from '@/sync/dirtyTracker'
import { getDeviceId } from '@/sync/deviceId'
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
// so another device never receives a coverage without its thing. A plan can
// span several things, so the family is followed across it.
async function promoteFamily(thingId: string | null | undefined, seen = new Set<string>()): Promise<void> {
  if (!thingId || seen.has(thingId)) return
  seen.add(thingId)
  const thing = await db.things.get(thingId)
  if (!thing?.sample) return
  const stamp = nowIso()
  await db.things.update(thingId, { sample: undefined, updatedAt: stamp })
  markDirty(thingId)
  for (const c of await db.coverages.where('thingId').equals(thingId).toArray()) {
    await db.coverages.update(c.id, { sample: undefined, updatedAt: stamp })
    markDirty(c.id)
  }
  for (const s of await db.subscriptions.where('coversThingIds').equals(thingId).toArray()) {
    await db.subscriptions.update(s.id, { sample: undefined, updatedAt: stamp })
    markDirty(s.id)
    for (const other of s.coversThingIds) await promoteFamily(other, seen)
  }
}

async function promoteFamilies(thingIds: string[] | undefined): Promise<void> {
  for (const id of thingIds ?? []) await promoteFamily(id)
}

// ── Things ───────────────────────────────────────────────────────────────────

// ownershipHistory is never written directly: changing the owner writes it.
export type ThingInput = Omit<Thing, 'id' | 'kind' | 'createdAt' | 'updatedAt' | 'sample' | 'ownershipHistory'>

// `id` lets a caller that already has one (an outside write naming its own
// id, so that sending it twice makes one thing) supply it.
export async function createThing(input: ThingInput, id: string = uuid()): Promise<Thing> {
  const stamp = nowIso()
  const thing = clean({ ...input, id, kind: 'thing', createdAt: stamp, updatedAt: stamp }) as Thing
  await db.things.add(thing)
  markDirty(thing.id)
  return thing
}

export async function updateThing(id: string, patch: Partial<ThingInput>): Promise<void> {
  await promoteFamily(id)
  const cur = await db.things.get(id)
  if (!cur) return
  // A change of owner is a hand-me-down: same thing, same dates, and a note of
  // who had it before.
  const owner = patch.ownerMemberId !== undefined ? handDown(cur, patch.ownerMemberId, today()) : {}
  // put (not update) so a cleared optional field is really removed.
  await db.things.put(clean({ ...cur, ...patch, ...owner, sample: undefined, updatedAt: nowIso() }) as Thing)
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
    for (const s of await db.subscriptions.where('coversThingIds').equals(id).toArray()) {
      await db.subscriptions.update(s.id, { coversThingIds: s.coversThingIds.filter((x) => x !== id), updatedAt: stamp })
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
  await promoteFamilies(cur?.coversThingIds)
  await promoteFamilies(input.coversThingIds)
  const stamp = nowIso()
  // clean() keeps null (the household) and drops only undefined and ''.
  const row = clean({ ...cur, ...input, id: id ?? uuid(), kind: 'subscription', createdAt: cur?.createdAt ?? stamp, updatedAt: stamp, sample: undefined }) as Subscription
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
  await promoteFamilies(cur?.coversThingIds)
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
//
// A member is anyone things are tracked for. A name is all it takes: no
// invite, no device.

export async function addMember(name: string): Promise<Member> {
  const member: Member = { id: uuid(), name: name.trim(), updatedAt: nowIso() }
  await db.members.add(member)
  markRosterDirty(member.id)
  return member
}

export async function renameMember(id: string, name: string): Promise<void> {
  await db.members.update(id, { name: name.trim(), updatedAt: nowIso() })
  markRosterDirty(id)
}

// Refused while they still own, pay for or are responsible for anything: the
// caller reassigns first (memberTies says what is left). Returns whether the
// member was removed. Their devices are detached and they come off any plan's
// "covers" list, since neither is worth blocking over.
// What still points at a member, read from the tables themselves: the views
// only hold what this device may see, and a member's private items are exactly
// what whoever is removing them cannot.
export async function tiesFor(id: string): Promise<{ ties: MemberTies; hidden: number }> {
  const [things, subscriptions] = await Promise.all([db.things.toArray(), db.subscriptions.toArray()])
  return { ties: memberTies(id, { things, subscriptions }), hidden: privateHeld(id, { things, subscriptions }) }
}

// Hands everything a member owns, pays for or deals with to someone else (null
// for the household), then removes them. An owner change is a hand-me-down
// like any other, so each thing keeps a note of who had it.
export async function reassignAndRemove(from: string, to: string | null): Promise<boolean> {
  if (to === from) return false
  const [things, subscriptions, members, devices] = await Promise.all([db.things.toArray(), db.subscriptions.toArray(), db.members.toArray(), db.devices.toArray()])
  if (to && !members.some((m) => m.id === to)) return false
  const users = userIds(devices, members)
  for (const t of things) {
    const patch = reassignThing(t, from, to, users)
    if (patch) await updateThing(t.id, patch)
  }
  for (const s of subscriptions) {
    const patch = reassignPlan(s, from, to, users)
    if (patch) await patchSubscription(s.id, patch)
  }
  return removeMember(from)
}

export async function removeMember(id: string): Promise<boolean> {
  const [things, subscriptions] = await Promise.all([db.things.toArray(), db.subscriptions.toArray()])
  if (isTied(memberTies(id, { things, subscriptions }))) return false
  const stamp = nowIso()
  for (const s of subscriptions.filter((x) => x.coversMemberIds.includes(id))) {
    if (s.sample) await promoteFamilies(s.coversThingIds)
    await db.subscriptions.update(s.id, { coversMemberIds: s.coversMemberIds.filter((x) => x !== id), sample: undefined, updatedAt: stamp })
    markDirty(s.id)
  }
  for (const link of await db.devices.where('memberId').equals(id).toArray()) await detachDevice(link.id)
  await db.members.delete(id)
  await db.tombstones.put({ id, deletedAt: stamp })
  markRosterDirty(id)
  return true
}

// ── Devices ("this is me") ───────────────────────────────────────────────────
//
// Attaching a device to a member is what makes that member a user. Each device
// writes only its own row, so two devices never contend over one.

export async function attachThisDevice(memberId: string, label?: string): Promise<void> {
  const id = getDeviceId()
  const cur = await db.devices.get(id)
  if (cur?.memberId === memberId) return
  const stamp = nowIso()
  const row = clean({ ...cur, id, kind: 'device', memberId, label: label ?? cur?.label, createdAt: cur?.createdAt ?? stamp, updatedAt: stamp }) as DeviceLink
  await db.devices.put(row)
  await db.tombstones.delete(id)
  markDirty(id)
}

// Any device may detach any other: that is how a lost phone stops counting as
// someone. It does not sign the device out of the vault.
export async function detachDevice(deviceId: string = getDeviceId()): Promise<void> {
  if (!(await db.devices.get(deviceId))) return
  await db.devices.delete(deviceId)
  await db.tombstones.put({ id: deviceId, deletedAt: nowIso() })
  markDirty(deviceId)
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
