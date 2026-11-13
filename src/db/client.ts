import Dexie, { type Table } from 'dexie'
import type { Coverage, Decision, Subscription, Thing, User } from '@/core/types'

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
  users!: Table<User, string>
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
  }
}

export const db = new ThingDB()

export const SYNCED_TABLES = ['things', 'coverages', 'subscriptions', 'decisions'] as const
