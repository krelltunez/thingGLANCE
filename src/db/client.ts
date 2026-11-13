import Dexie, { type Table } from 'dexie'
import type { Coverage, Decision, DeviceLink, Member, Subscription, Thing } from '@/core/types'
import { normalizeSubscription, normalizeThing } from '@/core/shape'

export interface Tombstone { id: string; deletedAt: string }

// Primary keys are the entities' own UUIDs, which are also their vault
// entityIds, so a remote apply is a plain put and nothing needs FK resolution
// when rows arrive out of order (a coverage whose thing has not landed yet is
// simply not shown until it does).
class ThingDB extends Dexie {
  things!: Table<Thing, string>
  coverages!: Table<Coverage, string>
  subscriptions!: Table<Subscription, string>
  decisions!: Table<Decision, string>
  // The household roster, mirrored from the shared `glance-users` vault app.
  members!: Table<Member, string>
  // Which member each thingGLANCE device belongs to; keyed by device id.
  devices!: Table<DeviceLink, string>
  tombstones!: Table<Tombstone, string>

  constructor() {
    super('thingglance')
    this.version(1).stores({
      things: 'id, status, category',
      coverages: 'id, thingId, endDate',
      subscriptions: 'id, thingId, status',
      decisions: 'id, eventKey',
      users: 'id',
      tombstones: 'id',
    })
    // v2, the household shape: things get one owner (or the household), a
    // responsible member and a visibility; plans can attach to several things
    // and cover several people; the roster table is named for what it holds.
    // Rows written by v0.1 are carried forward by the readers in core/shape.
    this.version(2).stores({
      subscriptions: 'id, *coversThingIds, status',
      members: 'id',
      devices: 'id, memberId',
    }).upgrade(async (tx) => {
      await tx.table('things').toCollection().modify((value, ref) => { ref.value = normalizeThing(value) })
      await tx.table('subscriptions').toCollection().modify((value, ref) => { ref.value = normalizeSubscription(value) })
      const roster = await tx.table('users').toArray()
      if (roster.length) await tx.table('members').bulkPut(roster)
    })
    // Dropped a version later than it was copied, so the copy above can still
    // read it.
    this.version(3).stores({ users: null })
  }
}

export const db = new ThingDB()

export const SYNCED_TABLES = ['things', 'coverages', 'subscriptions', 'decisions', 'devices'] as const
